import fs from 'node:fs';
import path from 'node:path';
import { TIPOS, executar, ehLimiteDeCota, explicarFalha, envDaIA, falhaPermanente } from './adaptadores.js';
import { iasParaEquipe } from './equipes.js';
import { extrairJSON } from './json.js';
import { prepararWorktree } from './git.js';
import { iaPublica } from './publico.js';
import * as prompts from './prompts.js';
import { PROMPT, executarRemoto } from './maquinas.js';
import { montarArgs, comandoDe } from './adaptadores.js';

const EM_EXECUCAO = ['planejando', 'executando'];
const agora = () => new Date().toISOString();
const lista = (v) => (Array.isArray(v) ? v : []);
const texto = (v, max = 1200) => String(v ?? '').trim().slice(0, max);

// O gestor é a própria API: recebe 100% das solicitações, planeja uma por vez
// e repassa às equipes só ponteiros (a nota da tarefa no vault).
export const criarGestor = ({ cfg, store, bus, vault, headroom }) => {
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
  const executarEm = async (ia, montarPrompt, { cwd, maquina, envExtra, aoLinha }) => {
    if (!maquina || ia.tipo === 'simulado') return executar(ia, montarPrompt(ia), { cwd, timeoutMs: cfg.timeoutEtapaMs, velocidade: cfg.velocidadeSimulacao, envExtra, aoLinha, incluir: [cfg.vault] });
    const iaRemota = { ...ia, capacidades: { ...ia.capacidades, arquivos: false } };
    return executarRemoto(maquina, { pasta: cwd, comando: comandoDe(ia), args: montarArgs(ia, PROMPT), env: envDaIA(ia), prompt: montarPrompt(iaRemota), timeoutMs: cfg.timeoutEtapaMs, aoLinha });
  };

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
    return { aptas, foraDeUso: (projeto?.ias ?? []).length > 0 && !permitidas, motivos: lista.filter((ia) => ia.tipo !== 'simulado' && motivo(ia)).map((ia) => `${ia.nome}: ${motivo(ia)}`) };
  };

  // Roda a etapa na IA principal; se falhar ou faltar cota, remaneja para a próxima.
  const rodar = async (equipe, montarPrompt, { tarefa, cwd, projeto }) => {
    const { aptas: ias, motivos: foraMotivos, foraDeUso } = await candidatas(equipe, projeto, { detalhar: true });
    if (!ias.length)
      throw new Error(`nenhuma IA pronta para ${equipe.nome} (${foraMotivos.join('; ') || 'nenhuma IA escolhida'}). Em IAs, ligue uma IA instalada e logada e clique em Tentar de novo`);
    if (foraDeUso) bus.terminal(equipe.id, '⚠ As IAs escolhidas para este projeto estão fora de uso. Usando as outras IAs ligadas.', 'aviso');
    const maquina = await maquinaDe(projeto);
    const motivos = [];
    const tentadas = new Set();
    const fila = [...ias];
    while (fila.length) {
      const ia = fila.shift();
      tentadas.add(ia.id);
      const envExtra = maquina ? {} : await envDe(ia);
      bus.terminal(equipe.id, `▶ ${ia.nome}${tarefa ? ` · ${tarefa.id}` : ''}${maquina ? ` · em ${maquina.nome}` : ''}${envExtra.ANTHROPIC_BASE_URL ? ' · via Headroom' : ''}`, 'cmd');
      const r = await executarEm(ia, montarPrompt, {
        envExtra,
        cwd,
        maquina,
        aoLinha: (linha, canal) => bus.terminal(equipe.id, linha, canal === 'erro' ? 'erro' : 'saida'),
      });
      const json = r.codigo === 0 ? extrairJSON(r.saida) : null;
      ia.uso = { chamadas: 0, falhas: 0, ...ia.uso };
      ia.uso.chamadas += 1;
      ia.uso.ultima = agora();
      if (json) {
        await salvarIA(ia);
        bus.terminal(equipe.id, `✓ ${ia.nome} respondeu`, 'ok');
        return { ia, json };
      }
      ia.uso.falhas += 1;
      if (ehLimiteDeCota(`${r.saida}\n${r.erro}`)) {
        ia.limiteAte = new Date(Date.now() + cfg.pausaLimiteMs).toISOString();
        bus.terminal(equipe.id, `⚠ ${ia.nome} sem cota. Fica de fora por ${Math.round(cfg.pausaLimiteMs / 60000)} min.`, 'aviso');
        motivos.push(`${ia.nome} sem cota`);
      } else {
        const motivo = explicarFalha(ia, r);
        motivos.push(`${ia.nome} ${motivo}`);
        if (falhaPermanente(motivo)) {
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
    throw new Error(motivos.length === 1 ? motivos[0] : `nenhuma IA conseguiu. ${motivos.join('; ')}`);
  };

  const tick = async () => {
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
      instrucoes: texto(pedido.instrucoes, 2000),
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

    const todas = await store.listar('equipes');
    const equipes = equipesDoProjeto(todas, projeto);
    const gestor = equipes.find((e) => e.id === 'gestor') ?? { id: 'gestor', nome: 'Gestor', principal: 'claude' };
    const disponiveis = equipes.filter((e) => !['gestor', 'avaliador', 'treinador'].includes(e.id));
    try {
      const { ia, json } = await comTrava('gestor', () =>
        rodar(gestor, (iaAtual) => prompts.planejar({ tarefa: t, projeto, equipes: disponiveis, podeCriar: true, vault, ia: iaAtual }), { tarefa: t, cwd: t.cwd, projeto }),
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
      } else t.equipesPropostas = novas.map((n) => ({ nome: texto(n.nome, 50), desc: texto(n.desc, 300), familia: texto(n.familia, 60), foco: texto(n.foco, 600), instrucoes: texto(n.instrucoes, 2000), requerEditar: !!n.requerEditar, area: texto(n.area, 40) }));

      const resolver = (ref) => {
        if (ids.has(ref)) return ref;
        const s = slug(ref);
        if (porNome.has(s)) return porNome.get(s);
        const proposta = t.equipesPropostas?.find((n) => slug(n.nome) === s);
        if (proposta) return `nova:${proposta.nome}`;
        return [...ids.values()].find((e) => slug(e.nome) === s)?.id ?? null;
      };
      const etapas = lista(json.etapas)
        .map((e) => ({ equipe: resolver(e?.equipe), objetivo: texto(e?.objetivo, 400) || t.titulo, estado: 'pend' }))
        .filter((e) => e.equipe)
        .slice(0, 8);
      if (!etapas.length) throw new Error('o plano não trouxe nenhuma etapa com equipe válida');
      if (todas.some((e) => e.id === 'avaliador' && e.ativa !== false)) etapas.push({ equipe: 'avaliador', objetivo: 'Conferir a entrega contra os critérios.', estado: 'pend' });

      t.plano = etapas;
      t.proposito = texto(json.tipo, 40);
      t.criterios = lista(json.criterios).map((c) => texto(c, 300)).filter(Boolean);
      t.planejadaPor = ia.nome;
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
      t.estado = 'falhou';
      t.fase = `O gestor não conseguiu planejar: ${erro.message}.`;
      console.error(`[gestor] ${t.id} não planejou: ${erro.message}`);
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

        const montar = (ia) =>
          equipe.id === 'avaliador'
            ? prompts.avaliar({ tarefa: t, projeto, equipe, vault, ia })
            : prompts.supervisor({ tarefa: t, projeto, equipe, etapa, indice: i, total: t.plano.length, vault, ia });

        let resultado;
        try {
          resultado = await comTrava(equipe.id, () => rodar(equipe, montar, { tarefa: t, cwd: t.cwd ?? projeto?.pasta, projeto }));
        } catch (erro) {
          const atual = await store.obter('tarefas', id);
          if (!atual) return;
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
        passo.resumo = texto(json.resumo);
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
          atual.fase = `${equipe.nome} não conseguiu: ${passo.resumo || 'sem detalhes'}.`;
          vault.anexar(atual, `${equipe.nome} falhou (${ia.nome})`, passo.resumo);
          await salvarTarefa(atual);
          return;
        }

        passo.estado = 'ok';
        if (equipe.id === 'avaliador') {
          atual.avaliacao = {
            aprovado: json.aprovado !== false,
            resumo: passo.resumo,
            criterios: lista(json.criterios).map((c) => ({ texto: texto(c?.texto ?? c, 300), ok: c?.ok !== false })),
          };
        }
        const aprendizado = texto(json.aprendizado, 1500);
        if (aprendizado) {
          const rel = vault.registrarAprendizado({ area: equipe.area, texto: aprendizado, tarefa: atual, equipe: equipe.nome });
          atual.aprendizados = [...new Set([...(atual.aprendizados ?? []), rel])];
        }
        vault.anexar(
          atual,
          `${equipe.nome} (${ia.nome})`,
          `${passo.resumo}${passo.arquivos.length ? `\n\nArquivos: ${passo.arquivos.map((a) => `\`${a}\``).join(', ')}` : ''}`,
        );
        await salvarTarefa(atual);
      }
    } finally {
      rodando.delete(id);
      setImmediate(tick);
    }
  };

  const finalizar = async (t) => {
    t.estado = 'revisao';
    t.fase = t.avaliacao?.aprovado === false ? 'O avaliador apontou problemas. Revise antes de aprovar.' : 'Aprovada pelo avaliador. Falta a sua revisão.';
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
    if (!t.pergunta) throw Object.assign(new Error('Essa tarefa não está esperando resposta.'), { status: 409 });
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
    t.fase = 'Cancelada por você.';
    vault.anexar(t, 'Cancelada', '');
    return salvarTarefa(t);
  };

  const retomar = async (id) => {
    const t = await exigir(id);
    if (t.estado !== 'falhou' && t.estado !== 'cancelada') throw Object.assign(new Error('Só dá para retomar tarefa que falhou ou foi cancelada.'), { status: 409 });
    const temPlano = t.plano?.length;
    for (const e of t.plano ?? []) if (e.estado === 'falhou' || e.estado === 'atual') e.estado = 'pend';
    t.estado = temPlano ? 'executando' : 'fila';
    t.fase = 'Retomada.';
    await salvarTarefa(t);
    if (temPlano) executar_(id).catch((e) => console.error('[gestor]', e));
    else setImmediate(tick);
    return t;
  };

  // Mensagem direta para o terminal de uma equipe, sem passar pela fila.
  const mensagemDireta = async (equipeId, mensagem, projetoId) => {
    const equipe = await store.obter('equipes', equipeId);
    if (!equipe) throw Object.assign(new Error('Equipe não encontrada.'), { status: 404 });
    const projeto = projetoId ? await store.obter('projetos', projetoId) : (await store.listar('projetos'))[0];
    bus.terminal(equipeId, `> ${mensagem}`, 'voce');
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

  return { tick, responder, aprovar, devolver, cancelar, retomar, mensagemDireta, recuperar, tipos: TIPOS };
};
