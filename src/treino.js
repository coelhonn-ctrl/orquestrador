import fs from 'node:fs';
import path from 'node:path';
import { executar } from './adaptadores.js';
import { extrairJSON } from './json.js';
import { iasParaEquipe } from './equipes.js';

// Treinamento de equipes.
// 1. O Treinador (a IA mais forte escolhida) cria casos de teste e critérios para o foco da equipe.
// 2. O usuário revisa os casos.
// 3. Cada rodada: o Treinador cria N cópias da equipe com instruções diferentes; cada cópia responde
//    a todos os casos com a IA da própria equipe; o Treinador dá nota; a melhor vira base da próxima.
// 4. Para quando uma cópia atinge a meta ou acabam as rodadas. A vencedora vira a versão da equipe.

export const NIVEIS = {
  leve: { nome: 'Leve', copias: 2, rodadas: 2, casos: 4 },
  medio: { nome: 'Médio', copias: 3, rodadas: 3, casos: 5 },
  profundo: { nome: 'Profundo', copias: 4, rodadas: 5, casos: 6 },
};
const LIMITES = { copias: [1, 6], rodadas: [1, 8], casos: [2, 12] };
const SEGUNDOS_POR_CHAMADA = 25;

// Chamadas no pior caso: criar casos + por rodada (cópias × casos respostas + cópias notas + 1 nova geração).
export const estimar = ({ copias, rodadas, casos }) => {
  const chamadas = 1 + rodadas * (copias * casos + copias + 1);
  return { chamadas, minutos: Math.max(1, Math.round((chamadas * SEGUNDOS_POR_CHAMADA) / 60)) };
};

const limitar = (v, [min, max], padrao) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
const texto = (v, n) => String(v ?? '').trim().slice(0, n);
const agora = () => new Date().toISOString();
const media = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

const descreverEquipe = (e) =>
  [
    `Equipe: ${e.nome}${e.familia ? ` (família ${e.familia})` : ''}`,
    `O que faz: ${e.desc || '-'}`,
    e.foco ? `Foco / especialidade: ${e.foco}` : '',
    e.contextos?.length ? `Contextos em que é usada: ${e.contextos.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

// Respostas muito longas vão inteiras até 9000 caracteres; acima disso o juiz é avisado do corte.
const cortar = (t) => {
  const r = String(t ?? '(sem resposta)');
  return r.length > 9000 ? `${r.slice(0, 9000)}\n[...o app cortou o resto por tamanho: não conte este corte como falha da equipe]` : r;
};

const P = {
  casos: (t, e) => `TIPO_ETAPA: treino-casos
Você é o TREINADOR de equipes de IA. Crie casos de teste para treinar esta equipe.
${descreverEquipe(e)}
Objetivo do treino (o que o usuário quer que ela faça muito bem): ${t.objetivo}

Crie ${t.casos} casos realistas e variados que cubram esse objetivo: comuns, difíceis e de borda.
Cada caso é um pedido como um usuário faria. Para cada um, de 2 a 4 critérios objetivos do que uma resposta boa precisa ter.
Responda SOMENTE com este JSON:
{"casos":[{"pedido":"...","criterios":["...","..."]}]}`,

  variantes: (t, e, base) => `TIPO_ETAPA: treino-variantes
Você é o TREINADOR. Crie ${t.copias} versões diferentes das instruções desta equipe, para ela ser excelente no objetivo.
${descreverEquipe(e)}
Objetivo do treino: ${t.objetivo}
Instruções atuais da equipe:
<<<
${base || '(nenhuma ainda)'}
>>>
Cada versão deve seguir uma abordagem diferente (ex.: checklist, passo a passo, perguntar o que falta, focar em fontes, etc.).
Regras objetivas, em português, até 1500 caracteres cada. Não invente ferramentas que a equipe não tem.
Responda SOMENTE com este JSON:
{"variantes":[{"nome":"nome curto da abordagem","instrucoes":"..."}]}`,

  melhorar: (t, e, melhor, falhas) => `TIPO_ETAPA: treino-variantes
Você é o TREINADOR. Rodada anterior: a melhor cópia teve média ${melhor.media}/100 (meta: ${t.meta}).
${descreverEquipe(e)}
Objetivo do treino: ${t.objetivo}
Instruções da melhor cópia:
<<<
${melhor.instrucoes}
>>>
O que faltou, por caso:
${falhas || '- (sem comentários)'}

Crie ${t.copias} novas versões melhoradas. Uma delas pode ser a melhor com ajustes pequenos; as outras devem corrigir as falhas de jeitos diferentes.
Regras objetivas, em português, até 1500 caracteres cada.
Responda SOMENTE com este JSON:
{"variantes":[{"nome":"...","instrucoes":"..."}]}`,

  responder: (e, instrucoes, caso) => `TIPO_ETAPA: treino-executar
Você é a equipe ${e.nome}. ${e.desc || ''}
${e.foco ? `Seu foco: ${e.foco}\n` : ''}Instruções da equipe:
<<<
${instrucoes}
>>>
Isto é um teste de treinamento: responda ao pedido abaixo da melhor forma, direto na resposta. Não crie nem altere arquivos.
Pedido: ${caso.pedido}`,

  julgar: (t, e, casos, respostas) => `TIPO_ETAPA: treino-julgar
Você é o JUIZ do treinamento. Dê nota de 0 a 100 para cada resposta, só pelos critérios do caso. Seja exigente e coerente. Um corte marcado pelo app no fim de uma resposta não é falha da equipe.
${descreverEquipe(e)}
Objetivo do treino: ${t.objetivo}

${casos
  .map(
    (c, i) => `### Caso ${i + 1}
Pedido: ${c.pedido}
Critérios:
${c.criterios.map((x) => `- ${x}`).join('\n')}
Resposta:
<<<
${cortar(respostas[i])}
>>>`,
  )
  .join('\n\n')}

Responda SOMENTE com este JSON (um item por caso, na ordem):
{"notas":[{"caso":1,"nota":0,"falta":"o que faltou, em uma frase (vazio se nada)"}]}`,
};

export const criarTreino = ({ cfg, store, bus, vault }) => {
  const rodando = new Map(); // id -> { cancelar: bool }

  const emitir = (t) => bus.emitir({ tipo: 'treino', treino: t });
  const salvar = async (t) => {
    t.atualizado = agora();
    await store.salvar('treinos', t);
    emitir(t);
    return t;
  };
  const registrar = (t, texto_, tipo = 'info') => {
    t.log = [...(t.log ?? []), { em: agora(), texto: texto_, tipo }].slice(-200);
  };

  const iaDe = async (id, equipe) => {
    const ias = await store.listar('ias');
    const usavel = (i) => i && i.ativa && !i.problema && i.tipo !== 'shell' && (i.tipo === 'simulado' || i.status === 'pronto');
    const escolhida = ias.find((i) => i.id === id);
    if (usavel(escolhida)) return escolhida;
    return iasParaEquipe(ias.filter(usavel), { prefere: equipe?.prefere, requer: equipe?.requer })[0] ?? null;
  };

  const pastaSandbox = (t) => {
    const dir = path.join(cfg.dados, 'treinos', t.id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  // Uma chamada com JSON de volta. Uma segunda tentativa se a resposta não vier no formato.
  const pedirJSON = async (t, ia, prompt) => {
    for (let i = 0; i < 2; i++) {
      const r = await executar(ia, prompt, { cwd: pastaSandbox(t), timeoutMs: cfg.timeoutEtapaMs, velocidade: cfg.velocidadeSimulacao });
      t.chamadas = (t.chamadas ?? 0) + 1;
      const json = r.codigo === 0 ? extrairJSON(r.saida) : null;
      if (json) return json;
      registrar(t, `${ia.nome} não respondeu no formato esperado${i === 0 ? '; tentando de novo' : ''}.`, 'aviso');
    }
    throw new Error(`${ia.nome} não conseguiu responder no formato esperado`);
  };

  const novo = async (equipeId, body = {}) => {
    const equipe = await store.obter('equipes', equipeId);
    if (!equipe) throw Object.assign(new Error('Equipe não encontrada.'), { status: 404 });
    const nivel = NIVEIS[body.nivel] ? body.nivel : body.nivel === 'personalizado' ? 'personalizado' : 'medio';
    const base = NIVEIS[nivel] ?? NIVEIS.medio;
    const copias = nivel === 'personalizado' ? limitar(body.copias, LIMITES.copias, base.copias) : base.copias;
    const rodadas = nivel === 'personalizado' ? limitar(body.rodadas, LIMITES.rodadas, base.rodadas) : base.rodadas;
    const casos = nivel === 'personalizado' ? limitar(body.casos, LIMITES.casos, base.casos) : base.casos;
    const objetivo = texto(body.objetivo, 1500) || equipe.foco || equipe.desc;
    if (!objetivo) throw Object.assign(new Error('Diga em que a equipe deve ficar boa.'), { status: 400 });
    const seq = await store.proximaSequencia('treino');
    const t = {
      id: `TR-${String(seq).padStart(3, '0')}`,
      equipeId,
      equipeNome: equipe.nome,
      objetivo,
      nivel,
      copias,
      rodadas,
      casos,
      meta: limitar(body.meta, [50, 100], 85),
      treinadorIA: texto(body.treinadorIA, 60),
      estado: 'gerando-casos',
      listaCasos: [],
      historico: [],
      chamadas: 0,
      criado: agora(),
      log: [],
    };
    registrar(t, `Treino criado: ${copias} cópias × até ${rodadas} rodadas × ${casos} casos (≈ ${estimar(t).chamadas} chamadas).`);
    await salvar(t);
    gerarCasos(t.id).catch((e) => console.error('[treino]', e));
    return t;
  };

  const gerarCasos = async (id) => {
    const t = await store.obter('treinos', id);
    const equipe = await store.obter('equipes', t.equipeId);
    const treinadorEquipe = await store.obter('equipes', 'treinador');
    const ia = await iaDe(t.treinadorIA || treinadorEquipe?.principal, treinadorEquipe);
    if (!ia) return falhar(t, 'nenhuma IA ligada para o Treinador. Em IAs, ligue uma (o Claude é a melhor opção)');
    t.estado = 'gerando-casos';
    t.treinadorIA = ia.id;
    registrar(t, `${ia.nome} está criando ${t.casos} casos de teste.`);
    await salvar(t);
    try {
      const json = await pedirJSON(t, ia, P.casos(t, equipe));
      t.listaCasos = (Array.isArray(json.casos) ? json.casos : [])
        .map((c) => ({ pedido: texto(c?.pedido, 2000), criterios: (Array.isArray(c?.criterios) ? c.criterios : []).map((x) => texto(x, 300)).filter(Boolean).slice(0, 6) }))
        .filter((c) => c.pedido && c.criterios.length)
        .slice(0, t.casos);
      if (!t.listaCasos.length) throw new Error('o Treinador não devolveu nenhum caso válido');
      t.estado = 'revisar';
      registrar(t, `${t.listaCasos.length} casos prontos. Revise e clique em Começar o treino.`, 'ok');
      await salvar(t);
    } catch (e) {
      await falhar(t, e.message);
    }
  };

  const falhar = async (t, motivo) => {
    t.estado = 'falhou';
    t.erro = motivo;
    registrar(t, `Parou: ${motivo}.`, 'erro');
    console.error(`[treino] ${t.id}: ${motivo}`);
    return salvar(t);
  };

  const editarCasos = async (id, casos) => {
    const t = await store.obter('treinos', id);
    if (!t) throw Object.assign(new Error('Treino não encontrado.'), { status: 404 });
    if (!['revisar', 'falhou', 'interrompido'].includes(t.estado)) throw Object.assign(new Error('Só dá para editar os casos antes de começar.'), { status: 409 });
    t.listaCasos = (Array.isArray(casos) ? casos : [])
      .map((c) => ({ pedido: texto(c?.pedido, 2000), criterios: (Array.isArray(c?.criterios) ? c.criterios : String(c?.criterios ?? '').split('\n')).map((x) => texto(x, 300)).filter(Boolean).slice(0, 6) }))
      .filter((c) => c.pedido && c.criterios.length)
      .slice(0, LIMITES.casos[1]);
    return salvar(t);
  };

  const comecar = async (id) => {
    const t = await store.obter('treinos', id);
    if (!t) throw Object.assign(new Error('Treino não encontrado.'), { status: 404 });
    if (!t.listaCasos?.length) throw Object.assign(new Error('Sem casos de teste. Gere ou escreva ao menos um.'), { status: 400 });
    if (rodando.has(id)) return t;
    t.estado = 'treinando';
    t.erro = null;
    registrar(t, 'Treino começou.');
    await salvar(t);
    rodar(id).catch((e) => console.error('[treino]', e));
    return t;
  };

  const cancelar = async (id) => {
    const c = rodando.get(id);
    if (c) c.cancelar = true;
    const t = await store.obter('treinos', id);
    if (t && !c && ['gerando-casos', 'revisar', 'treinando'].includes(t.estado)) {
      t.estado = 'cancelado';
      registrar(t, 'Cancelado por você.', 'aviso');
      await salvar(t);
    }
    return t;
  };

  // Uma cópia responde a todos os casos (com a IA da própria equipe) e o Treinador dá as notas.
  const avaliarCopia = async (t, equipe, iaEquipe, iaTreinador, copia, controle) => {
    const respostas = [];
    for (const [i, caso] of t.listaCasos.entries()) {
      if (controle.cancelar) throw new Error('cancelado');
      const r = await executar(iaEquipe, P.responder(equipe, copia.instrucoes, caso), { cwd: pastaSandbox(t), timeoutMs: cfg.timeoutEtapaMs, velocidade: cfg.velocidadeSimulacao });
      t.chamadas += 1;
      respostas.push(r.codigo === 0 ? r.saida.trim() : `(falhou: código ${r.codigo})`);
      copia.progresso = `${i + 1}/${t.listaCasos.length}`;
      await salvar(t);
    }
    const json = await pedirJSON(t, iaTreinador, P.julgar(t, equipe, t.listaCasos, respostas));
    const notas = (Array.isArray(json.notas) ? json.notas : []).slice(0, t.listaCasos.length).map((n, i) => ({
      caso: i + 1,
      nota: Math.min(100, Math.max(0, Math.round(Number(n?.nota) || 0))),
      falta: texto(n?.falta, 400),
      resposta: String(respostas[i] ?? '').slice(0, 1500),
    }));
    copia.notas = notas;
    copia.media = media(notas.map((n) => n.nota));
    copia.progresso = null;
  };

  const rodar = async (id) => {
    const controle = { cancelar: false };
    rodando.set(id, controle);
    let t = await store.obter('treinos', id);
    try {
      const equipe = await store.obter('equipes', t.equipeId);
      if (!equipe) throw new Error('a equipe foi removida');
      const treinadorEquipe = await store.obter('equipes', 'treinador');
      const iaTreinador = await iaDe(t.treinadorIA || treinadorEquipe?.principal, treinadorEquipe);
      const iaEquipe = await iaDe(equipe.principal, equipe);
      if (!iaTreinador) throw new Error('nenhuma IA ligada para o Treinador');
      if (!iaEquipe) throw new Error(`nenhuma IA ligada para a equipe ${equipe.nome}`);
      registrar(t, `Treinador: ${iaTreinador.nome} · a equipe responde com: ${iaEquipe.nome}.`);

      let melhor = t.melhor ?? null;
      for (let n = (t.historico?.length ?? 0) + 1; n <= t.rodadas; n++) {
        if (controle.cancelar) throw new Error('cancelado');
        t.rodadaAtual = n;
        registrar(t, `Rodada ${n} de ${t.rodadas}: criando ${t.copias} cópias da equipe.`);
        await salvar(t);
        const falhas = melhor?.notas
          ?.filter((x) => x.falta)
          .map((x) => `- Caso ${x.caso} (${x.nota}/100): ${x.falta}`)
          .join('\n');
        const json = await pedirJSON(t, iaTreinador, melhor ? P.melhorar(t, equipe, melhor, falhas) : P.variantes(t, equipe, equipe.instrucoes));
        const copias = (Array.isArray(json.variantes) ? json.variantes : [])
          .map((v, i) => ({ id: `R${n}-${String.fromCharCode(65 + i)}`, nome: texto(v?.nome, 60) || `Cópia ${String.fromCharCode(65 + i)}`, instrucoes: texto(v?.instrucoes, 4000) }))
          .filter((v) => v.instrucoes)
          .slice(0, t.copias);
        if (!copias.length) throw new Error('o Treinador não criou nenhuma cópia válida');
        const rodada = { n, copias };
        t.historico = [...(t.historico ?? []), rodada];
        await salvar(t);

        for (const copia of copias) {
          registrar(t, `Rodada ${n}: cópia ${copia.id} (${copia.nome}) respondendo aos ${t.listaCasos.length} casos.`);
          await avaliarCopia(t, equipe, iaEquipe, iaTreinador, copia, controle);
          registrar(t, `Cópia ${copia.id}: média ${copia.media}/100.`, copia.media >= t.meta ? 'ok' : 'info');
          await salvar(t);
        }
        const daRodada = [...copias].sort((a, b) => b.media - a.media)[0];
        rodada.melhor = daRodada.id;
        if (!melhor || daRodada.media > melhor.media) melhor = { ...daRodada, rodada: n };
        t.melhor = melhor;
        registrar(t, `Fim da rodada ${n}: melhor até agora ${melhor.id} com ${melhor.media}/100 (meta ${t.meta}).`, 'ok');
        await salvar(t);
        if (melhor.media >= t.meta) break;
      }

      t.estado = 'concluido';
      t.atingiu = melhor.media >= t.meta;
      t.concluido = agora();
      registrar(t, t.atingiu ? `Meta atingida: ${melhor.id} com ${melhor.media}/100.` : `Rodadas acabaram sem atingir a meta. Melhor: ${melhor.id} com ${melhor.media}/100.`, t.atingiu ? 'ok' : 'aviso');
      await salvar(t);
      // Mesmo sem atingir a meta, o que o treino descobriu vai para o cérebro.
      if (melhor) anotar(t, equipe);
      // Atingiu a meta: a cópia vencedora vira a equipe oficial (dá para desfazer).
      if (t.atingiu) await aplicar(t.id);
    } catch (e) {
      t = (await store.obter('treinos', id)) ?? t;
      if (e.message === 'cancelado') {
        t.estado = 'cancelado';
        registrar(t, 'Cancelado por você.', 'aviso');
        await salvar(t);
      } else await falhar(t, e.message);
    } finally {
      rodando.delete(id);
    }
  };

  // O treino vira conhecimento no cérebro, na área da equipe, tudo ligado com [[links]]:
  //  - treino-<id>: o resumo (objetivo, rodadas, instruções vencedoras);
  //  - criterios-<area>: o que é uma boa resposta neste assunto (acumula entre treinos);
  //  - erros-comuns-<area>: o que o juiz apontou que faltou (acumula entre treinos);
  //  - exemplos-<area>-<id>: as melhores respostas de cada caso, com a nota.
  // As equipes consultam a própria área antes de cada tarefa, então usam isso no trabalho real.
  const anotar = (t, equipe) => {
    try {
      const area = equipe.area || 'geral';
      const dir = path.join(vault.raiz, '20-areas', area);
      fs.mkdirSync(dir, { recursive: true });
      const tid = t.id.toLowerCase();
      const nomes = { treino: `treino-${tid}`, criterios: `criterios-${area}`, erros: `erros-comuns-${area}`, exemplos: `exemplos-${area}-${tid}` };
      const cab = (estado, extra = '') => `---\narea: ${area}\nestado: ${estado}\nequipe: ${equipe.id}\n${extra}---\n`;

      // Acrescenta itens novos a uma lista "- ..." já existente, sem repetir.
      const acumular = (nome, titulo, intro, itens, estado) => {
        const arq = path.join(dir, `${nome}.md`);
        const atual = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : `${cab(estado)}# ${titulo}\n\n${intro}\n\n`;
        const ja = new Set([...atual.matchAll(/^- (.+?)(?: · \[\[[^\]]+\]\])?$/gm)].map((m) => m[1].trim().toLowerCase()));
        const novos = [];
        for (const x of itens.map((y) => String(y ?? '').trim()).filter(Boolean)) {
          if (ja.has(x.toLowerCase())) continue;
          ja.add(x.toLowerCase());
          novos.push(x);
        }
        if (!novos.length && fs.existsSync(arq)) return;
        fs.writeFileSync(arq, `${atual.trimEnd()}\n${novos.map((x) => `- ${x} · [[${nomes.treino}]]`).join('\n')}\n`);
      };

      acumular(nomes.criterios, `O que é uma boa resposta: ${equipe.nome}`, `Critérios reunidos dos treinos desta equipe. Confira antes de entregar.`, t.listaCasos.flatMap((c) => c.criterios), 'validado');
      const faltas = t.historico.flatMap((r) => r.copias.flatMap((c) => (c.notas ?? []).filter((n) => n.falta && n.nota < t.meta).map((n) => n.falta)));
      acumular(nomes.erros, `Erros comuns: ${equipe.nome}`, `O que o juiz apontou que faltou nas respostas durante os treinos. Evite.`, faltas, 'rascunho');

      const vencedora = t.melhor;
      const exemplos = (vencedora.notas ?? [])
        .map((n) => `## Caso ${n.caso} · nota ${n.nota}\n**Pedido:** ${t.listaCasos[n.caso - 1]?.pedido ?? ''}\n\n**Resposta de referência:**\n${n.resposta || '(não guardada)'}${n.falta ? `\n\n**Ainda faltou:** ${n.falta}` : ''}`)
        .join('\n\n');
      fs.writeFileSync(path.join(dir, `${nomes.exemplos}.md`), `${cab('validado', `treino: ${t.id}\nnota: ${vencedora.media}\n`)}# Exemplos de referência: ${equipe.nome} (${t.id})\n\nMelhores respostas da cópia ${vencedora.id} (${vencedora.nome}). Use como modelo de qualidade. Veja também [[${nomes.criterios}]] e [[${nomes.erros}]].\n\n${exemplos}\n`);

      const casos = t.listaCasos.map((c, i) => `${i + 1}. ${c.pedido}\n${c.criterios.map((x) => `   - ${x}`).join('\n')}`).join('\n');
      const rodadas = t.historico.map((r) => `- Rodada ${r.n}: ${r.copias.map((c) => `${c.id} ${c.media ?? '-'}`).join(' · ')}`).join('\n');
      const situacao = t.aplicado ? 'Aplicado à equipe.' : t.atingiu ? 'Meta atingida.' : 'Meta não atingida (não aplicado).';
      fs.writeFileSync(
        path.join(dir, `${nomes.treino}.md`),
        `${cab('validado', `treino: ${t.id}\nnota: ${vencedora.media}\n`)}# Treino ${t.id}: ${equipe.nome}\n\nObjetivo: ${t.objetivo}\n\nResultado: ${vencedora.media}/100 (meta ${t.meta}) com a cópia ${vencedora.id} (${vencedora.nome}). ${situacao}\n\nConhecimento gerado: [[${nomes.criterios}]] · [[${nomes.erros}]] · [[${nomes.exemplos}]]\n\n## Instruções vencedoras\n${vencedora.instrucoes}\n\n## Casos de teste\n${casos}\n\n## Rodadas\n${rodadas}\n`,
      );
    } catch (e) {
      console.error('[treino] não anotou no cérebro:', e.message);
    }
  };

  const aplicar = async (id) => {
    const t = await store.obter('treinos', id);
    if (!t?.melhor) throw Object.assign(new Error('Este treino ainda não tem uma cópia vencedora.'), { status: 409 });
    const equipe = await store.obter('equipes', t.equipeId);
    if (!equipe) throw Object.assign(new Error('A equipe foi removida.'), { status: 404 });
    const versoes = equipe.versoes ?? [];
    versoes.push({ versao: versoes.length + 1, instrucoes: equipe.instrucoes ?? '', origem: 'antes do treino', em: agora() });
    equipe.versoes = versoes.slice(-20);
    equipe.instrucoes = t.melhor.instrucoes;
    equipe.treino = { id: t.id, nota: t.melhor.media, meta: t.meta, objetivo: t.objetivo, em: agora(), versao: (equipe.treino?.versao ?? 0) + 1 };
    await store.salvar('equipes', equipe);
    vault.garantir([equipe]);
    bus.emitir({ tipo: 'equipe', equipe });
    t.aplicado = agora();
    registrar(t, `Instruções da cópia ${t.melhor.id} aplicadas à equipe ${equipe.nome} (versão ${equipe.treino.versao}).`, 'ok');
    anotar(t, equipe);
    return salvar(t);
  };

  // Volta a equipe para as instruções de antes do último treino aplicado.
  const desfazer = async (equipeId) => {
    const equipe = await store.obter('equipes', equipeId);
    const anterior = equipe?.versoes?.pop();
    if (!anterior) throw Object.assign(new Error('Não há versão anterior para voltar.'), { status: 409 });
    equipe.instrucoes = anterior.instrucoes;
    equipe.treino = equipe.versoes.length ? { ...equipe.treino, versao: Math.max(0, (equipe.treino?.versao ?? 1) - 1), desfeito: agora() } : null;
    await store.salvar('equipes', equipe);
    bus.emitir({ tipo: 'equipe', equipe });
    return equipe;
  };

  // Treinos que estavam rodando quando o app fechou: dá para continuar de onde parou.
  const aoIniciar = async () => {
    for (const t of await store.listar('treinos')) {
      if (['treinando', 'gerando-casos'].includes(t.estado)) {
        t.estado = 'interrompido';
        registrar(t, 'O app fechou durante o treino. Clique em Continuar para seguir da última rodada completa.', 'aviso');
        // A rodada pela metade é refeita.
        if (t.historico?.length && t.historico.at(-1).copias.some((c) => c.media === undefined)) t.historico.pop();
        await store.salvar('treinos', t);
      }
    }
  };

  const continuar = async (id) => {
    const t = await store.obter('treinos', id);
    if (!t) throw Object.assign(new Error('Treino não encontrado.'), { status: 404 });
    if (!t.listaCasos?.length) {
      gerarCasos(id).catch((e) => console.error('[treino]', e));
      return t;
    }
    return comecar(id);
  };

  return { novo, editarCasos, comecar, cancelar, aplicar, desfazer, aoIniciar, continuar, gerarCasos };
};
