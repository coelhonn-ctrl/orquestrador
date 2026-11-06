// Qual modelo cada chamada usa: rápido, padrão ou forte.
// A ideia é gastar o mínimo: o gestor diz a dificuldade de cada etapa e o app ajusta pelo histórico.
//  - simples → rápido, média → padrão, difícil → forte;
//  - a equipe já sabe fazer ESTA etapa (treinada com nota na meta, ou com notas validadas na área que tratam
//    do assunto da etapa) → desce um nível. Muitas notas sobre outro assunto não contam;
//  - a equipe vem errando (o avaliador apontou problemas mais vezes do que aprovou) → sobe um nível;
//  - a etapa foi reprovada pelo avaliador e está sendo refeita → forte.
// Treinos e provas usam o forte para consolidar o conhecimento; o dia a dia fica no rápido e no padrão.

export const ORDEM = ['rapido', 'padrao', 'forte'];
export const NOMES = { rapido: 'rápido', padrao: 'padrão', forte: 'forte' };
const POR_DIFICULDADE = { simples: 'rapido', facil: 'rapido', media: 'padrao', medio: 'padrao', dificil: 'forte', complexa: 'forte' };

const mover = (nivel, passos) => ORDEM[Math.max(0, Math.min(2, ORDEM.indexOf(nivel) + passos))];

export const normalizarDificuldade = (d) => {
  const s = String(d ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return POR_DIFICULDADE[s] ? (s === 'facil' ? 'simples' : s === 'medio' ? 'media' : s === 'complexa' ? 'dificil' : s) : 'media';
};

const PALAVRAS_VAZIAS = new Set('para como sobre entre quando onde qual quais cada mais menos muito pouco fazer feito deve pode esta este essa esse isso aquilo pela pelo pelas pelos numa num uma umas uns com sem que porque tarefa etapa equipe usuario resposta entrega nota notas'.split(' '));
const termos = (t) =>
  new Set(
    String(t ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p))
      .map((p) => p.replace(/(oes|aes|ais|eis|s)$/, '')),
  );

// Notas validadas da área que falam do assunto da etapa. Palavras que aparecem em quase toda nota da área
// (ex.: "segurança" na área de segurança) não contam: não dizem nada sobre o assunto específico.
export const conhecimentoRelevante = (indice, objetivo) => {
  const alvo = termos(objetivo);
  if (!alvo.size) return 0;
  const linhas = String(indice || '').split('\n').filter((l) => l.trim());
  const freq = new Map();
  for (const l of linhas) for (const p of termos(l)) freq.set(p, (freq.get(p) ?? 0) + 1);
  const comum = (p) => linhas.length >= 4 && freq.get(p) / linhas.length > 0.5;
  return linhas
    .filter((l) => l.includes('(validado)'))
    .filter((l) => {
      const casam = [...termos(l)].filter((p) => alvo.has(p) && !comum(p));
      return casam.length >= 2 || casam.some((p) => p.length >= 9);
    }).length;
};

export const decidirNivel = ({ dificuldade, equipe, vault, escalada = false, automatico = true, objetivo = '' }) => {
  if (!automatico) return { nivel: 'padrao', motivo: 'escolha automática desligada' };
  if (escalada) return { nivel: 'forte', motivo: 'refeita no modelo forte porque o avaliador apontou problema' };
  const d = normalizarDificuldade(dificuldade);
  let nivel = POR_DIFICULDADE[d];
  const motivos = [`dificuldade ${d === 'simples' ? 'simples' : d === 'dificil' ? 'difícil' : 'média'}`];

  const treinada = equipe?.treino?.nota && equipe.treino.nota >= (equipe.treino.meta ?? 80);
  const indice = vault?.indiceArea ? String(vault.indiceArea(equipe?.area) || '') : '';
  const validadas = indice.split('\n').filter((l) => l.includes('(validado)')).length;
  // Sem objetivo (chamadas antigas), vale o critério de antes: várias notas validadas na área.
  const relevantes = objetivo ? conhecimentoRelevante(indice, objetivo) : validadas >= 3 ? 2 : 0;
  if (treinada || relevantes >= 1) {
    const antes = nivel;
    nivel = mover(nivel, -1);
    if (nivel !== antes) motivos.push(treinada ? 'equipe treinada (já sabe fazer)' : `já há conhecimento validado sobre isso (${relevantes} ${relevantes === 1 ? 'nota' : 'notas'})`);
  } else if (validadas && objetivo) {
    motivos.push('a área tem notas, mas nenhuma validada sobre este assunto');
  }
  const real = Object.values(equipe?.desempenhoReal ?? {}).reduce((a, d2) => ({ ok: a.ok + (d2.aprovadas ?? 0), erro: a.erro + (d2.problemas ?? 0) }), { ok: 0, erro: 0 });
  if (real.erro > 0 && real.erro >= real.ok) {
    const antes = nivel;
    nivel = mover(nivel, +1);
    if (nivel !== antes) motivos.push('a equipe vem tendo entregas com problema');
  }
  return { nivel, motivo: motivos.join(' · ') };
};
