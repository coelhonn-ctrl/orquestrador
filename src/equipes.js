// Equipes: nascem dos objetivos que o usuário escolhe (ou o gestor cria sob medida).
// Só o gestor e o avaliador vêm prontos, porque fazem parte de toda tarefa.
// A IA de cada equipe sai sempre das IAs que o usuário escolheu usar.

import { dnaDe, temDNA } from './dna.js';

const ORDEM_PADRAO = ['claude', 'antigravity', 'codex', 'ollama'];

// Equipes que versões antigas do app criavam sozinhas, sem perguntar o objetivo.
export const EQUIPES_ANTIGAS = ['pesquisa', 'seguranca', 'debug', 'codigo', 'limpo'];

export const definicoes = (padrao) => {
  const mapa = new Map();
  for (const e of padrao.equipes ?? []) mapa.set(e.id, e);
  for (const o of padrao.objetivos ?? []) for (const e of o.equipes) mapa.set(e.id, e);
  return mapa;
};

// IAs que podem assumir uma equipe, da preferida para a menos indicada.
export const iasParaEquipe = (ias, { prefere = ORDEM_PADRAO, requer = null, permitidas = null } = {}) => {
  const reais = ias.filter((i) => i.ativa && i.tipo !== 'shell' && i.tipo !== 'simulado');
  // Sem nenhuma IA real escolhida, o modo demonstração assume (se estiver ligado).
  const base = reais.length ? reais : ias.filter((i) => i.ativa && i.tipo === 'simulado');
  const peso = (i) => {
    const p = prefere.indexOf(i.tipo);
    return p < 0 ? 50 + ORDEM_PADRAO.indexOf(i.tipo) : p;
  };
  return base
    .filter((i) => !permitidas || permitidas.has(i.id) || i.tipo === 'simulado')
    .filter((i) => !requer || i.capacidades?.[requer])
    .sort((a, b) => peso(a) - peso(b));
};

export const criarEquipes = ({ store, bus, vault, padrao }) => {
  const defs = definicoes(padrao);

  const salvar = async (e) => {
    await store.salvar('equipes', e);
    vault.garantir([e]);
    bus.emitir({ tipo: 'equipe', equipe: e });
    return e;
  };

  const preferenciaDe = (e) => e.prefere ?? defs.get(e.id)?.prefere ?? ORDEM_PADRAO;

  // Troca a IA principal / reserva que não estiver entre as IAs em uso. Escolhas válidas do usuário ficam.
  const ajustar = async () => {
    const ias = await store.listar('ias');
    const projetos = await store.listar('projetos');
    for (const e of await store.listar('equipes')) {
      const projeto = e.projetoId ? projetos.find((p) => p.id === e.projetoId) : null;
      // Só conta a limitação do projeto se alguma das IAs dele ainda estiver em uso.
      const doProjeto = (projeto?.ias ?? []).filter((id) => ias.some((i) => i.id === id && i.ativa));
      const permitidas = doProjeto.length ? new Set(doProjeto) : null;
      const aptas = iasParaEquipe(ias, { prefere: preferenciaDe(e), requer: e.requer, permitidas });
      const ids = new Set(aptas.map((i) => i.id));
      let principal = ids.has(e.principal) ? e.principal : aptas[0]?.id ?? '';
      // Redundância real: a reserva é de outro provedor (ex.: principal Claude, reserva Antigravity),
      // para um limite ou queda do provedor não derrubar as duas.
      const tipoP = ias.find((i) => i.id === principal)?.tipo;
      const outroProvedor = aptas.find((i) => i.id !== principal && i.tipo !== tipoP)?.id;
      const reservaAtual = ids.has(e.reserva) && e.reserva !== principal ? e.reserva : null;
      const mesmoProvedor = reservaAtual && ias.find((i) => i.id === reservaAtual)?.tipo === tipoP;
      let reserva = reservaAtual && !(mesmoProvedor && outroProvedor) ? reservaAtual : outroProvedor ?? aptas.find((i) => i.id !== principal)?.id ?? '';
      if (principal === e.principal && reserva === (e.reserva ?? '')) continue;
      await salvar({ ...e, principal, reserva });
    }
  };

  const nova = (def, ias) => {
    const aptas = iasParaEquipe(ias, { prefere: def.prefere, requer: def.requer });
    const dna = dnaDe(def);
    return {
      ...def,
      instrucoes: temDNA(def.instrucoes) ? def.instrucoes : [dna.instrucoes, String(def.instrucoes ?? '').trim()].filter(Boolean).join('\n\nInstruções extras:\n'),
      caminho: def.caminho?.length ? def.caminho : dna.caminho,
      requer: def.requer ?? null,
      principal: aptas[0]?.id ?? '',
      reserva: aptas.find((i) => i.id !== aptas[0]?.id && i.tipo !== aptas[0]?.tipo)?.id ?? aptas[1]?.id ?? '',
      ativa: true,
      aprovacao: false,
      criada: new Date().toISOString(),
    };
  };

  // Gestor e avaliador: sempre existem.
  const garantirFixas = async () => {
    const ias = await store.listar('ias');
    for (const def of padrao.equipes ?? []) {
      if (!(await store.obter('equipes', def.id))) await salvar(nova({ ...def, fixa: true }, ias));
    }
  };

  // Cria as equipes dos objetivos escolhidos. Com "trocar", tira as antigas que vinham prontas e não foram escolhidas.
  const aplicarObjetivos = async (objetivos, { trocar = false } = {}) => {
    const ias = await store.listar('ias');
    const escolhidas = new Map();
    for (const o of padrao.objetivos ?? []) if (objetivos.includes(o.id)) for (const e of o.equipes) escolhidas.set(e.id, e);
    const criadas = [];
    for (const def of escolhidas.values()) {
      const existente = await store.obter('equipes', def.id);
      if (existente) {
        if (existente.ativa === false) await salvar({ ...existente, ativa: true });
        continue;
      }
      criadas.push(await salvar(nova(def, ias)));
    }
    const removidas = [];
    if (trocar) {
      const ocupadas = new Set(
        (await store.listar('tarefas'))
          .filter((t) => !['concluida', 'cancelada'].includes(t.estado))
          .flatMap((t) => (t.plano ?? []).map((p) => p.equipe)),
      );
      for (const id of EQUIPES_ANTIGAS) {
        if (escolhidas.has(id) || ocupadas.has(id) || !(await store.obter('equipes', id))) continue;
        await store.remover('equipes', id);
        bus.emitir({ tipo: 'equipe.removida', id });
        removidas.push(id);
      }
    }
    await ajustar();
    return { criadas: criadas.map((e) => e.id), removidas };
  };

  // Equipes criadas antes das famílias existirem ganham a família do objetivo de onde vieram.
  const completarFamilias = async () => {
    for (const e of await store.listar('equipes')) {
      const familia = defs.get(e.id)?.familia;
      if (!e.familia && familia && !e.fixa) await salvar({ ...e, familia });
    }
  };

  // Toda equipe precisa do DNA (prompt comportamental de base) e de um caminho na árvore do cérebro.
  // Equipes antigas sem isso recebem agora; instruções curtas que você escreveu ficam como "extras".
  // Instruções longas (suas ou de treino) não são tocadas.
  const garantirDNA = async () => {
    for (const e of await store.listar('equipes')) {
      const dna = dnaDe(e);
      const mudar = {};
      if (!temDNA(e.instrucoes)) mudar.instrucoes = [dna.instrucoes, String(e.instrucoes ?? '').trim()].filter(Boolean).join('\n\nInstruções extras:\n');
      if (!e.caminho?.length) mudar.caminho = dna.caminho;
      if (Object.keys(mudar).length) await salvar({ ...e, ...mudar, dnaEm: new Date().toISOString() });
    }
  };

  return { ajustar, garantirFixas, aplicarObjetivos, completarFamilias, garantirDNA, definicoes: defs };
};
