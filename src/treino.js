import fs from 'node:fs';
import path from 'node:path';
import { executar, respostaDeCota, fimDaCota, explicarFalha } from './adaptadores.js';
import { iasParaEquipe } from './equipes.js';
import { executarComContas } from './contas.js';
import { pedirValidado, validar, lembreteFormato, contarFormato } from './resposta.js';
import { migrarCamadas } from './vault.js';

// Treinamento de equipes.
// 1. O Treinador (a IA mais forte escolhida) cria casos de teste e critérios para o foco da equipe.
// 2. O usuário revisa os casos.
// 3. Cada rodada: o Treinador cria N cópias da equipe com instruções diferentes; cada cópia responde
//    a todos os casos com a IA da própria equipe; o Treinador dá nota; a melhor vira base da próxima.
// 4. Para quando uma cópia atinge a meta ou acabam as rodadas. A vencedora vira a versão da equipe.

export const NIVEIS = {
  leve: { nome: 'Leve', copias: 2, rodadas: 2, casos: 4, limiteMin: 30, confirmacoes: 1 },
  medio: { nome: 'Médio', copias: 3, rodadas: 3, casos: 5, limiteMin: 60, confirmacoes: 1 },
  profundo: { nome: 'Profundo', copias: 4, rodadas: 5, casos: 6, limiteMin: 150, confirmacoes: 2 },
};
// Tokens estimados por chamada (pedido + resposta), para o orçamento padrão.
const TOKENS_POR_CHAMADA = 4000;
const LIMITES = { copias: [1, 6], rodadas: [1, 8], casos: [2, 12] };
const SEGUNDOS_POR_CHAMADA = 25;

// Chamadas no pior caso: criar casos + por rodada (cópias × casos respostas + cópias notas + 1 nova geração)
// + a prova da IA reserva no fim (casos + 1 nota).
// + as confirmações da nota (a cópia vencedora responde de novo, para provar que não foi um pico).
export const estimar = ({ copias, rodadas, casos, confirmacoes = 1 }) => {
  const chamadas = 1 + rodadas * (copias * casos + copias + 1) + casos + 1 + confirmacoes * (casos + 1);
  return { chamadas, minutos: Math.max(1, Math.round((chamadas * SEGUNDOS_POR_CHAMADA) / 60)), tokensMil: Math.round((chamadas * TOKENS_POR_CHAMADA) / 1000) };
};

// Parada por limite (tempo ou orçamento de tokens): encerra salvando a melhor versão.
class Parada extends Error {
  constructor(motivo) {
    super(motivo === 'tempo' ? 'limite de tempo' : 'orçamento de tokens');
    this.parada = motivo;
  }
}

const limitar = (v, [min, max], padrao) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
const texto = (v, n) => String(v ?? '').trim().slice(0, n);
const agora = () => new Date().toISOString();
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const semCota = (retomarEm, mensagem) => Object.assign(new Error(mensagem), { semCota: true, retomarEm });
const limitada = (ia) => !!ia?.limiteAte && Date.parse(ia.limiteAte) > Date.now();

// Formato de cada resposta do treino (usado para pedir a correção quando vem errado).
const ESQ = {
  casos: '{"casos":[{"pedido":"...","criterios":["...","..."]}]}',
  variantes: '{"variantes":[{"nome":"nome curto da abordagem","instrucoes":"..."}]}',
  notas: '{"notas":[{"caso":1,"nota":0,"falta":"o que faltou, em uma frase (vazio se nada)"}]}',
};

// Erros que a equipe já cometeu em tarefas reais (apontados pelo avaliador) e em treinos anteriores.
const blocoErros = (erros, pedido) =>
  erros?.length ? `\nErros que esta equipe já cometeu em tarefas reais e treinos (${pedido}):\n${erros.map((x) => `- ${x}`).join('\n')}\n` : '';
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

// O "método de ensino" do Treinador: as instruções da equipe Treinador, que também pode ser treinada.
const metodo = (prof) => (prof ? `\nSeu método de ensino (siga sempre; se ele conflitar com o formato, a escala de 0 a 100 ou o JSON pedidos aqui, vale o que está pedido aqui):\n<<<\n${prof}\n>>>\n` : '');

// Respostas muito longas vão inteiras até 9000 caracteres; acima disso o juiz é avisado do corte.
const cortar = (t) => {
  const r = String(t ?? '(sem resposta)');
  return r.length > 9000 ? `${r.slice(0, 9000)}\n[...o app cortou o resto por tamanho: não conte este corte como falha da equipe]` : r;
};

const P = {
  casos: (t, e, prof) => `TIPO_ETAPA: treino-casos
Você é o TREINADOR de equipes de IA. Crie casos de teste para treinar esta equipe.${metodo(prof)}
${descreverEquipe(e)}
Objetivo do treino (o que o usuário quer que ela faça muito bem): ${t.objetivo}

${blocoErros(t.errosReais, 'crie casos que testem se ela ainda erra nisso')}
Crie ${t.casos} casos realistas e variados que cubram esse objetivo: comuns, difíceis e de borda.
Cada caso é um pedido como um usuário faria. Para cada um, de 2 a 4 critérios objetivos do que uma resposta boa precisa ter.
Responda SOMENTE com este JSON:
{"casos":[{"pedido":"...","criterios":["...","..."]}]}`,

  // Treino do próprio Treinador: os "casos" são tarefas de ensino, como as que ele faz de verdade.
  casosProfessor: (t) => `TIPO_ETAPA: treino-casos
Você vai preparar a prova de um TREINADOR de equipes de IA (um professor: ele não resolve os problemas, ele ensina outras equipes a resolver).
Objetivo deste treino: ${t.objetivo}

Crie ${t.casos} tarefas de ensino realistas e variadas, misturando estes tipos:
- criar casos de teste e critérios para treinar uma equipe com um foco específico (invente o foco: pesquisa política, segurança de eventos, código web, marketing…);
- dar notas de 0 a 100 a respostas de exemplo de uma equipe, dizendo o que faltou (escreva as respostas de exemplo dentro do pedido, uma boa e uma fraca);
- reescrever as instruções de uma equipe para corrigir falhas listadas (escreva as instruções e as falhas dentro do pedido).
Cada tarefa é um pedido completo. Para cada uma, de 2 a 4 critérios objetivos de um ensino bom (cobertura, dificuldade, critérios verificáveis, notas justas e coerentes, correções que atacam a causa).
Responda SOMENTE com este JSON:
{"casos":[{"pedido":"...","criterios":["...","..."]}]}`,

  variantes: (t, e, base, prof) => `TIPO_ETAPA: treino-variantes
Você é o TREINADOR. Crie ${t.copias} versões diferentes das instruções desta equipe, para ela ser excelente no objetivo.${metodo(prof)}
${descreverEquipe(e)}
Objetivo do treino: ${t.objetivo}
Instruções atuais da equipe:
<<<
${base || '(nenhuma ainda)'}
>>>
${blocoErros(t.errosReais, 'as instruções precisam evitá-los')}
Cada versão deve seguir uma abordagem diferente (ex.: checklist, passo a passo, perguntar o que falta, focar em fontes, etc.).
Regras objetivas, em português, até 1500 caracteres cada. Não invente ferramentas que a equipe não tem.
Responda SOMENTE com este JSON:
{"variantes":[{"nome":"nome curto da abordagem","instrucoes":"..."}]}`,

  melhorar: (t, e, melhor, falhas, prof) => `TIPO_ETAPA: treino-variantes
Você é o TREINADOR. Rodada anterior: a melhor cópia teve média ${melhor.media}/100 (meta: ${t.meta}).${metodo(prof)}
${descreverEquipe(e)}
Objetivo do treino: ${t.objetivo}
Instruções da melhor cópia:
<<<
${melhor.instrucoes}
>>>
O que faltou, por caso:
${falhas || '- (sem comentários)'}
${blocoErros(t.errosReais, 'as instruções precisam evitá-los')}
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

  julgar: (t, e, casos, respostas, prof) => `TIPO_ETAPA: treino-julgar
Você é o JUIZ do treinamento. Dê nota de 0 a 100 para cada resposta, só pelos critérios do caso. Seja exigente e coerente. Um corte marcado pelo app no fim de uma resposta não é falha da equipe.${metodo(prof)}
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

export const OBJETIVO_PROFESSOR =
  'Ensinar equipes de IA como um bom professor: criar casos de teste realistas, variados e difíceis na medida certa, com critérios objetivos; dar notas justas e coerentes dizendo o que faltou; e reescrever instruções que corrigem a causa das falhas.';

export const criarTreino = ({ cfg, store, bus, vault, comunicar = () => {} }) => {
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
    const usavel = (i) => i && i.ativa && !i.problema && i.tipo !== 'shell' && (i.tipo === 'simulado' || i.status === 'pronto') && !limitada(i);
    const escolhida = ias.find((i) => i.id === id);
    if (usavel(escolhida)) return escolhida;
    return iasParaEquipe(ias.filter(usavel), { prefere: equipe?.prefere, requer: equipe?.requer })[0] ?? null;
  };

  // Nó de quem ensina no grafo de comunicação (no treino do Treinador, quem corrige é o Avaliador).
  const quem = (t) => (t.professor ? 'avaliador' : 'treinador');
  const usavel = (i) => i && i.ativa && !i.problema && i.tipo !== 'shell' && (i.tipo === 'simulado' || i.status === 'pronto') && !limitada(i);

  // Quem faz o quê no treino.
  //  - Treino normal: o Treinador cria casos e cópias e dá as notas; a equipe responde.
  //  - Treino do próprio Treinador (o "professor"): quem prepara a prova e corrige é outra IA
  //    (a do Avaliador, ou qualquer outra ligada), para ninguém dar nota a si mesmo.
  const papeis = async (t, equipe) => {
    const treinadorEquipe = await store.obter('equipes', 'treinador');
    const iaEquipe = await iaDe(equipe.principal, equipe);
    if (equipe.id !== 'treinador') {
      const iaTreinador = await iaDe(t.treinadorIA || treinadorEquipe?.principal, treinadorEquipe);
      return { iaTreinador, iaJuiz: iaTreinador, iaEquipe, prof: treinadorEquipe?.instrucoes ?? '' };
    }
    const ias = (await store.listar('ias')).filter(usavel);
    const avaliador = await store.obter('equipes', 'avaliador');
    const outras = ias.filter((i) => i.id !== iaEquipe?.id);
    const pedida = outras.find((i) => i.id === t.treinadorIA);
    const doAvaliador = outras.find((i) => i.id === avaliador?.principal) ?? outras.find((i) => i.id === avaliador?.reserva);
    const juiz = pedida ?? doAvaliador ?? iasParaEquipe(outras, { prefere: avaliador?.prefere })[0] ?? iaEquipe;
    return { iaTreinador: juiz, iaJuiz: juiz, iaEquipe, prof: '', mesmaIA: juiz?.id === iaEquipe?.id };
  };

  const pastaSandbox = (t) => {
    const dir = path.join(cfg.dados, 'treinos', t.id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  // Uma chamada com JSON de volta. Uma segunda tentativa se a resposta não vier no formato.
  // Treinar consolida conhecimento: quem ensina e corrige usa o modelo forte; quem responde usa o padrão
  // (o mesmo do dia a dia). Com a escolha automática desligada em IAs, cada IA usa o modelo dela.
  const nivel = async (n) => ((await store.obter('ajustes', 'niveis'))?.automatico === false ? null : n);

  // Toda chamada do treino passa pelo pool de contas da IA: conta sem cota, a próxima assume.
  const exec = async (ia, prompt, opcoes) => {
    const { r } = await executarComContas(ia, (x) => executar(x, prompt, opcoes), { pausaMs: cfg.pausaLimiteMs ?? 30 * 60_000, aviso: () => {} });
    if (ia.contas?.length || ia.contaPrincipal) await store.salvar('ias', ia);
    return r;
  };

  // Todas as contas sem cota: avisa com a hora em que a primeira volta.
  const conferirCota = async (ia, r) => {
    if (!respostaDeCota(r) && !/todas as contas desta IA estão sem cota/.test(r.erro ?? '')) return;
    const atual = (await store.obter('ias', ia.id)) ?? ia;
    if (!limitada(atual)) {
      atual.limiteAte = fimDaCota(`${r.saida}\n${r.erro}`, cfg.pausaLimiteMs ?? 60 * 60_000);
      await store.salvar('ias', atual);
    }
    ia.limiteAte = atual.limiteAte;
    throw semCota(atual.limiteAte, `${ia.nome} sem cota`);
  };

  // Uma chamada com JSON de volta. Se vier fora do formato, a mesma IA recebe o que estava errado e corrige
  // (sem refazer). Se a IA ficar sem cota em todas as contas, outra IA ligada assume o papel de quem ensina/corrige.
  const pedirJSON = async (t, iaPedida, prompt, esquema, validarJSON) => {
    const tentadas = new Set();
    let ia = iaPedida;
    for (;;) {
      tentadas.add(ia.id);
      const opcoes = { cwd: pastaSandbox(t), timeoutMs: cfg.timeoutEtapaMs, velocidade: cfg.velocidadeSimulacao, nivel: await nivel('forte'), rotulo: { equipe: quem(t), treinoId: t.id, papel: 'treinar' } };
      // Na tela de Comunicação a IA de quem ensina aparece trabalhando até responder.
      const etapa = (/TIPO_ETAPA:\s*([\w-]+)/.exec(prompt)?.[1] ?? 'treino').replace('treino-', '');
      const rotuloEtapa = { casos: 'criar os casos de teste', variantes: 'escrever as cópias da equipe', julgar: 'dar as notas' }[etapa] ?? 'treinar';
      comunicar({ de: quem(t), para: `ia:${ia.id}`, tipo: 'prompt', resumo: `${quem(t) === 'avaliador' ? 'Avaliador' : 'Treinador'} pede para ${rotuloEtapa}`, treinoId: t.id, ia: ia.nome });
      const { r, json, problemas, correcoes } = await pedirValidado({
        rodar: async (correcao) => {
          const pedido = correcao ?? `${prompt}${lembreteFormato(ia)}`;
          const res = await exec(ia, pedido, opcoes);
          t.chamadas = (t.chamadas ?? 0) + 1;
          t.tokens = (t.tokens ?? 0) + Math.round((pedido.length + String(res.saida ?? '').length) / 4);
          return res;
        },
        esquema,
        validar: validarJSON,
        aoCorrigir: (p, n, max) => registrar(t, `${ia.nome} respondeu fora do formato (${p.join('; ')}). Pedindo a correção ${n} de ${max}, sem refazer.`, 'aviso'),
      });
      if (json || problemas.length) {
        const atual = await store.obter('ias', ia.id);
        if (atual) {
          contarFormato(atual, json ? correcoes > 0 : true);
          ia.uso = atual.uso;
          await store.salvar('ias', atual);
        }
      }
      comunicar({ de: `ia:${ia.id}`, para: quem(t), tipo: json ? 'resposta' : 'falha', resumo: json ? `respondeu (${Object.keys(json).join(', ')})${correcoes ? ' depois de corrigir o formato' : ''}` : `falhou (código ${r.codigo})`, texto: String(r.saida ?? '').slice(0, 4000), treinoId: t.id, ia: ia.nome });
      if (json) return json;
      try {
        await conferirCota(ia, r);
      } catch (e) {
        const treinadorEquipe = await store.obter('equipes', 'treinador');
        const outra = iasParaEquipe((await store.listar('ias')).filter((i) => usavel(i) && !tentadas.has(i.id)), { prefere: treinadorEquipe?.prefere })[0];
        if (!outra) throw e;
        registrar(t, `${ia.nome} ficou sem cota (volta às ${hora(e.retomarEm)}). ${outra.nome} assume e o treino segue.`, 'aviso');
        ia = outra;
        continue;
      }
      throw new Error(problemas.length ? `${ia.nome} não respondeu no formato esperado (${problemas.join('; ')})` : `${ia.nome}: ${explicarFalha(ia, r)}`);
    }
  };

  // Erros reais da equipe: os que o avaliador apontou nas tarefas e os "Evite:" dos treinos anteriores.
  const errosDa = (equipe) => {
    const area = equipe?.area || 'geral';
    const reais = vault.lerLista(area, `erros-comuns-${area}`);
    let treinos = [];
    try {
      const arq = path.join(vault.raiz, '20-areas', area, `padrao-de-qualidade-${area}.md`);
      if (fs.existsSync(arq)) treinos = [...fs.readFileSync(arq, 'utf8').matchAll(/^- Evite: (.+)$/gm)].map((m) => m[1].trim());
    } catch {}
    return [...new Set([...reais, ...treinos])].slice(-12);
  };

  // Nenhuma IA livre só porque todas estão sem cota? Devolve o erro de pausa (com a hora da volta).
  const semIA = async (mensagem) => {
    const volta = (await store.listar('ias')).filter((i) => i.ativa && !i.problema && limitada(i)).map((i) => i.limiteAte).sort()[0];
    return volta ? semCota(volta, 'todas as IAs estão sem cota') : new Error(mensagem);
  };

  // Sem cota em nenhuma IA: o treino pausa e continua sozinho quando a primeira cota renovar.
  const pausar = async (t, e) => {
    t.estado = 'pausado';
    t.retomarEm = e.retomarEm;
    registrar(t, `Todas as IAs ficaram sem cota. O treino continua sozinho às ${hora(e.retomarEm)}.`, 'aviso');
    return salvar(t);
  };

  const novo = async (equipeId, body = {}) => {
    const equipe = await store.obter('equipes', equipeId);
    if (!equipe) throw Object.assign(new Error('Equipe não encontrada.'), { status: 404 });
    const nivel = NIVEIS[body.nivel] ? body.nivel : body.nivel === 'personalizado' ? 'personalizado' : 'medio';
    const base = NIVEIS[nivel] ?? NIVEIS.medio;
    const copias = nivel === 'personalizado' ? limitar(body.copias, LIMITES.copias, base.copias) : base.copias;
    const rodadas = nivel === 'personalizado' ? limitar(body.rodadas, LIMITES.rodadas, base.rodadas) : base.rodadas;
    const casos = nivel === 'personalizado' ? limitar(body.casos, LIMITES.casos, base.casos) : base.casos;
    const objetivo = texto(body.objetivo, 1500) || (equipeId === 'treinador' ? OBJETIVO_PROFESSOR : equipe.foco || equipe.desc);
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
      meta: limitar(body.meta, [50, 100], 80),
      // Contenção definida antes de começar: tempo máximo, teto de tokens e quantas vezes a nota precisa se repetir.
      confirmacoes: limitar(body.confirmacoes, [0, 3], base.confirmacoes ?? 1),
      limiteMin: limitar(body.limiteMin, [0, 600], base.limiteMin ?? 60),
      limiteTokensMil: limitar(body.limiteTokensMil, [0, 100000], 0),
      tokens: 0,
      msAtivo: 0,
      metaReserva: limitar(body.metaReserva, [40, 100], 70),
      professor: equipeId === 'treinador',
      treinadorIA: texto(body.treinadorIA, 60),
      estado: 'gerando-casos',
      listaCasos: [],
      historico: [],
      chamadas: 0,
      criado: agora(),
      log: [],
    };
    if (!t.limiteTokensMil) t.limiteTokensMil = Math.round(estimar(t).tokensMil * 1.5);
    registrar(t, `Treino criado: ${copias} cópias × até ${rodadas} rodadas × ${casos} casos (≈ ${estimar(t).chamadas} chamadas). Limites: ${t.limiteMin ? `${t.limiteMin} min` : 'sem limite de tempo'}, ${t.limiteTokensMil} mil tokens, nota confirmada ${t.confirmacoes}×.`);
    await salvar(t);
    gerarCasos(t.id).catch((e) => console.error('[treino]', e));
    return t;
  };

  const gerarCasos = async (id) => {
    const t = await store.obter('treinos', id);
    const equipe = await store.obter('equipes', t.equipeId);
    const { iaTreinador: ia, prof } = await papeis(t, equipe);
    if (!ia) {
      const e = await semIA('nenhuma IA ligada para o Treinador. Em IAs, ligue uma (o Claude é a melhor opção)');
      return e.semCota ? pausar(t, e) : falhar(t, e.message);
    }
    t.estado = 'gerando-casos';
    t.treinadorIA = ia.id;
    t.retomarEm = null;
    t.errosReais = t.professor ? [] : errosDa(equipe);
    registrar(t, `${ia.nome} está criando ${t.casos} casos de teste${t.errosReais.length ? `, incluindo ${t.errosReais.length} erros que a equipe já cometeu` : ''}.`);
    await salvar(t);
    try {
      comunicar({ de: quem(t), para: equipe.id, tipo: 'treino', resumo: `${ia.nome} prepara ${t.casos} casos de teste`, treinoId: t.id });
      const json = await pedirJSON(t, ia, t.professor ? P.casosProfessor(t) : P.casos(t, equipe, prof), ESQ.casos, validar.casos);
      t.listaCasos = (Array.isArray(json.casos) ? json.casos : [])
        .map((c) => ({ pedido: texto(c?.pedido, 2000), criterios: (Array.isArray(c?.criterios) ? c.criterios : []).map((x) => texto(x, 300)).filter(Boolean).slice(0, 6) }))
        .filter((c) => c.pedido && c.criterios.length)
        .slice(0, t.casos);
      if (!t.listaCasos.length) throw new Error('o Treinador não devolveu nenhum caso válido');
      t.estado = 'revisar';
      registrar(t, `${t.listaCasos.length} casos prontos. Revise e clique em Começar o treino.`, 'ok');
      await salvar(t);
    } catch (e) {
      if (e.semCota) await pausar(t, e);
      else await falhar(t, e.message);
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
    if (!['revisar', 'falhou', 'interrompido', 'pausado'].includes(t.estado)) throw Object.assign(new Error('Só dá para editar os casos antes de começar.'), { status: 409 });
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
    if (t && !c && ['gerando-casos', 'revisar', 'treinando', 'pausado'].includes(t.estado)) {
      t.estado = 'cancelado';
      t.retomarEm = null;
      registrar(t, 'Cancelado por você.', 'aviso');
      await salvar(t);
    }
    return t;
  };

  // Uma cópia responde a todos os casos (com a IA da própria equipe) e o Treinador dá as notas.
  const avaliarCopia = async (t, equipe, iaEquipe, iaJuiz, copia, controle, prof = '') => {
    const respostas = [];
    const no = `${equipe.id}:${copia.id}`;
    for (const [i, caso] of t.listaCasos.entries()) {
      if (controle.cancelar) throw new Error('cancelado');
      controle.verificar?.(t);
      comunicar({ de: quem(t), para: no, tipo: 'caso', resumo: `Caso ${i + 1}: ${caso.pedido.slice(0, 140)}`, texto: caso.pedido, treinoId: t.id, ia: iaEquipe.nome });
      // Falhou (sem ser cota): tenta de novo uma vez antes de contar como resposta ruim.
      let r;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        r = await exec(iaEquipe, P.responder(equipe, copia.instrucoes, caso), { cwd: pastaSandbox(t), timeoutMs: cfg.timeoutEtapaMs, velocidade: cfg.velocidadeSimulacao, nivel: await nivel('padrao'), rotulo: { equipe: equipe.id, treinoId: t.id, papel: 'responder' } });
        t.chamadas += 1;
        t.tokens = (t.tokens ?? 0) + Math.round((P.responder(equipe, copia.instrucoes, caso).length + String(r.saida ?? '').length) / 4);
        if (r.codigo === 0 && r.saida.trim()) break;
        await conferirCota(iaEquipe, r);
        if (tentativa === 0) registrar(t, `${iaEquipe.nome} falhou no caso ${i + 1} (${explicarFalha(iaEquipe, r)}); tentando de novo.`, 'aviso');
      }
      controle.verificar?.(t);
      respostas.push(r.codigo === 0 ? r.saida.trim() : `(falhou: código ${r.codigo})`);
      comunicar({ de: no, para: quem(t), tipo: r.codigo === 0 ? 'resposta' : 'falha', resumo: respostas.at(-1).slice(0, 160), texto: respostas.at(-1).slice(0, 4000), treinoId: t.id, ia: iaEquipe.nome });
      copia.progresso = `${i + 1}/${t.listaCasos.length}`;
      await salvar(t);
    }
    const json = await pedirJSON(t, iaJuiz, P.julgar(t, equipe, t.listaCasos, respostas, prof), ESQ.notas, validar.notas(t.listaCasos.length));
    const notas = (Array.isArray(json.notas) ? json.notas : []).slice(0, t.listaCasos.length).map((n, i) => ({
      caso: i + 1,
      nota: Math.min(100, Math.max(0, Math.round(Number(n?.nota) || 0))),
      falta: texto(n?.falta, 400),
      resposta: String(respostas[i] ?? '').slice(0, 1500),
    }));
    copia.notas = notas;
    copia.media = media(notas.map((n) => n.nota));
    copia.progresso = null;
    comunicar({ de: quem(t), para: no, tipo: 'nota', resumo: `${iaJuiz.nome} deu média ${copia.media}/100`, treinoId: t.id, ia: iaJuiz.nome });
  };

  // Prova das IAs: com as instruções vencedoras, a IA principal precisa da meta (padrão 80)
  // e a reserva de metaReserva (padrão 70). Se a reserva for melhor, ela vira a principal.
  // Se a reserva não passar, outras IAs ligadas fazem a prova para ocupar o lugar.
  const provarIAs = async (t, equipe, iaPrincipal, iaJuiz, controle, prof) => {
    const ias = iasParaEquipe((await store.listar('ias')).filter(usavel), { prefere: equipe.prefere, requer: equipe.requer });
    const resultados = [{ ia: iaPrincipal.id, nome: iaPrincipal.nome, papel: 'principal', media: t.melhor.media, notas: t.melhor.notas }];
    const provar = async (ia, papel) => {
      if (controle.cancelar) throw new Error('cancelado');
      registrar(t, `Prova da IA ${papel}: ${ia.nome} responde aos casos com as instruções vencedoras.`);
      if (ia.id === iaJuiz.id) registrar(t, `${ia.nome} também é quem corrige esta prova; com outra IA ligada a nota seria mais isenta.`, 'aviso');
      await salvar(t);
      const copia = { id: `IA-${ia.id}`, nome: ia.nome, instrucoes: t.melhor.instrucoes };
      try {
        await avaliarCopia(t, equipe, ia, iaJuiz, copia, controle, prof);
      } catch (e) {
        if (e.message === 'cancelado' || e.parada || e.semCota) throw e;
        copia.media = 0;
        copia.notas = [];
        registrar(t, `${ia.nome} não conseguiu fazer a prova: ${e.message}.`, 'aviso');
      }
      const r = { ia: ia.id, nome: ia.nome, papel, media: copia.media, notas: copia.notas };
      resultados.push(r);
      registrar(t, `${ia.nome} (${papel}): ${r.media}/100 (precisa de ${papel === 'principal' ? t.meta : t.metaReserva}).`, r.media >= t.metaReserva ? 'ok' : 'aviso');
      return r;
    };
    const reserva = ias.find((i) => i.id === equipe.reserva && i.id !== iaPrincipal.id);
    let r = reserva ? await provar(reserva, 'reserva') : null;
    // Reserva fraca ou ausente: até 2 outras IAs tentam a vaga.
    if (!r || r.media < t.metaReserva) {
      for (const ia of ias.filter((i) => i.id !== iaPrincipal.id && i.id !== reserva?.id).slice(0, 2)) {
        const c = await provar(ia, 'candidata');
        if (c.media >= t.metaReserva) break;
      }
    }
    // Ordem final: a melhor nota é a principal; empate fica com a atual.
    const ordem = [...resultados].sort((a, b) => b.media - a.media || (a.papel === 'principal' ? -1 : 1));
    const novaPrincipal = ordem[0];
    const novaReserva = ordem.slice(1).find((x) => x.media >= t.metaReserva) ?? ordem.slice(1).find((x) => x.ia === equipe.reserva) ?? null;
    t.provaIAs = {
      resultados,
      principal: novaPrincipal.ia,
      reserva: novaReserva?.ia ?? equipe.reserva ?? '',
      promovida: novaPrincipal.ia !== iaPrincipal.id ? novaPrincipal.ia : null,
      principalOk: novaPrincipal.media >= t.meta,
      reservaOk: !!novaReserva && novaReserva.media >= t.metaReserva,
    };
    if (t.provaIAs.promovida) registrar(t, `${novaPrincipal.nome} teve nota maior (${novaPrincipal.media}) que ${iaPrincipal.nome} (${t.melhor.media}) e será promovida a IA principal; ${iaPrincipal.nome} vira a reserva.`, 'ok');
    if (resultados.length === 1) registrar(t, 'Só há uma IA ligada para esta equipe, então não há reserva para provar. Ligue outra IA em IAs para ter uma reserva.', 'aviso');
    else if (!t.provaIAs.reservaOk) registrar(t, `Nenhuma IA ficou com ${t.metaReserva} ou mais para ser a reserva desta equipe. Ligue outra IA ou treine de novo.`, 'aviso');
    await salvar(t);
  };

  const rodar = async (id) => {
    const controle = { cancelar: false };
    rodando.set(id, controle);
    let t = await store.obter('treinos', id);
    // Tempo ativo (sem contar o app fechado) e tokens gastos, conferidos antes de cada chamada.
    const desde = Date.now();
    const msAtivo = (x) => (x.msAtivo ?? 0) + (Date.now() - desde);
    controle.verificar = (x) => {
      if (x.limiteMin && msAtivo(x) >= x.limiteMin * 60_000) throw new Parada('tempo');
      if (x.limiteTokensMil && (x.tokens ?? 0) >= x.limiteTokensMil * 1000) throw new Parada('tokens');
    };
    try {
      const equipe = await store.obter('equipes', t.equipeId);
      if (!equipe) throw new Error('a equipe foi removida');
      const { iaTreinador, iaJuiz, iaEquipe, prof, mesmaIA } = await papeis(t, equipe);
      if (!iaTreinador) throw await semIA('nenhuma IA ligada para o Treinador');
      if (!iaEquipe) throw await semIA(`nenhuma IA ligada para a equipe ${equipe.nome}`);
      registrar(t, t.professor ? `Treino do Treinador: ${iaJuiz.nome} prepara a prova e corrige · o Treinador responde com: ${iaEquipe.nome}.` : `Treinador: ${iaTreinador.nome} · a equipe responde com: ${iaEquipe.nome}.`);
      if (mesmaIA) registrar(t, 'Só há uma IA ligada: ela vai corrigir a si mesma. Ligue outra IA para uma nota mais justa.', 'aviso');
      t.retomarEm = null;
      t.errosReais = t.professor ? [] : errosDa(equipe);
      if (t.errosReais.length) registrar(t, `${t.errosReais.length} erros reais da equipe entram no treino.`);

      let melhor = t.melhor ?? null;
      for (let n = (t.historico?.length ?? 0) + 1; n <= t.rodadas; n++) {
        if (controle.cancelar) throw new Error('cancelado');
        if (melhor && melhor.media >= t.meta && melhor.estavel) break;
        // Perto do limite: não começa uma rodada que não vai caber. Congela as mutações e fecha com a melhor.
        const feitas = t.historico?.length ?? 0;
        if (feitas && melhor) {
          const porRodadaMs = msAtivo(t) / feitas;
          const porRodadaTok = (t.tokens ?? 0) / feitas;
          if (t.limiteMin && msAtivo(t) + porRodadaMs > t.limiteMin * 60_000) throw new Parada('tempo');
          if (t.limiteTokensMil && (t.tokens ?? 0) + porRodadaTok > t.limiteTokensMil * 1000) throw new Parada('tokens');
        }
        controle.verificar(t);
        t.rodadaAtual = n;
        registrar(t, `Rodada ${n} de ${t.rodadas}: criando ${t.copias} cópias da equipe.`);
        await salvar(t);
        const falhas = melhor?.notas
          ?.filter((x) => x.falta)
          .map((x) => `- Caso ${x.caso} (${x.nota}/100): ${x.falta}`)
          .join('\n');
        comunicar({ de: quem(t), para: equipe.id, tipo: 'treino', resumo: `Rodada ${n}: criando ${t.copias} cópias`, treinoId: t.id, ia: iaTreinador.nome });
        const json = await pedirJSON(t, iaTreinador, melhor ? P.melhorar(t, equipe, melhor, falhas, prof) : P.variantes(t, equipe, equipe.instrucoes, prof), ESQ.variantes, validar.variantes);
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
          await avaliarCopia(t, equipe, iaEquipe, iaJuiz, copia, controle, prof);
          registrar(t, `Cópia ${copia.id}: média ${copia.media}/100.`, copia.media >= t.meta ? 'ok' : 'info');
          await salvar(t);
        }
        const daRodada = [...copias].sort((a, b) => b.media - a.media)[0];
        rodada.melhor = daRodada.id;
        if (!melhor || daRodada.media > melhor.media) melhor = { ...daRodada, rodada: n };
        t.melhor = melhor;
        registrar(t, `Fim da rodada ${n}: melhor até agora ${melhor.id} com ${melhor.media}/100 (meta ${t.meta}).`, 'ok');
        await salvar(t);
        // Estabilidade: a nota da meta não vale como pico isolado. A vencedora responde de novo
        // (confirmações) e precisa ficar na meta em todas as vezes.
        if (melhor.media >= t.meta && !melhor.estavel) {
          const notas = [melhor.media];
          for (let k = 1; k <= (t.confirmacoes ?? 0); k++) {
            registrar(t, `Confirmando a nota de ${melhor.id} (${k} de ${t.confirmacoes}): responde aos casos de novo.`);
            await salvar(t);
            const repeticao = { id: `${melhor.id}-C${k}`, nome: `${melhor.nome} (confirmação ${k})`, instrucoes: melhor.instrucoes };
            await avaliarCopia(t, equipe, iaEquipe, iaJuiz, repeticao, controle, prof);
            notas.push(repeticao.media);
            registrar(t, `Confirmação ${k}: ${repeticao.media}/100.`, repeticao.media >= t.meta ? 'ok' : 'aviso');
            if (repeticao.media < t.meta) break;
          }
          melhor.confirmacoes = notas.slice(1);
          melhor.estavel = notas.every((x) => x >= t.meta);
          const copiaNaRodada = t.historico.flatMap((r) => r.copias).find((c) => c.id === melhor.id);
          if (copiaNaRodada) Object.assign(copiaNaRodada, { confirmacoes: melhor.confirmacoes, estavel: melhor.estavel });
          if (!melhor.estavel) {
            melhor.mediaEstavel = Math.round(notas.reduce((a, b) => a + b, 0) / notas.length);
            registrar(t, `Nota instável (${notas.join(', ')}): foi um pico, não um padrão. O treino continua.`, 'aviso');
          } else registrar(t, `Nota confirmada (${notas.join(', ')}): ${melhor.id} é consistente.`, 'ok');
          t.melhor = melhor;
          await salvar(t);
        }
        if (melhor.media >= t.meta && melhor.estavel) break;
      }

      // Prova das IAs (principal 80, reserva 70 por padrão) antes de fechar.
      t.estado = 'provando-ias';
      await salvar(t);
      await provarIAs(t, equipe, iaEquipe, iaJuiz, controle, prof);
      melhor = t.melhor;

      if (!melhor) throw new Error('nenhuma cópia chegou a ser avaliada');
      t.estado = 'concluido';
      t.msAtivo = msAtivo(t);
      t.atingiu = !!melhor.estavel && Math.max(melhor.media, ...(t.provaIAs?.resultados ?? []).map((r) => r.media)) >= t.meta;
      t.concluido = agora();
      registrar(t, t.atingiu ? `Meta atingida: ${melhor.id} com ${melhor.media}/100.` : `Rodadas acabaram sem atingir a meta. Melhor: ${melhor.id} com ${melhor.media}/100.`, t.atingiu ? 'ok' : 'aviso');
      await salvar(t);
      // Mesmo sem atingir a meta, o que o treino descobriu vai para o cérebro.
      if (melhor) anotar(t, equipe);
      // Atingiu a meta: a cópia vencedora vira a equipe oficial (dá para desfazer).
      if (t.atingiu) await aplicar(t.id);
    } catch (e) {
      const tokensAgora = t.tokens;
      t = (await store.obter('treinos', id)) ?? t;
      t.tokens = Math.max(t.tokens ?? 0, tokensAgora ?? 0);
      if (e.semCota) {
        // Rodada pela metade é refeita ao continuar (senão seria pulada).
        t.msAtivo = msAtivo(t);
        if (t.historico?.length && t.historico.at(-1).copias.some((c) => c.media === undefined)) t.historico.pop();
        if (t.estado === 'provando-ias') t.estado = 'treinando';
        await pausar(t, e);
      } else if (e.parada) {
        // Limite atingido: guarda a melhor versão, documenta no cérebro e, se for orçamento de tokens,
        // aplica o que foi consolidado até aqui (desde que melhore a equipe).
        t.msAtivo = msAtivo(t);
        t.parada = e.parada;
        if (t.historico?.length && t.historico.at(-1).copias.some((c) => c.media === undefined)) t.historico.at(-1).copias = t.historico.at(-1).copias.filter((c) => c.media !== undefined);
        if (!t.melhor) {
          await falhar(t, `${e.message} atingido antes da primeira rodada terminar. Aumente o limite e continue`);
        } else {
          t.estado = 'concluido';
          t.concluido = agora();
          t.atingiu = t.melhor.media >= t.meta && !!t.melhor.estavel;
          registrar(t, `Parou por ${e.message} (${Math.round(t.msAtivo / 60000)} min, ~${Math.round((t.tokens ?? 0) / 1000)} mil tokens). Melhor versão guardada: ${t.melhor.id} com ${t.melhor.media}/100.`, 'aviso');
          await salvar(t);
          const eq = await store.obter('equipes', t.equipeId);
          if (eq) anotar(t, eq);
          const melhoraAEquipe = !eq?.treino?.nota || t.melhor.media >= eq.treino.nota;
          // aplicar() lê e grava o treino por conta própria: não regravar a cópia antiga por cima.
          if (t.atingiu || (e.parada === 'tokens' && melhoraAEquipe)) await aplicar(t.id);
          else {
            registrar(t, 'Versão guardada sem aplicar: use Aplicar à equipe se quiser usá-la.', 'info');
            await salvar(t);
          }
        }
      } else if (e.message === 'cancelado') {
        t.estado = 'cancelado';
        registrar(t, 'Cancelado por você.', 'aviso');
        await salvar(t);
      } else await falhar(t, e.message);
    } finally {
      rodando.delete(id);
    }
  };

  // O treino vira conhecimento no cérebro, na área da equipe, em três caminhos:
  //  1. padrao-de-qualidade-<area> (raiz da área): o conhecimento consolidado (Conceito e Método).
  //     É o único ligado direto à equipe: qualquer IA chega nele primeiro.
  //  2. exemplos/exemplos-<area>-<id>: casos de uso (respostas de referência), ligados a partir da nota 1.
  //  3. origem/treino-<id>: como o conhecimento foi adquirido (casos de teste, rodadas, nota), ligado a partir
  //     da nota 1. Nunca direto à equipe nem à família: é registro, não é o que se consulta de cara.
  const anotar = (t, equipe) => {
    try {
      const area = equipe.area || 'geral';
      const dir = path.join(vault.raiz, '20-areas', area);
      const dirEx = path.join(dir, 'exemplos');
      const dirOrigem = path.join(dir, 'origem');
      fs.mkdirSync(dirEx, { recursive: true });
      fs.mkdirSync(dirOrigem, { recursive: true });
      const tid = t.id.toLowerCase();
      const nomes = { treino: `treino-${tid}`, padrao: `padrao-de-qualidade-${area}`, exemplos: `exemplos-${area}-${tid}` };
      const trilha = equipe.caminho?.length ? `caminho: ${equipe.caminho.join(' > ')}\n` : '';
      const cab = (tipo, estado, extra = '') => `---\narea: ${area}\n${trilha}tipo: ${tipo}\nestado: ${estado}\nequipe: ${equipe.id}\n${extra}---\n`;

      // Itens novos numa seção "- ..." de uma nota, sem repetir os que já estão lá.
      const juntar = (texto, secao, itens) => {
        const re = new RegExp(`(## ${secao}\\n)([\\s\\S]*?)(?=\\n## |$)`);
        const m = texto.match(re);
        const ja = new Set([...(m?.[2] ?? '').matchAll(/^- (.+?)(?: · \[\[[^\]]+\]\])?$/gm)].map((x) => x[1].trim().toLowerCase()));
        const novos = [];
        for (const x of itens.map((y) => String(y ?? '').trim()).filter(Boolean)) {
          if (ja.has(x.toLowerCase())) continue;
          ja.add(x.toLowerCase());
          novos.push(`- ${x}`);
        }
        if (!novos.length) return texto;
        return m ? texto.replace(re, (_, cabeca, corpo) => `${cabeca}${corpo.trimEnd()}\n${novos.join('\n')}\n`) : `${texto.trimEnd()}\n\n## ${secao}\n${novos.join('\n')}\n`;
      };

      const arqPadrao = path.join(dir, `${nomes.padrao}.md`);
      let padrao = fs.existsSync(arqPadrao)
        ? migrarCamadas(fs.readFileSync(arqPadrao, 'utf8'))
        : `${cab('conhecimento', 'validado')}# Padrão de qualidade: ${equipe.nome}\n\n${equipe.caminho?.length ? `Caminho: ${equipe.caminho.join(' > ')}\n\n` : ''}## 1. Conceito\nO que é uma boa resposta neste assunto. Cada item é um critério que o avaliador confere.\n\n## 2. Método\nComo aplicar: confira cada critério da camada 1 antes de entregar e evite os erros abaixo.\n\n## 3. Casos de uso\n\n## 4. Como foi adquirido\n`;
      padrao = juntar(padrao, '1. Conceito', t.listaCasos.flatMap((c) => c.criterios));
      const faltas = t.historico.flatMap((r) => r.copias.flatMap((c) => (c.notas ?? []).filter((n) => n.falta && n.nota < t.meta).map((n) => `Evite: ${n.falta}`)));
      padrao = juntar(padrao, '2. Método', faltas);
      padrao = juntar(padrao, '3. Casos de uso', [`[[${nomes.exemplos}]] · respostas de referência (${t.melhor?.media ?? '-'}/100)`]);
      padrao = juntar(padrao, '4. Como foi adquirido', [`[[${nomes.treino}]] · treino ${t.id}, ${new Date().toLocaleDateString('sv-SE')}`]);
      fs.writeFileSync(arqPadrao, padrao);

      const vencedora = t.melhor;
      const exemplos = (vencedora.notas ?? [])
        .map((n) => `## Caso ${n.caso} · nota ${n.nota}\n**Pedido:** ${t.listaCasos[n.caso - 1]?.pedido ?? ''}\n\n**Resposta de referência:**\n${n.resposta || '(não guardada)'}${n.falta ? `\n\n**Ainda faltou:** ${n.falta}` : ''}`)
        .join('\n\n');
      fs.writeFileSync(path.join(dirEx, `${nomes.exemplos}.md`), `${cab('exemplo', 'validado', `treino: ${t.id}\nnota: ${vencedora.media}\n`)}# Exemplos de referência: ${equipe.nome} (${t.id})\n\nCasos de uso de [[${nomes.padrao}]]. Melhores respostas da cópia ${vencedora.id} (${vencedora.nome}).\n\n${exemplos}\n`);

      const casos = t.listaCasos.map((c, i) => `${i + 1}. ${c.pedido}\n${c.criterios.map((x) => `   - ${x}`).join('\n')}`).join('\n');
      const rodadas = t.historico.map((r) => `- Rodada ${r.n}: ${r.copias.map((c) => `${c.id} ${c.media ?? '-'}`).join(' · ')}`).join('\n');
      const situacao = t.aplicado ? 'Aplicado à equipe.' : t.atingiu ? 'Meta atingida.' : 'Meta não atingida (não aplicado).';
      const parada = t.parada ? ` Parou por ${t.parada === 'tempo' ? 'limite de tempo' : t.parada === 'tokens' ? 'orçamento de tokens' : t.parada}.` : '';
      fs.writeFileSync(
        path.join(dirOrigem, `${nomes.treino}.md`),
        `${cab('origem', 'validado', `treino: ${t.id}\nnota: ${vencedora.media}\n`)}# Treino ${t.id}: ${equipe.nome}\n\nComo o conhecimento de [[${nomes.padrao}]] foi adquirido.\n\nObjetivo: ${t.objetivo}\n\nResultado: ${vencedora.media}/100 (meta ${t.meta}) com a cópia ${vencedora.id} (${vencedora.nome}). ${situacao}${parada}\n\nRespostas de referência: [[${nomes.exemplos}]]\n\n## Instruções vencedoras\n${vencedora.instrucoes}\n\n## Casos de teste\n${casos}\n\n## Rodadas\n${rodadas}\n`,
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
    equipe.treino = { id: t.id, nota: t.melhor.media, meta: t.meta, metaReserva: t.metaReserva, objetivo: t.objetivo, em: agora(), versao: (equipe.treino?.versao ?? 0) + 1 };
    // Desempenho de cada IA nesta equipe e promoção automática da reserva, se ela foi melhor.
    if (t.provaIAs) {
      equipe.desempenho = { ...(equipe.desempenho ?? {}) };
      for (const r of t.provaIAs.resultados) equipe.desempenho[r.ia] = { nome: r.nome, media: r.media, treino: t.id, em: agora() };
      const antes = equipe.principal;
      if (t.provaIAs.principal) equipe.principal = t.provaIAs.principal;
      if (t.provaIAs.reserva && t.provaIAs.reserva !== equipe.principal) equipe.reserva = t.provaIAs.reserva;
      else if (equipe.reserva === equipe.principal) equipe.reserva = antes !== equipe.principal ? antes : '';
      if (antes !== equipe.principal) {
        equipe.trocas = [...(equipe.trocas ?? []), { em: agora(), de: antes, para: equipe.principal, motivo: `prova do treino ${t.id}` }].slice(-20);
        registrar(t, `Promoção: ${t.provaIAs.resultados.find((r) => r.ia === equipe.principal)?.nome} agora é a IA principal da equipe.`, 'ok');
      }
    }
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
      if (['treinando', 'gerando-casos', 'provando-ias'].includes(t.estado)) {
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

  // Treinos pausados por cota continuam sozinhos quando a cota renova.
  setInterval(async () => {
    for (const t of await store.listar('treinos').catch(() => [])) {
      if (t.estado !== 'pausado' || rodando.has(t.id) || !(Date.parse(t.retomarEm) <= Date.now())) continue;
      registrar(t, 'A cota renovou. Continuando o treino.', 'ok');
      t.retomarEm = null;
      if (!t.listaCasos?.length) {
        t.estado = 'gerando-casos';
        await salvar(t);
        gerarCasos(t.id).catch((e) => console.error('[treino]', e));
      } else {
        t.estado = 'revisar';
        await salvar(t);
        comecar(t.id).catch((e) => console.error('[treino]', e));
      }
    }
  }, 30_000).unref();

  return { novo, editarCasos, comecar, cancelar, aplicar, desfazer, aoIniciar, continuar, gerarCasos };
};
