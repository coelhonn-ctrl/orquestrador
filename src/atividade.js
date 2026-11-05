import fs from 'node:fs';
import path from 'node:path';

const MAXIMO = 3000;

// Registro do que aconteceu, para o resumo "enquanto você estava fora".
// Fica num JSONL em data/, com as últimas entradas em memória.
export const criarAtividade = ({ dir, bus }) => {
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, 'atividade.jsonl');
  let itens = [];
  if (fs.existsSync(arquivo)) {
    itens = fs
      .readFileSync(arquivo, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-MAXIMO)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    fs.writeFileSync(arquivo, itens.map((i) => JSON.stringify(i)).join('\n') + (itens.length ? '\n' : ''));
  }

  const registrar = (item) => {
    const completo = { t: new Date().toISOString(), ...item };
    itens.push(completo);
    if (itens.length > MAXIMO) itens.splice(0, itens.length - MAXIMO);
    fs.appendFile(arquivo, `${JSON.stringify(completo)}\n`, () => {});
    bus.emitir({ tipo: 'atividade', item: completo });
    return completo;
  };

  // Acompanha as tarefas do gestor pelos eventos e registra só mudanças de estado relevantes.
  const ultimoEstado = new Map();
  const RELEVANTES = {
    revisao: (t) => `${t.id} ficou pronta para revisar: ${t.titulo}`,
    esperando: (t) => `${t.id} espera sua resposta: ${t.pergunta?.texto ?? t.titulo}`,
    falhou: (t) => `${t.id} parou: ${t.fase}`,
    concluida: (t) => `${t.id} foi concluída: ${t.titulo}`,
  };
  bus.aoEvento((e) => {
    if (e.tipo !== 'tarefa') return;
    const t = e.tarefa;
    if (ultimoEstado.get(t.id) === t.estado) return;
    ultimoEstado.set(t.id, t.estado);
    if (RELEVANTES[t.estado]) registrar({ tipo: `tarefa.${t.estado}`, tarefa: t.id, projeto: t.projetoId, texto: RELEVANTES[t.estado](t) });
  });

  const desde = (iso) => {
    const limite = Date.parse(iso || 0) || 0;
    return itens.filter((i) => Date.parse(i.t) > limite);
  };

  // Evita registrar de novo, a cada reinício, estados que já existiam.
  const conhecer = (tarefas) => tarefas.forEach((t) => ultimoEstado.set(t.id, t.estado));

  return { registrar, desde, conhecer };
};
