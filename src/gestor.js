import fs from 'node:fs';
import path from 'node:path';
import { TIPOS, executar, respostaDeCota, fimDaCota, explicarFalha, envDaIA, falhaPermanente } from './adaptadores.js';
import { iasParaEquipe } from './equipes.js';
import { pedirValidado, validar, lembreteFormato, contarFormato } from './resposta.js';
import { prepararWorktree } from './git.js';
import { iaPublica } from './publico.js';
import * as prompts from './prompts.js';
import { PROMPT, executarRemoto } from './maquinas.js';
import { montarArgs, comandoDe, modeloDoNivel } from './adaptadores.js';
import { dnaDe, temDNA } from './dna.js';
import { executarComContas, contasDe, marcarConta } from './contas.js';
import { decidirNivel, normalizarDificuldade, NOMES as NOMES_NIVEL } from './niveis.js';
import * as testeLocal from './teste-local.js';

const EM_EXECUCAO = ['planejando', 'executando'];
// Quantas vezes a tarefa volta sozinha para a equipe quando o avaliador reprova, antes de chegar a você.
const CORRECOES_AUTO = 3;
const agora = () => new Date().toISOString();
// Hora de volta da cota; se não for hoje, com o dia (o limite semanal volta dias depois).
const hora = (iso) => {
  const d = new Date(iso);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? h : `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} às ${h}`;
};
const semCota = (retomarEm, mensagem) => Object.assign(new Error(mensagem), { semCota: true, retomarEm });

const lista = (v) => (Array.isArray(v) ? v : []);
const texto = (v, max = 1200) => String(v ?? '').trim().slice(0, max);

// O gestor é a própria API: recebe 100% das solicitações, planeja uma por vez
// e repassa às equipes só ponteiros (a nota da tarefa no vault).
export const criarGestor = ({ cfg, store, bus, vault, headroom, comunicar = () => {} }) => {
  const envDe = async (ia) => (headroom ? headroom.envPara(ia) : {});
  const rodando = new Set();
  const travas = new Map();
  let planejando = false;

  const salvarTarefa = async (t) => {
    t.atualizada = agora();
    await store.salvar('tarefas', t);
    bus.emitir({ tipo: 'tarefa', tarefa: t });
    return t;
  };

  const salvarIA = async (ia) => {
    await store.salvar('ias', ia);
    bus.emitir({ tipo: 'ia', ia: iaPublica(ia) });
  };

  // Um terminal (equipe) faz uma coisa por vez; o resto espera a vez.
  const comTrava = (chave, fn) => {
    const anterior = travas.get(chave) ?? Promise.resolve();
    const proxima = anterior.catch(() => {}).then(fn);
    travas.set(chave, proxima.catch(() => {}));
    return proxima;
  };

  const maquinaDe = async (projeto) => (projeto?.maquinaId ? await store.obter('maquinas', projeto.maquinaId) : null);

  // Na máquina remota, uma IA serve se o comando dela existe lá (descoberto no "Testar conexão").
  const disponivelEm = (ia, maquina) => {
    if (!maquina) return ia.status === 'pronto';
    const nome = path.basename(comandoDe(ia)).replace(/\.(exe|cmd)$/i, '');
    return (maquina.comandos ?? []).includes(nome);
  };

  // Uma etapa roda aqui ou na máquina do projeto. Lá, a IA não enxerga o cérebro local: a nota vai junto no prompt.
  const executarEm = async (ia, montarPrompt, { cwd, maquina, envExtra, aoLinha, nivel, rotulo }) => {
    if (!maquina || ia.tipo === 'simulado') return executar(ia, montarPrompt(ia), { cwd, timeoutMs: cfg.timeoutEtapaMs, velocidade: cfg.velocidadeSimulacao, envExtra, aoLinha, incluir: [cfg.vault], nivel, rotulo });
    const iaRemota = { ...ia, capacidades: { ...ia.capacidades, arquivos: false } };
    const modelo = modeloDoNivel(ia, nivel);
    const r = await executarRemoto(maquina, { pasta: cwd, comando: comandoDe(ia), args: [...montarArgs(ia, PROMPT), ...(modelo ? [TIPOS[ia.tipo].flagModelo, modelo] : [])], env: envDaIA(ia), prompt: montarPrompt(iaRemota), timeoutMs: cfg.timeoutEtapaMs, aoLinha });
    return { ...r, nivel, modelo };
  };

  // Escolha automática de modelo por dificuldade (dá para desligar em IAs).
  const nivelAutomatico = async () => (await store.obter('ajustes', 'niveis'))?.automatico !== false;

  // IAs que podem fazer o trabalho desta equipe, da principal para a última opção.
  // Devolve também o motivo de cada IA que ficou de fora, para o erro dizer o que fazer.
  const candidatas = async (equipe, projeto, { detalhar = false } = {}) => {
    const maquina = await maquinaDe(projeto);
    const ias = await store.listar('ias');
    const porId = new Map(ias.map((i) => [i.id, i]));
    if (cfg.simular) return porId.has('simulado') ? [porId.get('simulado')] : [];
    const emUso = (ia) => ia && ia.ativa && !ia.problema && ia.tipo !== 'shell' && (ia.tipo === 'simulado' || disponivelEm(ia, maquina));
    // O projeto pode limitar as IAs. Se todas as que ele permite saíram de uso, vale qualquer IA em uso
    // (senão a tarefa ficaria travada para sempre por causa de uma IA desligada).
    const doProjeto = (projeto?.ias ?? []).filter((id) => emUso(porId.get(id)));
    const permitidas = doProjeto.length ? new Set(doProjeto) : null;
    const motivo = (ia) => {
      if (!ia.ativa) return 'desligada em IAs';
      if (ia.problema) return `com problema (${ia.problema.motivo})`;
      if (ia.tipo !== 'simulado' && !disponivelEm(ia, maquina)) return maquina ? `não instalada em ${maquina.nome}` : 'não encontrada neste computador';
      if (permitidas && !permitidas.has(ia.id) && ia.tipo !== 'simulado') return 'fora das IAs deste projeto';
      if (ia.limiteAte && Date.parse(ia.limiteAte) > Date.now()) return 'sem cota no momento';
      if (equipe.requer && !ia.capacidades?.[equipe.requer]) return 'não edita arquivos';
      return '';
    };
    const ordem = [equipe.principal, equipe.reserva, ...ias.filter((i) => i.tipo !== 'simulado').map((i) => i.id), 'simulado'];
    const lista = [...new Set(ordem)].map((id) => porId.get(id)).filter((ia) => ia && ia.tipo !== 'shell');
    const aptas = lista.filter((ia) => !motivo(ia));
    if (!detalhar) return aptas;
    // A primeira cota a renovar entre as IAs que só estão paradas por cota: dá para esperar por ela.
    const proximaCota = lista
      .filter((ia) => motivo(ia) === 'sem cota no momento')
      .map((ia) => ia.limiteAte)
      .sort()[0] ?? null;
    return { aptas, proximaCota, foraDeUso: (projeto?.ias ?? []).length > 0 && !permitidas, motivos: lista.filter((ia) => ia.tipo !== 'simulado' && motivo(ia)).map((ia) => `${ia.nome}: ${motivo(ia)}`) };
  };

  // Roda a etapa na IA principal. Cada IA tem o seu rodízio de contas (contas.js): se uma conta bate o limite,
  // a próxima assume. Resposta fora do formato: pede a correção à mesma IA, sem refazer o trabalho.
  // Todas as IAs sem cota: a tarefa pausa e continua sozinha quando a primeira cota renovar.
  const rodar = async (equipe, montarPrompt, { tarefa, cwd, projeto, nivel = null, papel = null, esquema, validarJSON }) => {
    if (nivel && !(await nivelAutomatico())) nivel = null;
    const { aptas: ias, motivos: foraMotivos, foraDeUso, proximaCota } = await candidatas(equipe, projeto, { detalhar: true });
    if (!ias.length) {
      if (proximaCota) throw semCota(proximaCota, `todas as IAs que servem para ${equipe.nome} estão sem cota`);
      throw new Error(`nenhuma IA pronta para ${equipe.nome} (${foraMotivos.join('; ') || 'nenhuma IA escolhida'}). Em IAs, ligue uma IA instalada e logada e clique em Tentar de novo`);
    }
    if (foraDeUso) bus.terminal(equipe.id, '⚠ As IAs escolhidas para este projeto estão fora de uso. Usando as outras IAs ligadas.', 'aviso');
    const maquina = await maquinaDe(projeto);
    const motivos = [];
    const tentadas = new Set();
    const fila = [...ias];
    let soCota = true;
    while (fila.length) {
      const ia = fila.shift();
      tentadas.add(ia.id);
      const envExtra = maquina ? {} : await envDe(ia);
      const modelo = modeloDoNivel(ia, nivel);
      const linha = (l, canal) => bus.terminal(equipe.id, l, canal === 'erro' ? 'erro' : 'saida');
      bus.terminal(equipe.id, `▶ ${ia.nome}${nivel ? ` · modelo ${NOMES_NIVEL[nivel]}${modelo ? ` (${modelo})` : ''}` : ''}${tarefa ? ` · ${tarefa.id}` : ''}${maquina ? ` · em ${maquina.nome}` : ''}${envExtra.ANTHROPIC_BASE_URL ? ' · via Headroom' : ''}`, 'cmd');
      comunicar({ de: equipe.id, para: `ia:${ia.id}`, tipo: 'prompt', resumo: `${equipe.nome} pede para ${ia.nome}`, tarefaId: tarefa?.id, ia: ia.nome });
      let conta = null;
      let esgotou = false;
      const { r, json, problemas, correcoes } = await pedirValidado({
        // Contas desta IA (pool): se uma bate o limite, a próxima assume na hora, sem congelar a tarefa.
        rodar: async (correcao) => {
          const res = await executarComContas(
            ia,
            (iaConta) =>
              executarEm(iaConta, (alvo) => correcao ?? `${montarPrompt(alvo)}${lembreteFormato(ia)}`, {
                envExtra,
                cwd,
                maquina,
                aoLinha: linha,
                nivel,
                rotulo: { equipe: equipe.id, tarefaId: tarefa?.id, papel },
              }),
            { pausaMs: cfg.pausaLimiteMs, aviso: (m) => bus.terminal(equipe.id, m, 'aviso') },
          );
          conta = res.conta;
          esgotou = !!res.esgotou;
          return res.r;
        },
        esquema,
        validar: validarJSON,
        aoCorrigir: (p, n, max) => bus.terminal(equipe.id, `↻ ${ia.nome} respondeu fora do formato (${p.join('; ')}). Pedindo a correção ${n} de ${max}, sem refazer o trabalho.`, 'aviso'),
      });
      if (conta && conta.id !== 'principal') bus.terminal(equipe.id, `  conta: ${conta.nome}`, 'info');
      if (r.modeloTrocado) bus.terminal(equipe.id, `↷ ${ia.nome}: o modelo ${r.modeloTrocado.de} está no limite desta conta; usei ${r.modeloTrocado.para}.`, 'aviso');
      if (r.modeloIndisponivel) bus.terminal(equipe.id, `⚠ ${ia.nome} não tem o modelo ${r.modeloIndisponivel} nesta conta; usei o modelo padrão dela. Ajuste os modelos em IAs.`, 'aviso');
      ia.uso = { chamadas: 0, falhas: 0, ...ia.uso };
      ia.uso.chamadas += 1 + correcoes;
      ia.uso.ultima = agora();
      comunicar({ de: `ia:${ia.id}`, para: equipe.id, tipo: json ? 'resposta' : 'falha', resumo: json ? texto(json.resumo ?? json.fase ?? 'respondeu', 220) : `falhou (código ${r.codigo})`, texto: String(r.saida ?? '').slice(0, 4000), tarefaId: tarefa?.id, ia: ia.nome });
      if (json) {
        contarFormato(ia, correcoes > 0);
        await salvarIA(ia);
        bus.terminal(equipe.id, `✓ ${ia.nome} respondeu${correcoes ? ' (formato corrigido)' : ''}`, 'ok');
        return { ia, json, nivel: r.nivel ?? nivel, modelo: r.modelo ?? '' };
      }
      ia.uso.falhas += 1;
      if (esgotou || respostaDeCota(r)) {
        // O rodízio já marcou cada conta com a hora real de renovação; a IA volta com a primeira delas.
        if (!(Date.parse(ia.limiteAte ?? '') > Date.now())) ia.limiteAte = fimDaCota(`${r.saida}\n${r.erro}`, cfg.pausaLimiteMs);
        const n = contasDe(ia).length;
        bus.terminal(equipe.id, `⚠ ${ia.nome} sem cota${n > 1 ? ` nas ${n} contas` : ''} até ${hora(ia.limiteAte)}; a próxima IA assume agora.`, 'aviso');
        motivos.push(`${ia.nome} sem cota até ${hora(ia.limiteAte)}`);
        // Outra IA da mesma ferramenta faz o mesmo trabalho do mesmo jeito: tenta ela primeiro.
        fila.sort((a, b) => (b.tipo === ia.tipo) - (a.tipo === ia.tipo));
      } else {
        soCota = false;
        if (problemas.length) contarFormato(ia, true);
        const motivo = problemas.length ? `respondeu fora do formato mesmo depois de ${correcoes} ${correcoes === 1 ? 'correção' : 'correções'} (${problemas.join('; ')})` : explicarFalha(ia, r);
        motivos.push(`${ia.nome} ${motivo}`);
        // Falha de login numa conta extra marca só aquela conta; as outras continuam valendo.
        if (falhaPermanente(motivo) && conta && conta.id !== 'principal') {
          marcarConta(ia, conta.id, { problema: { motivo, em: agora() } });
          bus.terminal(equipe.id, `⚠ ${ia.nome}: a conta "${conta.nome}" ${motivo}. Ela fica de fora até você entrar de novo.`, 'aviso');
        } else if (falhaPermanente(motivo)) {
          ia.problema = { motivo, em: agora() };
          bus.terminal(equipe.id, `⚠ ${ia.nome} marcada como "com problema": o gestor não usa mais até ela passar no Testar.`, 'aviso');
        }
        bus.terminal(equipe.id, `✗ ${ia.nome}: ${motivo}. Passando para a próxima IA.`, 'erro');
      }
      await salvarIA(ia);
      // Acabaram as opções? Uma IA marcada com problema pode ter liberado outras (ex.: o projeto só
      // permitia ela). Recalcula e tenta, na mesma tentativa, as que ainda não foram usadas.
      if (!fila.length) for (const outra of await candidatas(equipe, projeto)) if (!tentadas.has(outra.id)) fila.push(outra);
    }
    if (soCota && motivos.length) {
      const { proximaCota: quando } = await candidatas(equipe, projeto, { detalhar: true });
      throw semCota(quando ?? new Date(Date.now() + cfg.pausaLimiteMs).toISOString(), `todas as IAs que servem para ${equipe.nome} ficaram sem cota`);
    }
    throw new Error(motivos.length === 1 ? motivos[0] : `nenhuma IA conseguiu. ${motivos.join('; ')}`);
  };

  // Tarefa pausada por cota: continua sozinha na hora em que a primeira cota renovar.
  const pausar = (t, erro) => {
    t.estado = 'pausada';
    t.retomarEm = erro.retomarEm;
    t.pergunta = null;
    t.fase = `Pausada: ${erro.message}. Continua sozinha ${/às/.test(hora(erro.retomarEm)) ? 'em' : 'às'} ${hora(erro.retomarEm)}.`;
    vault.anexar(t, 'Pausada por falta de cota', t.fase);
  };

  const retomarPausadas = async (tarefas) => {
    let ativas = tarefas.filter((t) => EM_EXECUCAO.includes(t.estado)).length;
    for (const t of tarefas) {
      if (t.estado !== 'pausada' || !(Date.parse(t.retomarEm) <= Date.now())) continue;
      const temPlano = t.plano?.length;
      if (temPlano && ativas >= cfg.maxAtivas) continue;
      t.estado = temPlano ? 'executando' : 'fila';
      t.retomarEm = null;
      t.fase = 'A cota renovou. Continuando de onde parou.';
      await salvarTarefa(t);
      if (temPlano) {
        ativas += 1;
        executar_(t.id).catch((e) => console.error('[gestor]', e));
      }
    }
  };

  const tick = async () => {
    await retomarPausadas(await store.listar('tarefas'));
    if (planejando) return;
    const tarefas = await store.listar('tarefas');
    if (tarefas.filter((t) => EM_EXECUCAO.includes(t.estado)).length >= cfg.maxAtivas) return;
    const manuais = new Set((await store.listar('projetos')).filter((p) => p.modo === 'manual').map((p) => p.id));
    const proxima = tarefas.filter((t) => t.estado === 'fila' && !manuais.has(t.projetoId)).sort((a, b) => a.posicao - b.posicao)[0];
    if (!proxima) return;
    planejando = true;
    try {
      if (await planejar(proxima)) executar_(proxima.id).catch((e) => console.error('[gestor]', e));
    } finally {
      planejando = false;
    }
    setImmediate(tick);
  };

  // Equipes que o gestor pode usar num projeto: as gerais + as criadas sob medida para ele.
  const equipesDoProjeto = (equipes, projeto) => equipes.filter((e) => e.ativa !== false && (!e.projetoId || e.projetoId === projeto?.id));

  const slug = (t) =>
    String(t ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

  // O gestor pediu uma equipe que não existe: cria, só para este projeto, com a melhor IA ativa.
  const criarEquipeSobMedida = async (pedido, projeto, gestorIA) => {
    const nome = texto(pedido?.nome, 50);
    if (!nome) return null;
    let id = `${slug(nome)}-${slug(projeto?.nome).slice(0, 12)}`.replace(/-+$/, '');
    const existente = await store.obter('equipes', id);
    if (existente) return existente;
    const requer = pedido.requerEditar ? 'editar' : null;
    // Só as IAs em uso (e, se o projeto limita, só as dele), começando pela que o gestor está usando.
    const permitidas = projeto?.ias?.length ? new Set(projeto.ias) : null;
    const aptas = iasParaEquipe(await store.listar('ias'), { requer, permitidas }).sort((a, b) => (b.id === gestorIA) - (a.id === gestorIA));
    const equipe = {
      id,
      nome,
      desc: texto(pedido.desc, 300) || `Equipe criada pelo gestor para ${projeto?.nome ?? 'este projeto'}.`,
      // DNA obrigatório: se o gestor escreveu pouco, o prompt comportamental de base completa.
      ...(() => {
        const base = { nome, desc: texto(pedido.desc, 300), foco: texto(pedido.foco, 600), familia: texto(pedido.familia, 60), caminho: lista(pedido.caminho).map((x) => texto(x, 60)).filter(Boolean).slice(0, 5) };
        const dna = dnaDe(base);
        const escrito = texto(pedido.instrucoes, 6000);
        return { instrucoes: temDNA(escrito) ? escrito : [dna.instrucoes, escrito].filter(Boolean).join('\n\nInstruções extras:\n'), caminho: dna.caminho };
      })(),
      agentes: texto(pedido.agentes, 200),
      familia: texto(pedido.familia, 60),
      foco: texto(pedido.foco, 600),
      principal: aptas[0]?.id ?? gestorIA,
      reserva: aptas[1]?.id ?? '',
      area: slug(pedido.area || nome) || 'geral',
      requer,
      ativa: true,
      aprovacao: false,
      projetoId: projeto?.id ?? null,
      criadaPeloGestor: true,
      criada: agora(),
    };
    await store.salvar('equipes', equipe);
    vault.garantir([equipe]);
    bus.emitir({ tipo: 'equipe', equipe });
    bus.terminal('gestor', `● Equipe criada para ${projeto?.nome}: ${equipe.nome}`, 'ok');
    return equipe;
  };

  const planejar = async (t) => {
    const projeto = await store.obter('projetos', t.projetoId);
    const modo = projeto?.modo ?? 'automatico';
    t.estado = 'planejando';
    t.iniciada ??= agora();
    t.fase = 'O gestor está entendendo o pedido e escolhendo as equipes.';
    await salvarTarefa(t);

    if (!t.cwd && projeto?.maquinaId) t.cwd = projeto.pasta;
    if (!t.cwd) {
      const { cwd, branch } = await prepararWorktree(projeto, t, (m) => bus.terminal('gestor', m, 'aviso'));
      t.cwd = cwd;
      if (branch) t.branch = branch;
    }
    if (!fs.existsSync(vault.caminhoNota(t))) vault.criarNota(t, projeto);
    comunicar({ de: 'voce', para: 'gestor', tipo: 'pedido', resumo: t.titulo, texto: t.texto ?? t.titulo, tarefaId: t.id });

    const todas = await store.listar('equipes');
    const equipes = equipesDoProjeto(todas, projeto);
    const gestor = equipes.find((e) => e.id === 'gestor') ?? { id: 'gestor', nome: 'Gestor', principal: 'claude' };
    const disponiveis = equipes.filter((e) => !['gestor', 'avaliador', 'treinador'].includes(e.id));
    const existe = (ref) => disponiveis.some((e) => e.id === ref || slug(e.nome) === slug(ref));
    try {
      const { ia, json } = await comTrava('gestor', () =>
        // O plano decide o que vem depois: modelo padrão; forte se você já devolveu a tarefa.
        rodar(gestor, (iaAtual) => prompts.planejar({ tarefa: t, projeto, equipes: disponiveis, podeCriar: true, vault, ia: iaAtual }), {
          tarefa: t,
          cwd: t.cwd,
          projeto,
          nivel: t.devolucoes ? 'forte' : 'padrao',
          papel: 'planejar',
          esquema: prompts.ESQUEMA.planejar,
          validarJSON: (j) => validar.planejar(j, { existe, ids: disponiveis.map((e) => e.id) }),
        }),
      );

      // Equipes novas pedidas pelo gestor (em "com aprovação" só são criadas se você aprovar o plano).
      const novas = lista(json.novasEquipes).slice(0, 3);
      const porNome = new Map();
      const ids = new Map(disponiveis.map((e) => [e.id, e]));
      if (modo === 'automatico') {
        for (const pedido of novas) {
          const eq = await criarEquipeSobMedida(pedido, projeto, ia.id);
          if (eq) {
            ids.set(eq.id, eq);
            porNome.set(slug(pedido.nome), eq.id);
            porNome.set(slug(pedido.id), eq.id);
          }
        }
      } else t.equipesPropostas = novas.map((n) => ({ nome: texto(n.nome, 50), desc: texto(n.desc, 300), familia: texto(n.familia, 60), foco: texto(n.foco, 600), instrucoes: texto(n.instrucoes, 6000), caminho: lista(n.caminho).map((x) => texto(x, 60)).slice(0, 5), requerEditar: !!n.requerEditar, area: texto(n.area, 40) }));

      const resolver = (ref) => {
        if (ids.has(ref)) return ref;
        const s = slug(ref);
        if (porNome.has(s)) return porNome.get(s);
        const proposta = t.equipesPropostas?.find((n) => slug(n.nome) === s);
        if (proposta) return `nova:${proposta.nome}`;
        return [...ids.values()].find((e) => slug(e.nome) === s)?.id ?? null;
      };
      const etapas = lista(json.etapas)
        .map((e) => ({ equipe: resolver(e?.equipe), objetivo: texto(e?.objetivo, 400) || t.titulo, dificuldade: normalizarDificuldade(e?.dificuldade), estado: 'pend' }))
        .filter((e) => e.equipe)
        .slice(0, 8);
      if (!etapas.length) throw new Error('o plano não trouxe nenhuma etapa com equipe válida');
      // Pedido trivial (uma etapa simples): sem avaliador, para não gastar uma chamada só para conferir.
      t.trivial = /^trivial$/i.test(texto(json.complexidade, 20)) && etapas.length === 1 && etapas[0].dificuldade === 'simples' && !t.devolucoes;
      if (!t.trivial && todas.some((e) => e.id === 'avaliador' && e.ativa !== false)) etapas.push({ equipe: 'avaliador', objetivo: 'Conferir a entrega contra os critérios.', estado: 'pend' });

      t.plano = etapas;
      t.proposito = texto(json.tipo, 40);
      t.criterios = lista(json.criterios).map((c) => texto(c, 300)).filter(Boolean);
      t.planejadaPor = ia.nome;
      for (const e of etapas) comunicar({ de: 'gestor', para: e.equipe.replace(/^nova:/, ''), tipo: 'plano', resumo: e.objetivo, tarefaId: t.id });
      const resumoPlano = `${etapas.map((e, i) => `${i + 1}. **${e.equipe}**: ${e.objetivo}`).join('\n')}\n\nCritérios:\n${t.criterios.map((c) => `- ${c}`).join('\n')}`;
      vault.anexar(t, `Plano do gestor (${ia.nome}) · ${t.proposito || 'sem tipo'}`, `${texto(json.fase, 300)}\n\n${resumoPlano}`);

      if (modo === 'aprovacao') {
        t.estado = 'esperando';
        t.pergunta = { tipo: 'plano', etapa: -1, equipe: 'Gestor', texto: 'O gestor montou o plano. Aprove para começar ou peça para refazer.', opcoes: ['Aprovar plano', 'Refazer'] };
        t.fase = 'Plano pronto. Esperando a sua aprovação.';
      } else {
        t.estado = 'executando';
        t.fase = texto(json.fase, 300) || 'Plano pronto.';
      }
      await salvarTarefa(t);
      return t.estado === 'executando';
    } catch (erro) {
      if (erro.semCota) pausar(t, erro);
      else {
        t.estado = 'falhou';
        t.fase = `O gestor não conseguiu planejar: ${erro.message}.`;
        console.error(`[gestor] ${t.id} não planejou: ${erro.message}`);
      }
      await salvarTarefa(t);
      return false;
    }
  };

  const executar_ = async (id) => {
    if (rodando.has(id)) return;
    rodando.add(id);
    try {
      for (;;) {
        const t = await store.obter('tarefas', id);
        if (!t || t.estado !== 'executando') return;
        const i = t.plano.findIndex((e) => e.estado !== 'ok');
        if (i < 0) return finalizar(t);
        const etapa = t.plano[i];
        const equipe = await store.obter('equipes', etapa.equipe);
        const projeto = await store.obter('projetos', t.projetoId);

        if (!equipe || equipe.ativa === false) {
          Object.assign(etapa, { estado: 'ok', resumo: 'Equipe desativada; etapa pulada.' });
          await salvarTarefa(t);
          continue;
        }
        if (equipe.aprovacao && !etapa.liberada) {
          etapa.estado = 'espera';
          t.estado = 'esperando';
          t.pergunta = { tipo: 'aprovacao', etapa: i, equipe: equipe.nome, texto: `Liberar ${equipe.nome} para: ${etapa.objetivo}`, opcoes: ['Liberar', 'Pular'] };
          t.fase = `${equipe.nome} espera a sua liberação.`;
          await salvarTarefa(t);
          return;
        }

        etapa.estado = 'atual';
        t.fase = `${equipe.nome}: ${etapa.objetivo}`;
        await salvarTarefa(t);
        comunicar({ de: 'gestor', para: equipe.id, tipo: 'etapa', resumo: etapa.objetivo, tarefaId: t.id });

        const montar = (ia) =>
          equipe.id === 'avaliador'
            ? prompts.avaliar({ tarefa: t, projeto, equipe, vault, ia })
            : prompts.supervisor({ tarefa: t, projeto, equipe, etapa, indice: i, total: t.plano.length, vault, ia, nivel: escolha.nivel });

        // Modelo da etapa: pela dificuldade e pelo que a equipe já sabe. O avaliador usa o padrão
        // (o forte se alguma etapa precisou dele).
        const ehAvaliador = equipe.id === 'avaliador';
        const escolha = ehAvaliador
          ? t.plano.some((p) => p.nivel === 'forte') || t.escalou
            ? { nivel: 'forte', motivo: 'alguma etapa precisou do modelo forte' }
            : { nivel: 'padrao', motivo: 'conferência padrão' }
          : decidirNivel({ dificuldade: etapa.dificuldade, equipe, vault, escalada: etapa.escalada, objetivo: `${etapa.objetivo ?? ''} ${t.titulo ?? ''} ${t.texto ?? ''}`.slice(0, 1500) });
        let resultado;
        try {
          resultado = await comTrava(equipe.id, () =>
            rodar(equipe, montar, {
              tarefa: t,
              cwd: t.cwd ?? projeto?.pasta,
              projeto,
              nivel: escolha.nivel,
              papel: ehAvaliador ? 'avaliar' : 'executar',
              esquema: ehAvaliador ? prompts.ESQUEMA.avaliar : prompts.ESQUEMA.executar,
              validarJSON: ehAvaliador ? validar.avaliar : validar.executar,
            }),
          );
        } catch (erro) {
          const atual = await store.obter('tarefas', id);
          if (!atual) return;
          if (erro.semCota) {
            atual.plano[i].estado = 'pend';
            pausar(atual, erro);
            await salvarTarefa(atual);
            return;
          }
          atual.plano[i].estado = 'falhou';
          atual.estado = 'falhou';
          atual.fase = `${equipe.nome} não concluiu: ${erro.message}.`;
          vault.anexar(atual, `${equipe.nome} falhou`, erro.message);
          console.error(`[gestor] ${atual.id} · ${equipe.nome} falhou: ${erro.message}`);
          await salvarTarefa(atual);
          return;
        }

        const atual = await store.obter('tarefas', id);
        if (!atual || atual.estado !== 'executando') return;
        const passo = atual.plano[i];
        const { ia, json } = resultado;
        passo.ia = ia.nome;
        passo.iaId = ia.id;
        passo.nivel = resultado.nivel;
        passo.modelo = resultado.modelo;
        passo.nivelMotivo = resultado.nivel ? escolha.motivo : '';
        passo.resumo = texto(json.resumo);
        passo.resposta = texto(json.resposta, 20000);
        comunicar({ de: equipe.id, para: json.status === 'pergunta' ? 'voce' : 'gestor', tipo: equipe.id === 'avaliador' ? 'avaliacao' : json.status === 'pergunta' ? 'pergunta' : 'resultado', resumo: json.status === 'pergunta' ? texto(json.pergunta, 220) : passo.resumo, texto: passo.resumo, tarefaId: atual.id, ia: ia.nome });
        passo.arquivos = lista(json.arquivos).map((a) => texto(a, 300)).filter(Boolean);

        if (json.status === 'pergunta' && json.pergunta) {
          passo.estado = 'espera';
          atual.estado = 'esperando';
          atual.pergunta = { tipo: 'pergunta', etapa: i, equipe: equipe.nome, texto: texto(json.pergunta, 500), opcoes: lista(json.opcoes).map((o) => texto(o, 80)).filter(Boolean).slice(0, 4) };
          atual.fase = `${equipe.nome} precisa da sua resposta.`;
          vault.anexar(atual, `Pergunta de ${equipe.nome}`, atual.pergunta.texto);
          await salvarTarefa(atual);
          return;
        }
        if (json.status === 'falhou') {
          passo.estado = 'falhou';
          atual.estado = 'falhou';
          // A IA esbarrou num comando que não estava liberado (sem tela, ela não consegue pedir aprovação).
          const permissao = /aprova[cç][aã]o|permiss|not allowed|requires? approval|was (blocked|denied)|n[aã]o (foi )?(autorizad|permitid)/i.test(`${passo.resumo ?? ''} ${json.resposta ?? ''}`);
          atual.fase = `${equipe.nome} não conseguiu: ${passo.resumo || 'sem detalhes'}.${permissao ? ' A IA precisou rodar um comando que não está liberado. Libere em IAs → Comandos que as IAs podem rodar, e clique em Tentar de novo.' : ''}`;
          if (permissao) bus.terminal(equipe.id, '⚠ A IA tentou rodar um comando que não está liberado. Sem tela, ela não consegue pedir aprovação: libere o comando em IAs → Comandos que as IAs podem rodar.', 'aviso');
          vault.anexar(atual, `${equipe.nome} falhou (${ia.nome})`, passo.resumo);
          await salvarTarefa(atual);
          return;
        }

        passo.estado = 'ok';
        if (equipe.id === 'avaliador') {
          atual.avaliacao = {
            aprovado: json.aprovado !== false,
            resumo: passo.resumo,
            criterios: lista(json.criterios).map((c) => ({ texto: texto(c?.texto ?? c, 300), ok: c?.ok !== false, obs: texto(c?.obs, 400) })),
          };
          // Reprovou e alguma etapa rodou num modelo mais leve: refaz essas etapas uma vez no forte.
          const leves = atual.plano.filter((p) => p.equipe !== 'avaliador' && p.nivel && p.nivel !== 'forte');
          if (!atual.avaliacao.aprovado && !atual.escalou && leves.length && (await nivelAutomatico())) {
            atual.escalou = true;
            atual.avaliacoesAnteriores = [...(atual.avaliacoesAnteriores ?? []), { ...atual.avaliacao, em: agora() }];
            for (const p of leves) Object.assign(p, { estado: 'pend', escalada: true, anterior: { resumo: p.resumo, resposta: p.resposta, nivel: p.nivel, ia: p.ia } });
            passo.estado = 'pend';
            atual.avaliacao = null;
            atual.fase = 'O avaliador apontou problemas. Refazendo as etapas no modelo forte.';
            vault.anexar(atual, 'Subiu para o modelo forte', `O avaliador apontou: ${passo.resumo}\nAs etapas ${leves.map((p) => p.equipe).join(', ')} vão ser refeitas no modelo forte.`);
            comunicar({ de: 'avaliador', para: 'gestor', tipo: 'avaliacao', resumo: `Reprovou: ${passo.resumo}`, tarefaId: atual.id });
            for (const p of leves) comunicar({ de: 'gestor', para: p.equipe, tipo: 'etapa', resumo: `Refazer no modelo forte: ${p.objetivo}`, tarefaId: atual.id });
            await salvarTarefa(atual);
            continue;
          }
        }
        // Aprendizado em três camadas (conceito, método, exemplo). Texto solto vira só exemplo.
        const aprendizado = json.aprendizado && typeof json.aprendizado === 'object' ? json.aprendizado : texto(json.aprendizado, 1500);
        if (aprendizado && (typeof aprendizado === 'string' || texto(aprendizado.titulo) || texto(aprendizado.conceito))) {
          const rel = vault.registrarAprendizado({ area: equipe.area, aprendizado, tarefa: atual, equipe: equipe.nome, caminho: equipe.caminho ?? [] });
          if (rel) atual.aprendizados = [...new Set([...(atual.aprendizados ?? []), rel])];
        }
        vault.anexar(
          atual,
          `${equipe.nome} (${ia.nome})`,
          `${passo.resumo}${passo.arquivos.length ? `\n\nArquivos: ${passo.arquivos.map((a) => `\`${a}\``).join(', ')}` : ''}`,
        );
        if (ehAvaliador && atual.avaliacao.aprovado === false) await corrigirSozinho(atual, i);
        await salvarTarefa(atual);
      }
    } finally {
      rodando.delete(id);
      setImmediate(tick);
    }
  };

  // O avaliador reprovou: antes de chegar a você, a equipe que fez o trabalho recebe o que faltou e corrige.
  // O que faltou também entra nos "erros comuns" da equipe, que aparecem nos próximos pedidos e alimentam o treino.
  const corrigirSozinho = async (t, i) => {
    const pontos = t.avaliacao.criterios.filter((c) => !c.ok).map((c) => c.texto);
    if (!pontos.length) pontos.push(t.avaliacao.resumo || 'a entrega não atende ao pedido');
    const autor = [...t.plano.slice(0, i)].reverse().find((p) => p.equipe !== 'avaliador' && !p.equipe.startsWith('nova:') && p.estado === 'ok');
    const equipe = autor && (await store.obter('equipes', autor.equipe));
    if (equipe?.area)
      vault.acumularLista({
        area: equipe.area,
        nome: `erros-comuns-${equipe.area}`,
        titulo: `Erros comuns: ${equipe.nome}`,
        intro: 'O que o avaliador e os treinos apontaram que faltou nas entregas desta equipe. Evite.',
        itens: pontos,
        equipe: equipe.id,
        origem: t.id,
      });
    const feitas = t.correcoes ?? 0;
    if (!equipe || equipe.ativa === false || feitas >= CORRECOES_AUTO) return false;
    t.correcoes = feitas + 1;
    t.avaliacoesAnteriores = [...(t.avaliacoesAnteriores ?? []), { ...t.avaliacao, em: agora() }].slice(-6);
    const apontamentos = t.avaliacao.criterios.filter((c) => !c.ok).map((c) => ({ texto: c.texto, obs: c.obs }));
    comunicar({ de: 'avaliador', para: 'gestor', tipo: 'avaliacao', resumo: `Reprovou: ${texto(t.avaliacao.resumo, 200)}`, tarefaId: t.id });
    comunicar({ de: 'gestor', para: equipe.id, tipo: 'etapa', resumo: `Corrigir: ${texto(pontos.join('; '), 200)}`, tarefaId: t.id });
    t.plano.push(
      {
        equipe: equipe.id,
        objetivo: texto(`Corrigir o que o avaliador apontou: ${pontos.join('; ')}`, 400),
        estado: 'pend',
        correcao: true,
        escalada: true,
        apontamentos: apontamentos.length ? apontamentos : [{ texto: pontos[0], obs: t.avaliacao.resumo }],
        parecer: texto(t.avaliacao.resumo, 1500),
        entregaAnterior: texto(autor.resposta || autor.resumo, 8000),
      },
      { equipe: 'avaliador', objetivo: 'Conferir de novo depois da correção.', estado: 'pend' },
    );
    t.fase = `O avaliador apontou problemas. ${equipe.nome} está corrigindo sozinha (correção ${t.correcoes} de ${CORRECOES_AUTO}).`;
    vault.anexar(t, `Correção automática ${t.correcoes}: ${equipe.nome}`, pontos.map((p) => `- ${p}`).join('\n'));
    return true;
  };

  // Tarefa que chegou a você com problemas apontados (por exemplo, feita numa versão antiga): manda a equipe corrigir
  // agora, sem refazer o plano. A equipe recebe os apontamentos e a entrega dela; o avaliador confere de novo.
  const corrigir = async (id) => {
    const t = await exigir(id);
    if (t.estado !== 'revisao' || t.avaliacao?.aprovado !== false) throw Object.assign(new Error('Só dá para mandar corrigir uma entrega que o avaliador reprovou.'), { status: 409 });
    t.correcoes = Math.min(t.correcoes ?? 0, CORRECOES_AUTO - 1);
    if (!(await corrigirSozinho(t, t.plano.length))) throw Object.assign(new Error('Não achei a equipe que fez a entrega para corrigir. Use Devolver para as equipes.'), { status: 409 });
    t.estado = 'executando';
    t.avaliacao = null;
    await salvarTarefa(t);
    executar_(t.id).catch((e) => console.error('[gestor]', e));
    return t;
  };

  const finalizar = async (t) => {
    comunicar({ de: 'gestor', para: 'voce', tipo: 'entrega', resumo: t.avaliacao?.aprovado === false ? 'O avaliador apontou problemas' : 'Pronta para a sua revisão', tarefaId: t.id });
    // Desempenho real de cada IA por equipe: o avaliador aprovou ou apontou problema na entrega.
    try {
      for (const p of t.plano ?? []) {
        if (!p.iaId || p.equipe === 'avaliador') continue;
        const eq = await store.obter('equipes', p.equipe);
        if (!eq) continue;
        const d = { aprovadas: 0, problemas: 0, ...(eq.desempenhoReal?.[p.iaId] ?? {}), nome: p.ia };
        if (t.avaliacao?.aprovado === false) d.problemas += 1;
        else d.aprovadas += 1;
        eq.desempenhoReal = { ...(eq.desempenhoReal ?? {}), [p.iaId]: d };
        await store.salvar('equipes', eq);
        bus.emitir({ tipo: 'equipe', equipe: eq });
      }
    } catch (e) {
      console.error('[gestor] desempenho:', e.message);
    }
    t.estado = 'revisao';
    const depois = (n) => (n ? ` depois de ${n} ${n === 1 ? 'correção automática' : 'correções automáticas'}` : '');
    t.fase =
      t.avaliacao?.aprovado === false
        ? `O avaliador ainda aponta problemas${depois(t.correcoes)}. Revise antes de aprovar.`
        : t.trivial
          ? 'Resposta pronta (pedido simples, sem avaliador). Falta a sua revisão.'
          : t.escalou && !t.correcoes
            ? 'Aprovada pelo avaliador depois de refazer no modelo forte. Falta a sua revisão.'
            : `Aprovada pelo avaliador${depois(t.correcoes)}. Falta a sua revisão.`;
    t.prontaEm = agora();
    vault.anexar(t, 'Pronta para revisão', t.fase);
    await salvarTarefa(t);
  };

  const exigir = async (id) => {
    const t = await store.obter('tarefas', id);
    if (!t) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
    return t;
  };

  const responder = async (id, resposta) => {
    const t = await exigir(id);
    if (!t.pergunta) throw Object.assign(new Error(t.estado === 'executando' ? 'Essa pergunta já foi respondida: a equipe já está trabalhando com a resposta.' : 'Essa tarefa não está esperando resposta.'), { status: 409 });
    const { tipo, etapa: i, texto: pergunta, equipe } = t.pergunta;
    if (tipo === 'plano') {
      t.pergunta = null;
      if (/^aprovar/i.test(resposta)) {
        const projeto = await store.obter('projetos', t.projetoId);
        const gestor = await store.obter('equipes', 'gestor');
        for (const passo of t.plano) {
          if (!passo.equipe.startsWith('nova:')) continue;
          const proposta = t.equipesPropostas?.find((n) => `nova:${n.nome}` === passo.equipe);
          const eq = proposta && (await criarEquipeSobMedida(proposta, projeto, gestor?.principal));
          passo.equipe = eq?.id ?? passo.equipe;
        }
        t.estado = 'executando';
        t.fase = 'Plano aprovado. As equipes começaram.';
        vault.anexar(t, 'Plano aprovado pelo usuário', '');
        await salvarTarefa(t);
        executar_(id).catch((e) => console.error('[gestor]', e));
        return t;
      }
      const motivo = resposta.replace(/^refazer:?\s*/i, '');
      vault.anexar(t, 'Plano recusado pelo usuário', motivo || 'Refazer o plano.');
      Object.assign(t, { estado: 'fila', plano: [], equipesPropostas: [], fase: 'O gestor vai refazer o plano.' });
      await salvarTarefa(t);
      setImmediate(tick);
      return t;
    }
    const etapa = t.plano[i];
    if (tipo === 'aprovacao') {
      if (/^pular/i.test(resposta)) Object.assign(etapa, { estado: 'ok', resumo: 'Pulada por você.' });
      else Object.assign(etapa, { estado: 'pend', liberada: true });
    } else {
      etapa.estado = 'pend';
      t.respostas = [...(t.respostas ?? []), { equipe, pergunta, resposta, em: agora() }];
      vault.anexar(t, 'Resposta do usuário', `**${pergunta}**\n${resposta}`);
    }
    t.pergunta = null;
    t.estado = 'executando';
    await salvarTarefa(t);
    executar_(id).catch((e) => console.error('[gestor]', e));
    return t;
  };

  const aprovar = async (id) => {
    const t = await exigir(id);
    for (const rel of t.aprendizados ?? []) vault.promover(rel);
    t.estado = 'concluida';
    t.concluida = agora();
    t.fase = t.branch ? `Concluída. A branch ${t.branch} está pronta para o merge.` : 'Concluída.';
    vault.anexar(t, 'Aprovada pelo usuário', t.aprendizados?.length ? `Aprendizados promovidos para validado:\n${t.aprendizados.map((a) => `- ${a}`).join('\n')}` : '');
    return salvarTarefa(t);
  };

  const devolver = async (id, motivo) => {
    const t = await exigir(id);
    const tarefas = await store.listar('tarefas');
    vault.anexar(t, 'Devolvida pelo usuário', motivo || 'Sem motivo informado.');
    Object.assign(t, {
      estado: 'fila',
      posicao: Math.min(0, ...tarefas.map((x) => x.posicao ?? 0)) - 1,
      plano: [],
      avaliacao: null,
      pergunta: null,
      devolucoes: (t.devolucoes ?? 0) + 1,
      correcoes: 0,
      retomarEm: null,
      fase: 'Devolvida. Volta ao topo da fila do gestor.',
    });
    await salvarTarefa(t);
    setImmediate(tick);
    return t;
  };

  const cancelar = async (id) => {
    const t = await exigir(id);
    t.estado = 'cancelada';
    t.pergunta = null;
    t.retomarEm = null;
    t.fase = 'Cancelada por você.';
    vault.anexar(t, 'Cancelada', '');
    return salvarTarefa(t);
  };

  const retomar = async (id) => {
    const t = await exigir(id);
    if (!['falhou', 'cancelada', 'pausada'].includes(t.estado)) throw Object.assign(new Error('Só dá para retomar tarefa que falhou, foi cancelada ou está pausada.'), { status: 409 });
    t.retomarEm = null;
    const temPlano = t.plano?.length;
    for (const e of t.plano ?? []) if (e.estado === 'falhou' || e.estado === 'atual') e.estado = 'pend';
    t.estado = temPlano ? 'executando' : 'fila';
    t.fase = 'Retomada.';
    await salvarTarefa(t);
    if (temPlano) executar_(id).catch((e) => console.error('[gestor]', e));
    else setImmediate(tick);
    return t;
  };

  // Pedido de equipe nova: o gestor analisa (duplicidade, nome, DNA, caminho, recomendação de treino).
  // Não cria nada: devolve a proposta para você confirmar na tela.
  const analisarEquipe = async (pedido) => {
    const p = { nome: texto(pedido.nome, 60), desc: texto(pedido.desc, 300), foco: texto(pedido.foco, 600), familia: texto(pedido.familia, 60), instrucoes: texto(pedido.instrucoes, 4000) };
    if (!p.nome && !p.desc) throw Object.assign(new Error('Diga ao menos o nome ou o que a equipe faz.'), { status: 400 });
    const todas = (await store.listar('equipes')).filter((e) => !e.fixa);
    const gestorEq = (await store.obter('equipes', 'gestor')) ?? { id: 'gestor', nome: 'Gestor' };
    let json = null;
    let ia = null;
    try {
      ({ ia, json } = await comTrava('gestor', () => rodar(gestorEq, () => prompts.analisarEquipe({ pedido: p, equipes: todas }), { nivel: 'padrao', papel: 'analisar-equipe', esquema: prompts.ESQUEMA.analisarEquipe, validarJSON: validar.analisarEquipe })));
    } catch (e) {
      console.warn('[gestor] análise de equipe sem IA:', e.message);
    }
    // Sem IA disponível, a proposta sai do DNA padrão (referências do assunto), para nunca nascer vazia.
    const dna = dnaDe({ ...p, nome: texto(json?.nome, 60) || p.nome, caminho: lista(json?.caminho).map((x) => texto(x, 60)).filter(Boolean).slice(0, 5) });
    const dup = json?.duplicada?.id ? todas.find((e) => e.id === json.duplicada.id || slugEquipe(e.nome) === slugEquipe(json.duplicada.id)) : null;
    const instrucoes = texto(json?.instrucoes, 8000);
    const nivel = ['leve', 'medio', 'profundo'].includes(json?.treino?.nivel) ? json.treino.nivel : 'medio';
    return {
      porIA: ia?.nome ?? null,
      duplicada: dup ? { id: dup.id, nome: dup.nome, motivo: texto(json.duplicada.motivo, 400) } : null,
      nome: texto(json?.nome, 60) || p.nome,
      desc: texto(json?.desc, 300) || p.desc,
      familia: texto(json?.familia, 60) || p.familia,
      foco: texto(json?.foco, 600) || p.foco,
      contextos: lista(json?.contextos).map((c) => texto(c, 40)).filter(Boolean).slice(0, 10),
      caminho: dna.caminho,
      instrucoes: temDNA(instrucoes) ? instrucoes : [dna.instrucoes, p.instrucoes].filter(Boolean).join('\n\nInstruções extras:\n'),
      requerEditar: !!json?.requerEditar,
      treino: json?.treino ? { recomendado: !!json.treino.recomendado, nivel, motivo: texto(json.treino.motivo, 400) } : { recomendado: false, nivel, motivo: 'Sem análise da IA: as instruções de base cobrem o padrão do assunto. Treine se as primeiras entregas não ficarem boas.' },
    };
  };
  const slugEquipe = (t) => slug(t);

  // Você revisou a entrega e quer questionar: a pergunta vai para uma equipe da tarefa (ou para o gestor)
  // e a resposta aparece na própria página da tarefa. Não muda o estado da tarefa.
  const questionar = async (id, { para, texto: pergunta }) => {
    const t = await exigir(id);
    const q = texto(pergunta, 4000);
    if (!q) throw Object.assign(new Error('Escreva a pergunta.'), { status: 400 });
    const equipe = await store.obter('equipes', para || 'gestor');
    if (!equipe) throw Object.assign(new Error('Equipe não encontrada.'), { status: 404 });
    const projeto = await store.obter('projetos', t.projetoId);
    const item = { id: `q${Date.now().toString(36)}`, para: equipe.id, paraNome: equipe.nome, pergunta: q, em: agora(), estado: 'respondendo' };
    t.conversa = [...(t.conversa ?? []), item];
    vault.anexar(t, `Pergunta para ${equipe.nome}`, q);
    await salvarTarefa(t);
    comunicar({ de: 'voce', para: equipe.id, tipo: 'pergunta', resumo: q, tarefaId: t.id });

    const anteriores = (t.conversa ?? []).filter((c) => c.para === equipe.id && c.estado === 'respondida');
    const entregaDela = (equipe.id === 'gestor' ? t.plano ?? [] : (t.plano ?? []).filter((p) => p.equipe === equipe.id))
      .map((p) => `${equipe.id === 'gestor' ? `[${p.equipe}] ` : ''}${p.resumo ?? ''}${p.resposta ? `\n${p.resposta}` : ''}`)
      .join('\n\n');
    const { nivel } = decidirNivel({ dificuldade: 'media', equipe, vault, objetivo: q });
    const atualizarItem = async (mudanca) => {
      const atual = await store.obter('tarefas', id);
      if (!atual) return;
      const alvo = (atual.conversa ?? []).find((c) => c.id === item.id);
      if (alvo) Object.assign(alvo, mudanca);
      await salvarTarefa(atual);
    };
    comTrava(equipe.id, () =>
      rodar(equipe, (ia) => prompts.questionar({ tarefa: t, projeto, equipe, pergunta: q, anteriores, entregaDela, vault, ia }), { tarefa: t, cwd: t.cwd ?? projeto?.pasta, projeto, nivel, papel: 'questionar', esquema: prompts.ESQUEMA.questionar, validarJSON: validar.questionar }),
    )
      .then(async ({ ia, json, nivel: usado, modelo }) => {
        const resposta = texto(json.resposta, 20000) || texto(json.resumo, 2000);
        await atualizarItem({ estado: 'respondida', resposta, resumo: texto(json.resumo, 400), arquivos: lista(json.arquivos).map((a) => texto(a, 300)).filter(Boolean), ia: ia.nome, nivel: usado, modelo, respondida: agora() });
        const atual = await store.obter('tarefas', id);
        if (atual) vault.anexar(atual, `Resposta de ${equipe.nome} (${ia.nome})`, resposta);
        comunicar({ de: equipe.id, para: 'voce', tipo: 'resposta', resumo: texto(json.resumo, 220) || resposta.slice(0, 200), texto: resposta, tarefaId: id, ia: ia.nome });
      })
      .catch((e) => atualizarItem({ estado: 'falhou', erro: e.message }));
    return item;
  };

  // ------------------------------------------------------------ ambiente de teste
  // "Inicializar teste": a equipe que fez a entrega prepara (dependências, build, banco, usuário de teste) e diz como
  // subir; o app sobe, confere que o endereço responde e mostra link, credenciais e o roteiro para você testar.
  const canalTeste = (id) => `teste:${id}`;
  const atualizarTeste = async (id, mudanca) => {
    const t = await store.obter('tarefas', id);
    if (!t) return null;
    t.teste = { ...(t.teste ?? {}), ...mudanca };
    await salvarTarefa(t);
    return t;
  };
  const dentroDe = (base, rel) => {
    const alvo = path.resolve(base, rel || '.');
    return alvo === base || alvo.startsWith(base + path.sep) ? alvo : base;
  };

  const testar = async (id) => {
    const t = await exigir(id);
    const projeto = await store.obter('projetos', t.projetoId);
    if (await maquinaDe(projeto)) throw Object.assign(new Error('Este projeto roda numa máquina remota; o teste automático por enquanto só funciona neste computador.'), { status: 409 });
    const cwd = path.resolve(t.cwd ?? projeto?.pasta ?? '');
    if (!cwd || !fs.existsSync(cwd)) throw Object.assign(new Error('Não achei a pasta do projeto para testar.'), { status: 409 });
    if (['preparando', 'subindo'].includes(t.teste?.estado) || (t.teste?.estado === 'corrigindo' && !t.teste.emFluxo)) return t;
    testeLocal.parar(id);
    const autor = [...(t.plano ?? [])].reverse().find((p) => p.equipe !== 'avaliador' && p.estado === 'ok');
    const equipe = (autor && (await store.obter('equipes', autor.equipe))) || (await store.obter('equipes', 'gestor'));
    if (!equipe) throw Object.assign(new Error('Nenhuma equipe para preparar o teste.'), { status: 409 });
    const porta = await testeLocal.portaLivre(5180);
    bus.terminal(canalTeste(id), `▶ ${equipe.nome} está preparando o ambiente de teste em ${cwd}`, 'cmd');
    const fluxo = t.teste?.emFluxo ? { emFluxo: true, fluxo: t.teste.fluxo, ciclos: t.teste.ciclos } : { ciclos: 0 };
    t.teste = { estado: 'preparando', fase: `${equipe.nome} está preparando o ambiente (dependências, build, dados de teste).`, equipe: equipe.nome, porta, em: agora(), historico: t.teste?.historico ?? [], ...fluxo };
    await salvarTarefa(t);
    comunicar({ de: 'voce', para: equipe.id, tipo: 'pedido', resumo: 'Preparar o ambiente de teste', tarefaId: id });

    comTrava(equipe.id, () =>
      rodar(equipe, (ia) => prompts.prepararTeste({ tarefa: t, projeto, equipe, vault, ia, porta, cwd }), { tarefa: t, cwd, projeto, nivel: 'padrao', papel: 'teste', esquema: prompts.ESQUEMA.teste, validarJSON: validar.teste }),
    )
      .then(async ({ json, ia }) => {
        comunicar({ de: equipe.id, para: 'voce', tipo: 'resposta', resumo: texto(json.resumo, 200) || 'Ambiente preparado', tarefaId: id, ia: ia.nome });
        const base = {
          tipo: json.tipo ?? 'servidor',
          resumo: texto(json.resumo, 600),
          credenciais: lista(json.credenciais).map((c) => ({ rotulo: texto(c?.rotulo, 60) || 'Dado', valor: texto(c?.valor, 300) })).filter((c) => c.valor),
          passos: lista(json.passos).map((p) => texto(p, 400)).filter(Boolean).slice(0, 15),
          arquivos: lista(json.arquivos).map((a) => texto(a, 300)).filter(Boolean).slice(0, 40),
          ia: ia.nome,
        };
        if (json.status === 'falhou') return atualizarTeste(id, { ...base, estado: 'falhou', fase: `${equipe.nome} não conseguiu preparar: ${base.resumo}`, semCorrecao: true });
        if (base.tipo === 'nenhum') return atualizarTeste(id, { ...base, estado: 'pronto', fase: 'Não há o que subir: siga o roteiro abaixo para testar.' });
        if (base.tipo === 'estatico' || base.tipo === 'arquivos') {
          const primeiro = base.arquivos[0] ?? '';
          return atualizarTeste(id, { ...base, estado: 'no-ar', pasta: cwd, url: base.tipo === 'estatico' ? `http://127.0.0.1:${cfg.porta}/teste/${id}/${primeiro.split(/[\\/]/).map(encodeURIComponent).join('/')}` : '', fase: base.tipo === 'estatico' ? 'Pronto. Abra o link para testar.' : 'Pronto. Os arquivos estão abaixo.' });
        }
        // Servidor: o app sobe os processos e espera o endereço responder.
        const processos = lista(json.processos)
          .filter((p) => texto(p?.comando))
          .slice(0, 4)
          .map((p, i) => ({ nome: texto(p.nome, 30) || `processo ${i + 1}`, comando: texto(p.comando, 600), pasta: dentroDe(cwd, p.pasta), env: Object.fromEntries(Object.entries(p.env && typeof p.env === 'object' ? p.env : {}).slice(0, 30).map(([k, v]) => [String(k).slice(0, 80), String(v).slice(0, 500)])) }));
        const url = texto(json.url, 400);
        await atualizarTeste(id, { ...base, estado: 'subindo', url, processos: processos.map((p) => ({ nome: p.nome, comando: p.comando })), fase: 'Subindo o servidor…' });
        let caiu = false;
        testeLocal.iniciar(id, processos, {
          env: { PORT: String(porta) },
          aoLinha: (l, tipo) => bus.terminal(canalTeste(id), l, tipo),
          aoSair: async (nome, codigo) => {
            caiu = true;
            const atual = await store.obter('tarefas', id);
            if (atual?.teste && ['subindo', 'no-ar'].includes(atual.teste.estado)) {
              testeLocal.parar(id);
              await falhouTeste(id, `${nome} parou (código ${codigo})`);
            }
          },
        });
        const ok = await testeLocal.esperarNoAr(url, { ms: 240_000, vivo: () => !caiu && testeLocal.rodando(id) });
        if (ok) {
          bus.terminal(canalTeste(id), `✓ No ar: ${url}`, 'ok');
          await atualizarTeste(id, { estado: 'no-ar', fase: 'No ar. Abra o link e siga o roteiro.' });
        } else if (!caiu && testeLocal.rodando(id)) {
          testeLocal.parar(id);
          await falhouTeste(id, `o endereço ${url} não respondeu em 4 minutos`);
        }
      })
      .catch((e) => atualizarTeste(id, { estado: 'falhou', fase: `Não deu para preparar o teste: ${e.message}` }));
    return t;
  };

  // ------------------------------------------------------------ fluxo de correção do teste
  // O teste não subiu: o gestor faz a triagem; a equipe que fez e a Debug diagnosticam em paralelo, sem mexer em nada;
  // o gestor confere se os diagnósticos batem e escreve a ordem de correção; quem fez corrige; o app sobe de novo;
  // Código limpo revisa o que mudou; sobe de novo; o avaliador confere o fluxo. Só então volta para você.
  // A causa e a correção viram conhecimento da Debug (ela se especializa em correção direta).
  const CICLOS_CORRECAO = 2;
  const ACABOU = ['no-ar', 'falhou', 'pronto', 'parado'];

  const falhouTeste = async (id, motivo) => {
    const t = await atualizarTeste(id, { estado: 'falhou', fase: `Não subiu: ${motivo}.` });
    if (!t || t.teste.emFluxo || t.teste.semCorrecao) return;
    if ((t.teste.ciclos ?? 0) >= CICLOS_CORRECAO) return;
    corrigirTeste(id, { automatico: true }).catch((e) => console.error('[gestor] correção:', e.message));
  };

  // Sobe o teste de novo e espera terminar (no ar ou falhou).
  const subirEsperar = async (id) => {
    await testar(id);
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const t = await store.obter('tarefas', id);
      if (!t?.teste) return null;
      if (ACABOU.includes(t.teste.estado)) return t.teste;
    }
    return { estado: 'falhou', fase: 'demorou demais para subir' };
  };

  const corrigirTeste = async (id, { automatico = false } = {}) => {
    const t = await exigir(id);
    if (!t.teste || t.teste.emFluxo || ['preparando', 'subindo', 'corrigindo'].includes(t.teste.estado)) return t;
    const projeto = await store.obter('projetos', t.projetoId);
    const cwd = path.resolve(t.cwd ?? projeto?.pasta ?? '');
    const autorPasso = [...(t.plano ?? [])].reverse().find((p) => p.equipe !== 'avaliador' && p.estado === 'ok');
    const gestorEq = await store.obter('equipes', 'gestor');
    const autor = (autorPasso && (await store.obter('equipes', autorPasso.equipe))) || gestorEq;
    const avaliador = await store.obter('equipes', 'avaliador');
    const todas = (await store.listar('equipes')).filter((e) => e.ativa !== false && !['gestor', 'avaliador', 'treinador'].includes(e.id));
    const porId = new Map(todas.map((e) => [e.id, e]));
    const acharPorRef = (ref) => porId.get(ref) ?? todas.find((e) => slug(e.nome) === slug(String(ref ?? '')));
    const ehDebug = (e) => /debug/i.test(`${e.id} ${e.nome}`);
    const ehLimpo = (e) => /c[oó]digo[\s-]*limpo|clean/i.test(`${e.id} ${e.nome}`);
    const ciclo = (t.teste.ciclos ?? 0) + 1;
    const erro = { motivo: t.teste.fase ?? 'o ambiente de teste não subiu', log: (bus.todasLinhas?.()[canalTeste(id)] ?? []).slice(-80).map((l) => l.texto).join('\n'), processos: t.teste.processos ?? [] };

    // Até a triagem só existe a triagem: o resto do fluxo é o gestor que decide, para este erro.
    await atualizarTeste(id, { estado: 'corrigindo', emFluxo: true, ciclos: ciclo, fluxo: { ciclo, passos: [{ id: 'triagem', nome: 'Triagem e plano', equipe: 'Gestor', estado: 'pend', resumo: '' }] }, fase: `${automatico ? 'Não subiu. ' : ''}Fluxo de correção ${ciclo} de ${CICLOS_CORRECAO}: o gestor está analisando o erro e montando o plano.` });
    bus.terminal(canalTeste(id), `↻ Fluxo de correção ${ciclo}: ${erro.motivo}`, 'aviso');

    const marcar = async (pid, estado, resumo = '', fase = null) => {
      const atual = await store.obter('tarefas', id);
      if (!atual?.teste?.fluxo) return;
      const p = atual.teste.fluxo.passos.find((x) => x.id === pid);
      if (p) Object.assign(p, { estado, resumo: texto(resumo, 500) || p.resumo });
      if (fase) atual.teste.fase = fase;
      await salvarTarefa(atual);
    };
    const definirPassos = async (passos) => {
      const atual = await store.obter('tarefas', id);
      if (!atual?.teste?.fluxo) return;
      const triagem = atual.teste.fluxo.passos.find((p) => p.id === 'triagem');
      atual.teste.fluxo.passos = [triagem, ...passos.map((p) => ({ ...p, estado: 'pend', resumo: '' }))];
      await salvarTarefa(atual);
    };
    const chamar = (equipe, montar, opts) => comTrava(equipe.id, () => rodar(equipe, montar, { tarefa: t, cwd, projeto, ...opts }));
    const terminar = (mudanca) => atualizarTeste(id, { emFluxo: false, ...mudanca });
    const papelDe = (e) => (e.id === autor.id ? 'autor' : ehDebug(e) ? 'debug' : 'especialista');

    (async () => {
      // 1. Triagem e plano do fluxo
      await marcar('triagem', 'atual');
      comunicar({ de: 'voce', para: 'gestor', tipo: 'pedido', resumo: `Erro no teste: ${texto(erro.motivo, 160)}`, tarefaId: id });
      const { json: triagem } = await chamar(gestorEq, (ia) => prompts.triagemErro({ tarefa: t, projeto, vault, ia, cwd, erro, equipes: todas, autor }), { nivel: 'forte', papel: 'triagem', esquema: prompts.ESQUEMA_FLUXO.triagem, validarJSON: validar.triagem });

      // O plano do gestor, conferido: só equipes que existem; sem plano, o padrão (quem fez + Debug, se houver).
      const f = triagem.fluxo && typeof triagem.fluxo === 'object' ? triagem.fluxo : {};
      let diagnosticadores = [...new Set(lista(f.diagnosticar_com).map(acharPorRef).filter(Boolean))].slice(0, 3);
      if (!diagnosticadores.length) diagnosticadores = [autor, todas.find((e) => ehDebug(e) && e.id !== autor.id)].filter(Boolean);
      if (!diagnosticadores.length) diagnosticadores = [gestorEq];
      const corretor = acharPorRef(f.corrigir_com) ?? (autor.id !== 'gestor' ? autor : diagnosticadores[0]);
      const revisores = [...new Set(lista(f.revisar_com).map(acharPorRef).filter(Boolean))].filter((e) => e.id !== corretor.id).slice(0, 2);
      const varios = diagnosticadores.length > 1;
      await definirPassos([
        { id: 'diagnostico', nome: varios ? 'Diagnóstico em paralelo' : 'Diagnóstico', equipe: diagnosticadores.map((e) => e.nome).join(' + ') },
        ...(varios ? [{ id: 'consenso', nome: 'Consenso da causa', equipe: 'Gestor' }] : []),
        { id: 'correcao', nome: 'Correção', equipe: corretor.nome },
        { id: 'subir', nome: 'Subir de novo', equipe: 'App' },
        ...revisores.map((e, k) => ({ id: `revisao${k}`, nome: ehLimpo(e) ? 'Código limpo' : `Revisão: ${e.nome}`, equipe: e.nome })),
        ...(revisores.length ? [{ id: 'subir2', nome: 'Subir depois das revisões', equipe: 'App' }] : []),
        ...(avaliador ? [{ id: 'avaliacao', nome: 'Avaliação do fluxo', equipe: avaliador.nome }] : []),
      ]);
      await marcar('triagem', 'ok', `${triagem.camada ?? ''}: ${triagem.sintoma ?? ''}${f.justificativa ? ` · Plano: ${f.justificativa}` : ''}`, `Triagem: problema de ${triagem.camada ?? 'origem a confirmar'}. ${diagnosticadores.map((e) => e.nome).join(' e ')} ${varios ? 'estão diagnosticando em paralelo' : 'está diagnosticando'}.`);
      vault.anexar(t, `Fluxo de correção ${ciclo}: plano do gestor`, `Camada: ${triagem.camada}\nSintoma: ${triagem.sintoma}\nDiagnóstico: ${diagnosticadores.map((e) => e.nome).join(', ')}\nCorreção: ${corretor.nome}\nRevisões: ${revisores.map((e) => e.nome).join(', ') || 'nenhuma'}\nPor quê: ${f.justificativa ?? '-'}`);

      // 2. Diagnóstico (em paralelo, até 2 rodadas) e 3. consenso
      const diagnosticar = (equipe, outros, falta) => {
        comunicar({ de: 'gestor', para: equipe.id, tipo: 'etapa', resumo: `Diagnosticar: ${texto(triagem.sintoma, 140)}`, tarefaId: id });
        return chamar(equipe, (ia) => prompts.diagnosticoErro({ tarefa: t, projeto, equipe, vault, ia, cwd, erro, triagem, papel: papelDe(equipe), outros, falta }), { nivel: 'forte', papel: 'diagnostico', esquema: prompts.ESQUEMA_FLUXO.diagnostico, validarJSON: validar.diagnostico }).then(({ json }) => {
          comunicar({ de: equipe.id, para: 'gestor', tipo: 'resultado', resumo: texto(json.causa_raiz, 200), tarefaId: id });
          return { equipe: equipe.nome, id: equipe.id, papel: papelDe(equipe), json };
        });
      };
      let ordem = null;
      let diags = [];
      let falta = [];
      for (let rodada = 1; rodada <= (varios ? 2 : 1) && !ordem; rodada++) {
        await marcar('diagnostico', 'atual', '', rodada > 1 ? 'Os diagnósticos não bateram. Segunda rodada: cada equipe confere o que as outras acharam.' : null);
        const anteriores = diags;
        diags = await Promise.all(diagnosticadores.map((e) => diagnosticar(e, anteriores.filter((d) => d.id !== e.id), falta)));
        await marcar('diagnostico', 'ok', diags.map((d) => `${d.equipe}: ${d.json.causa_raiz} (${d.json.confianca ?? '?'}%)`).join(' · '), varios ? 'O gestor está conferindo se os diagnósticos batem.' : null);
        if (!varios) {
          const d = diags[0].json;
          ordem = { consenso: true, causa_raiz: d.causa_raiz, correcao: lista(d.correcao), arquivos: lista(d.arquivos), criterios: lista(d.como_confirmar) };
          break;
        }
        await marcar('consenso', 'atual');
        const { json: c } = await chamar(gestorEq, (ia) => prompts.consensoErro({ tarefa: t, vault, ia, erro, triagem, diagnosticos: diags, rodada }), { nivel: 'forte', papel: 'consenso', esquema: prompts.ESQUEMA_FLUXO.consenso, validarJSON: validar.consenso });
        if ((c.consenso !== false || rodada === 2) && lista(c.correcao).length) ordem = c;
        else if (rodada === 2) throw new Error('as equipes não chegaram a uma correção');
        else {
          falta = lista(c.falta_verificar).map((x) => texto(x, 300));
          await marcar('consenso', 'pend', `Sem consenso: ${lista(c.divergencias).join('; ')}`);
        }
      }
      if (varios) await marcar('consenso', 'ok', `${ordem.consenso === false ? 'Decidido pela melhor evidência' : 'Consenso'}: ${ordem.causa_raiz}`);
      await marcar('correcao', 'atual', '', `Causa raiz: ${texto(ordem.causa_raiz, 200)}. ${corretor.nome} está aplicando a correção.`);
      vault.anexar(t, `Fluxo de correção ${ciclo}: causa raiz`, `${diags.map((d) => `${d.equipe}: ${d.json.causa_raiz}`).join('\n')}\n\nDecisão: ${ordem.causa_raiz}\n${lista(ordem.correcao).map((p) => `- ${p}`).join('\n')}`);

      // 4. Correção
      comunicar({ de: 'gestor', para: corretor.id, tipo: 'etapa', resumo: `Corrigir: ${texto(ordem.causa_raiz, 160)}`, tarefaId: id });
      const { json: fix } = await chamar(corretor, (ia) => prompts.aplicarCorrecao({ tarefa: t, projeto, equipe: corretor, vault, ia, cwd, ordem }), { nivel: 'padrao', papel: 'correcao', esquema: prompts.ESQUEMA.questionar, validarJSON: validar.questionar });
      if (fix.status === 'falhou') throw Object.assign(new Error(`${corretor.nome} não conseguiu aplicar: ${texto(fix.resumo, 300)}`), { recomecar: true });
      const arquivos = [...new Set([...lista(fix.arquivos), ...lista(ordem.arquivos)].map((a) => texto(a, 300)).filter(Boolean))];
      await marcar('correcao', 'ok', texto(fix.resumo, 400), 'Correção aplicada. Subindo o ambiente de novo.');

      // 5. Subir
      await marcar('subir', 'atual');
      let r = await subirEsperar(id);
      if (!r || !['no-ar', 'pronto'].includes(r.estado)) {
        await marcar('subir', 'falhou', r?.fase ?? '');
        throw Object.assign(new Error(`depois da correção ainda não subiu: ${r?.fase ?? ''}`), { recomecar: true });
      }
      await marcar('subir', 'ok', r.url ?? 'no ar');

      // 6. Revisões que o gestor pediu (só as que fazem sentido para este erro) e subir de novo
      const revisoes = [];
      for (const [k, e] of revisores.entries()) {
        await marcar(`revisao${k}`, 'atual', '', `${e.nome} está revisando o que foi mexido.`);
        comunicar({ de: 'gestor', para: e.id, tipo: 'etapa', resumo: `Revisar a correção (${arquivos.length} arquivos)`, tarefaId: id });
        const montar = ehLimpo(e) ? (ia) => prompts.limparCodigo({ tarefa: t, projeto, equipe: e, vault, ia, cwd, arquivos, ordem }) : (ia) => prompts.revisarCorrecao({ tarefa: t, projeto, equipe: e, vault, ia, cwd, arquivos, ordem });
        const { json: rj } = await chamar(e, montar, { nivel: 'padrao', papel: 'revisao', esquema: prompts.ESQUEMA.questionar, validarJSON: validar.questionar });
        revisoes.push(`${e.nome}: ${texto(rj.resumo, 400)}`);
        await marcar(`revisao${k}`, 'ok', texto(rj.resumo, 400));
      }
      if (revisores.length) {
        await marcar('subir2', 'atual', '', 'Subindo de novo depois das revisões.');
        r = await subirEsperar(id);
        if (!r || !['no-ar', 'pronto'].includes(r.estado)) {
          await marcar('subir2', 'falhou', r?.fase ?? '');
          throw Object.assign(new Error(`as revisões quebraram o ambiente: ${r?.fase ?? ''}`), { recomecar: true });
        }
        await marcar('subir2', 'ok', r.url ?? 'no ar');
      }

      // 7. Avaliador confere o fluxo e o resultado
      if (avaliador) {
        await marcar('avaliacao', 'atual', '', `${avaliador.nome} está conferindo se o fluxo foi coerente e se está tudo no ar.`);
        const subiu = `${r.estado === 'no-ar' ? `no ar em ${r.url}` : r.estado}. Log recente:\n${(bus.todasLinhas?.()[canalTeste(id)] ?? []).slice(-15).map((l) => l.texto).join('\n')}`;
        const { json: av } = await chamar(avaliador, (ia) => prompts.avaliarCorrecao({ tarefa: t, vault, ia, erro, triagem, ordem, correcao: texto(fix.resposta || fix.resumo, 3000), limpeza: revisoes.join('\n'), subiu }), { nivel: 'padrao', papel: 'avaliacao', esquema: prompts.ESQUEMA.avaliar, validarJSON: validar.avaliar });
        const falhas = lista(av.criterios).filter((c) => c?.ok === false).map((c) => `${texto(c.texto, 120)}${c.obs ? ` (${texto(c.obs, 160)})` : ''}`);
        if (av.aprovado === false) {
          await marcar('avaliacao', 'falhou', falhas.join('; ') || texto(av.resumo, 300));
          throw Object.assign(new Error(`o avaliador não aprovou: ${falhas.join('; ') || texto(av.resumo, 300)}`), { recomecar: true, manterNoAr: true });
        }
        await marcar('avaliacao', 'ok', texto(av.resumo, 400));
      }

      // Conhecimento: quem diagnosticou pela especialidade (a Debug, se participou; senão quem corrigiu) aprende.
      const aprende = diagnosticadores.find(ehDebug) ?? corretor;
      if (aprende?.area) {
        const rel = vault.registrarAprendizado({
          area: aprende.area,
          equipe: aprende.nome,
          caminho: aprende.caminho ?? [],
          tarefa: t,
          aprendizado: {
            titulo: texto(`${triagem.camada ?? 'Erro'}: ${ordem.causa_raiz}`, 90),
            conceito: `${ordem.causa_raiz}. Sintoma: ${texto(triagem.sintoma, 300)}. Camada: ${triagem.camada ?? '-'}.`,
            metodo: `${lista(ordem.correcao).map((p, k) => `${k + 1}. ${p}`).join(' ')} Confirmar: ${lista(ordem.criterios).join('; ')}`,
            exemplo: `Na tarefa ${t.id}: ${texto(erro.motivo, 200)}. ${texto(fix.resumo, 300)}`,
          },
        });
        if (rel) {
          const atual = await store.obter('tarefas', id);
          if (atual) {
            atual.aprendizados = [...new Set([...(atual.aprendizados ?? []), rel])];
            await salvarTarefa(atual);
          }
        }
      }
      const atual = await store.obter('tarefas', id);
      await terminar({
        historico: [...(atual?.teste?.historico ?? []), { em: agora(), motivo: erro.motivo, correcao: `${ordem.causa_raiz} → ${texto(fix.resumo, 300)}` }].slice(-10),
        fase: `Corrigido e conferido${avaliador ? ' pelo avaliador' : ''}. ${r.estado === 'no-ar' ? 'No ar: abra o link e teste.' : 'Pronto para testar.'}`,
      });
      comunicar({ de: 'gestor', para: 'voce', tipo: 'entrega', resumo: 'Ambiente de teste corrigido e no ar', tarefaId: id });
    })().catch(async (e) => {
      console.error('[gestor] fluxo de correção:', e.message);
      bus.terminal(canalTeste(id), `✗ Fluxo de correção ${ciclo}: ${e.message}`, 'erro');
      const atual = await store.obter('tarefas', id);
      if (!atual?.teste) return;
      for (const p of atual.teste.fluxo?.passos ?? []) if (p.estado === 'atual') p.estado = 'falhou';
      await salvarTarefa(atual);
      const outroCiclo = e.recomecar && ciclo < CICLOS_CORRECAO;
      if (!e.manterNoAr) testeLocal.parar(id);
      await terminar({ estado: e.manterNoAr ? 'no-ar' : 'falhou', fase: outroCiclo ? `${e.message}. Começando o fluxo de correção ${ciclo + 1}.` : `${e.message}. ${ciclo >= CICLOS_CORRECAO ? `Depois de ${ciclo} fluxos de correção, ficou com você.` : ''}` });
      if (outroCiclo) corrigirTeste(id, { automatico: true }).catch(() => {});
    });
    return t;
  };

  const pararTeste = async (id) => {
    testeLocal.parar(id);
    bus.terminal(canalTeste(id), '● Teste parado por você.', 'info');
    return atualizarTeste(id, { estado: 'parado', fase: 'Teste parado.' });
  };

  // Mensagem direta para o terminal de uma equipe, sem passar pela fila.
  const mensagemDireta = async (equipeId, mensagem, projetoId) => {
    const equipe = await store.obter('equipes', equipeId);
    if (!equipe) throw Object.assign(new Error('Equipe não encontrada.'), { status: 404 });
    const projeto = projetoId ? await store.obter('projetos', projetoId) : (await store.listar('projetos'))[0];
    bus.terminal(equipeId, `> ${mensagem}`, 'voce');
    comunicar({ de: 'voce', para: equipeId, tipo: 'direta', resumo: mensagem });
    comTrava(equipeId, async () => {
      const [ia] = await candidatas(equipe, projeto);
      if (!ia) return bus.terminal(equipeId, 'Nenhuma IA disponível para esta equipe.', 'erro');
      const maquina = await maquinaDe(projeto);
      bus.terminal(equipeId, `▶ ${ia.nome} · direto, fora da fila${maquina ? ` · em ${maquina.nome}` : ''}`, 'cmd');
      const r = await executarEm(ia, () => mensagem, {
        envExtra: maquina ? {} : await envDe(ia),
        cwd: projeto?.pasta,
        maquina,
        aoLinha: (l, canal) => bus.terminal(equipeId, l, canal === 'erro' ? 'erro' : 'saida'),
      });
      if (ia.tipo === 'simulado') bus.terminal(equipeId, r.saida, 'saida');
      bus.terminal(equipeId, r.codigo === 0 ? '● fim' : `✗ saiu com código ${r.codigo}`, r.codigo === 0 ? 'info' : 'erro');
    }).catch((e) => bus.terminal(equipeId, `✗ ${e.message}`, 'erro'));
  };

  // Ao reiniciar o servidor, cada tarefa volta de onde parou.
  const recuperar = async () => {
    for (const t of await store.listar('tarefas')) {
      // O app fechou: os ambientes de teste caíram junto.
      if (t.teste && ['preparando', 'subindo', 'no-ar', 'corrigindo'].includes(t.teste.estado)) {
        t.teste = { ...t.teste, estado: 'parado', fase: 'O app foi fechado e o teste parou. Clique em Inicializar teste de novo.' };
        await salvarTarefa(t);
      }
      if (t.estado === 'planejando') {
        t.estado = 'fila';
        await salvarTarefa(t);
      } else if (t.estado === 'executando') {
        for (const e of t.plano) if (e.estado === 'atual') e.estado = 'pend';
        await salvarTarefa(t);
        executar_(t.id).catch((e) => console.error('[gestor]', e));
      }
    }
    tick();
  };

  return { tick, responder, aprovar, devolver, corrigir, testar, pararTeste, corrigirTeste, cancelar, retomar, questionar, analisarEquipe, mensagemDireta, recuperar, tipos: TIPOS };
};
