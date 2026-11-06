// Quem está trabalhando agora, a partir das mensagens entre você, o gestor, as equipes e as IAs.
// Usado pela tela Comunicação e pelo Cérebro: quem recebe um pedido passa a trabalhar; quem responde, para.

export const COR = {
  voce: '#f4f0ff',
  gestor: '#b65cff',
  avaliador: '#ff8fc7',
  treinador: '#f0b45a',
  equipe: '#9d7bff',
  ia: '#6fd39b',
  copia: '#d9c6ff',
  agente: '#8fe0c0',
};
export const COR_TIPO = {
  pedido: '#f4f0ff',
  plano: '#b65cff',
  etapa: '#b65cff',
  prompt: '#9d7bff',
  resposta: '#6fd39b',
  resultado: '#6fd39b',
  falha: '#f08a80',
  avaliacao: '#ff8fc7',
  pergunta: '#f2d16b',
  entrega: '#f4f0ff',
  treino: '#f0b45a',
  caso: '#f0b45a',
  nota: '#ff8fc7',
  agente: '#8fe0c0',
  direta: '#f4f0ff',
};
export const NOME_TIPO = {
  pedido: 'pedido',
  plano: 'plano',
  etapa: 'etapa',
  prompt: 'pedido à IA',
  resposta: 'resposta',
  resultado: 'resultado',
  falha: 'falha',
  avaliacao: 'avaliação',
  pergunta: 'pergunta',
  entrega: 'entrega',
  treino: 'treino',
  caso: 'caso de teste',
  nota: 'nota',
  agente: 'mensagem',
  direta: 'mensagem direta',
};
// Como cada mensagem se lê numa frase: "Gestor passou a etapa para Código".
export const VERBO = {
  pedido: 'pediu ao',
  plano: 'incluiu no plano',
  etapa: 'passou a etapa para',
  prompt: 'mandou o trabalho para',
  resposta: 'respondeu a',
  resultado: 'entregou o resultado ao',
  falha: 'falhou e avisou',
  avaliacao: 'mandou a avaliação ao',
  pergunta: 'perguntou a',
  entrega: 'entregou para',
  treino: 'está treinando',
  caso: 'mandou um caso de teste para',
  nota: 'deu nota a',
  agente: 'mandou mensagem para',
  direta: 'escreveu direto para',
};
export const NOME_PAPEL = { voce: 'você', gestor: 'gestor', avaliador: 'avaliador', treinador: 'treinador', equipe: 'equipe (supervisor)', ia: 'IA', copia: 'cópia em treino', agente: 'agente' };

// Quem recebe estes tipos passa a trabalhar; quem envia os de resposta terminou a parte dele.
export const PEDE = new Set(['pedido', 'etapa', 'prompt', 'caso', 'direta']);
export const RESPONDE = new Set(['resposta', 'resultado', 'falha', 'avaliacao', 'nota', 'entrega', 'plano']);
export const TRABALHO_MAX_MS = 45 * 60_000;
export const ESTADOS_ATIVOS = { tarefa: ['planejando', 'executando'], voce: ['esperando', 'revisao'], treino: ['gerando-casos', 'treinando', 'provando-ias'] };


export const duracao = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};
export const curto = (t, n = 70) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export const criarAtividade = (S) => {
  const A = {
    trabalho: new Map(), // nó -> Map(chave da tarefa/treino -> { desde, oque, de, link, chave, esperando })
    linhaDe: new Map(), // equipe -> última linha do terminal dela
    ultimaDe: new Map(), // nó -> última mensagem em que ele aparece (para saber com quem está falando)
  };

  A.tipoNo = (id) => {
    if (id === 'voce') return 'voce';
    if (['gestor', 'avaliador', 'treinador'].includes(id)) return id;
    if (id.startsWith('ia:')) return 'ia';
    if (id.startsWith('agente:')) return 'agente';
    if (id.includes(':')) return 'copia';
    return 'equipe';
  };
  A.nomeNo = (id) => {
    if (id === 'voce') return 'Você';
    if (id.startsWith('ia:')) return S.d.ias.find((i) => i.id === id.slice(3))?.nome ?? id.slice(3);
    if (id.startsWith('agente:')) return S.d.agentes?.find((a) => a.id === id.slice(7))?.nome ?? id.slice(7);
    if (id.includes(':')) {
      const [eq, copia] = id.split(':');
      const nome = S.d.equipes.find((e) => e.id === eq)?.nome ?? eq;
      return copia.startsWith('IA-') ? `${nome} · prova ${S.d.ias.find((i) => i.id === copia.slice(3))?.nome ?? copia.slice(3)}` : `${nome} · cópia ${copia}`;
    }
    return S.d.equipes.find((e) => e.id === id)?.nome ?? id;
  };

  const chaveDe = (ev) => ev.tarefaId || ev.treinoId || 'geral';
  A.trabalhando = (id) => (A.trabalho.get(id)?.size ?? 0) > 0;
  const iniciar = (id, chave, info) => {
    if (!A.trabalho.has(id)) A.trabalho.set(id, new Map());
    A.trabalho.get(id).set(chave, info);
  };
  const parar = (id, chave) => {
    const m = A.trabalho.get(id);
    if (!m) return;
    m.delete(chave);
    if (!m.size) A.trabalho.delete(id);
  };

  A.limpar = () => {
    A.trabalho.clear();
    A.ultimaDe.clear();
  };

  A.aplicar = (ev) => {
    A.ultimaDe.set(ev.de, ev);
    A.ultimaDe.set(ev.para, ev);
    const chave = chaveDe(ev);
    const quando = Date.parse(ev.em) || Date.now();
    if (Date.now() - quando > TRABALHO_MAX_MS) return;
    // Quem responde (ou manda a pergunta para você) terminou a parte dele.
    if (RESPONDE.has(ev.tipo) || (ev.tipo === 'pergunta' && ev.de !== 'voce')) parar(ev.de, chave);
    if (ev.de === 'voce') parar('voce', chave);
    if (PEDE.has(ev.tipo) || (ev.tipo === 'pergunta' && ev.de === 'voce')) iniciar(ev.para, chave, { desde: quando, oque: ev.resumo, de: ev.de, link: `${ev.de}>${ev.para}`, chave });
    // Pergunta ou entrega para você: o seu ponto acende até você agir.
    if (ev.para === 'voce' && ['pergunta', 'entrega'].includes(ev.tipo)) iniciar('voce', chave, { desde: quando, oque: ev.tipo === 'pergunta' ? `pergunta: ${ev.resumo}` : 'entrega para revisar', de: ev.de, link: null, chave, esperando: true });
  };

  // Tarefa ou treino que já parou: ninguém dela continua trabalhando (e trabalho esquecido expira).
  // Devolve as ligações com trabalho em andamento ("de>para").
  A.conferir = () => {
    const agora = Date.now();
    for (const [id, m] of [...A.trabalho]) {
      for (const [chave, info] of [...m]) {
        let vale = agora - info.desde < TRABALHO_MAX_MS;
        if (vale && chave.startsWith('TR-')) vale = ESTADOS_ATIVOS.treino.includes(S.d.treinos?.find((t) => t.id === chave)?.estado);
        else if (vale && chave !== 'geral') {
          const t = S.d.tarefas.find((x) => x.id === chave);
          vale = !!t && (id === 'voce' ? ESTADOS_ATIVOS.voce : ESTADOS_ATIVOS.tarefa).includes(t.estado);
        }
        if (!vale) parar(id, chave);
      }
    }
    return new Set([...A.trabalho.values()].flatMap((m) => [...m.values()].map((i) => i.link).filter(Boolean)));
  };

  // O que o nó está fazendo agora: a última linha do terminal da equipe (para a IA dela) ou o pedido recebido.
  A.fazendo = (id) => {
    const m = A.trabalho.get(id);
    if (!m?.size) return null;
    const info = [...m.values()].sort((a, b) => b.desde - a.desde)[0];
    const equipe = id.startsWith('ia:') ? info.de : A.tipoNo(id) === 'equipe' || ['gestor', 'avaliador'].includes(id) ? id : null;
    const linha = equipe ? A.linhaDe.get(equipe) : null;
    const vale = linha && linha.t >= info.desde - 1000 && Date.now() - linha.t < 5 * 60_000;
    let texto = '';
    if (vale && linha.chamada) {
      const mod = linha.modelo ? ` (${linha.modelo})` : '';
      texto = id.startsWith('ia:') ? `pensando para ${A.nomeNo(info.de)}${mod}` : `usando ${linha.ia}${linha.modelo ? ` · ${linha.modelo}` : ''}`;
    } else if (vale) texto = linha.texto;
    // Sem nada no terminal ainda: a IA "recebeu o pedido de X"; a equipe faz o que pediram.
    if (!texto && id.startsWith('ia:')) texto = `recebeu o pedido de ${A.nomeNo(info.de)}`;
    return { ...info, texto: texto || info.oque, ha: Date.now() - info.desde };
  };

  // Saída do terminal de uma equipe: vira o "fazendo agora" dela e da IA que está trabalhando para ela.
  // A linha "▶ Claude Code · modelo forte (opus) · T-009" é o app chamando a IA, não o que ela faz:
  // vira { ia, modelo } para as frases "esperando a IA…" (na equipe) e "trabalhando para…" (na IA).
  A.terminal = (equipe) => {
    const ultima = [...(S.d.terminais?.[equipe] ?? [])].reverse().find((l) => ['saida', 'cmd', 'aviso'].includes(l.tipo) && l.texto?.trim());
    if (!ultima) return;
    const texto = ultima.texto.replace(/^[▶●✓↻⚠↷]\s*/, '');
    if (ultima.tipo === 'cmd' && /^▶/.test(ultima.texto)) {
      const partes = texto.split(' · ');
      const mod = partes.find((p) => p.startsWith('modelo '));
      const nome = mod?.match(/\(([^)]+)\)/)?.[1] ?? mod?.replace(/^modelo\s+/, '') ?? '';
      const modelo = nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : '';
      A.linhaDe.set(equipe, { chamada: true, ia: partes[0], modelo, t: ultima.t ?? Date.now() });
    } else A.linhaDe.set(equipe, { texto, t: ultima.t ?? Date.now() });
  };

  return A;
};
