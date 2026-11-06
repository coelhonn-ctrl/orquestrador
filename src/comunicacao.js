// Comunicação entre gestor, equipes, IAs, treinador e você, em tempo real.
// Cada mensagem vira um evento "comunicacao" no barramento e fica guardada (as últimas 3000)
// para a tela de comunicação 3D mostrar o histórico de uma tarefa ou de um treino.

import fs from 'node:fs';
import path from 'node:path';

const LIMITE = 3000;

// Guardado em dados/comunicacao.json para o histórico sobreviver quando o app fecha.
export const criarComunicacao = ({ bus, dados = null }) => {
  const arquivo = dados ? path.join(dados, 'comunicacao.json') : null;
  let itens = [];
  try {
    if (arquivo && fs.existsSync(arquivo)) itens = JSON.parse(fs.readFileSync(arquivo, 'utf8')).slice(-LIMITE);
  } catch {
    itens = [];
  }
  let seq = itens.at(-1)?.id ?? 0;
  let espera = null;
  const gravar = () => {
    if (!arquivo || espera) return;
    espera = setTimeout(() => {
      espera = null;
      try {
        fs.writeFileSync(arquivo, JSON.stringify(itens));
      } catch (e) {
        console.error('[comunicacao] não gravou:', e.message);
      }
    }, 2000);
  };

  const comunicar = ({ de, para, tipo = 'mensagem', resumo = '', texto = '', tarefaId = null, treinoId = null, ia = null }) => {
    if (!de || !para) return null;
    const ev = {
      id: ++seq,
      em: new Date().toISOString(),
      de: String(de),
      para: String(para),
      tipo,
      resumo: String(resumo ?? '').replace(/\s+/g, ' ').slice(0, 240),
      texto: String(texto || resumo || '').slice(0, 4000),
      tarefaId,
      treinoId,
      ia,
    };
    itens.push(ev);
    if (itens.length > LIMITE) itens.splice(0, itens.length - LIMITE);
    bus.emitir({ tipo: 'comunicacao', ev });
    gravar();
    return ev;
  };

  const listar = ({ tarefaId, treinoId, desde = 0, limite = 800 } = {}) =>
    itens
      .filter((e) => e.id > Number(desde || 0))
      .filter((e) => (!tarefaId || e.tarefaId === tarefaId) && (!treinoId || e.treinoId === treinoId))
      .slice(-limite);

  return { comunicar, listar };
};
