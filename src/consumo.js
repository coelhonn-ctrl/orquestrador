import fs from 'node:fs';
import path from 'node:path';

// Consumo de cada chamada às IAs: tokens estimados (cerca de 4 caracteres por token), por equipe,
// IA e nível de modelo. Serve para ver onde a cota vai e quanto a escolha por dificuldade economiza.
// É uma estimativa: o que a IA lê sozinha do disco (arquivos, notas grandes) não entra na conta.

const LIMITE = 20000;
// Peso de custo relativo de cada nível (proporção típica de preço entre modelos rápido, médio e forte).
export const PESO = { rapido: 1, padrao: 3, forte: 15 };
const tokens = (chars) => Math.round((chars || 0) / 4);

export const criarConsumo = ({ dados }) => {
  const arquivo = path.join(dados, 'consumo.jsonl');
  let itens = [];
  try {
    if (fs.existsSync(arquivo))
      itens = fs
        .readFileSync(arquivo, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-LIMITE)
        .map((l) => JSON.parse(l));
  } catch {
    itens = [];
  }

  const registrar = ({ ia, nivel, modelo, entrada, saida, ms, codigo, equipe, tarefaId, treinoId, papel }) => {
    if (!ia || ia.tipo === 'shell') return;
    const item = { em: new Date().toISOString(), ia: ia.id, iaNome: ia.nome, simulado: ia.tipo === 'simulado', nivel: nivel || null, modelo: modelo || '', entrada: tokens(entrada), saida: tokens(saida), ms, ok: codigo === 0, equipe: equipe || null, tarefaId: tarefaId || null, treinoId: treinoId || null, papel: papel || null };
    itens.push(item);
    if (itens.length > LIMITE * 1.2) itens = itens.slice(-LIMITE);
    try {
      fs.mkdirSync(dados, { recursive: true });
      fs.appendFileSync(arquivo, `${JSON.stringify(item)}\n`);
    } catch {}
  };

  const somar = (lista, chave) => {
    const g = new Map();
    for (const i of lista) {
      const k = chave(i) ?? '—';
      const a = g.get(k) ?? { chave: k, chamadas: 0, entrada: 0, saida: 0, custo: 0, ms: 0 };
      a.chamadas += 1;
      a.entrada += i.entrada;
      a.saida += i.saida;
      a.custo += (i.entrada + i.saida) * (PESO[i.nivel] ?? PESO.padrao);
      a.ms += i.ms ?? 0;
      g.set(k, a);
    }
    return [...g.values()].sort((a, b) => b.entrada + b.saida - (a.entrada + a.saida));
  };

  const resumo = ({ dias = 7, tarefaId } = {}) => {
    const desde = Date.now() - dias * 86400_000;
    const lista = itens.filter((i) => Date.parse(i.em) >= desde && (!tarefaId || i.tarefaId === tarefaId));
    const comNivel = lista.filter((i) => i.nivel);
    const custoReal = comNivel.reduce((s, i) => s + (i.entrada + i.saida) * PESO[i.nivel], 0);
    const custoForte = comNivel.reduce((s, i) => s + (i.entrada + i.saida) * PESO.forte, 0);
    return {
      dias,
      chamadas: lista.length,
      entrada: lista.reduce((s, i) => s + i.entrada, 0),
      saida: lista.reduce((s, i) => s + i.saida, 0),
      simuladas: lista.filter((i) => i.simulado).length,
      economia: custoForte ? Math.round((1 - custoReal / custoForte) * 100) : 0,
      porNivel: somar(lista, (i) => i.nivel ?? 'sem nível'),
      porEquipe: somar(lista, (i) => i.equipe ?? (i.treinoId ? 'treinos' : 'outros')),
      porIA: somar(lista, (i) => i.iaNome),
      porTarefa: somar(lista.filter((i) => i.tarefaId || i.treinoId), (i) => i.tarefaId ?? i.treinoId).slice(0, 15),
      ultimas: lista.slice(-40).reverse(),
    };
  };

  return { registrar, resumo };
};
