import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

const LINHAS_POR_TERMINAL = 400;
const CANAL = 'orq:eventos';

// Barramento de eventos. Em memória por padrão; com REDIS_URL também publica no Redis,
// para que outra instância (ou outro front) receba os mesmos eventos.
export const criarBarramento = async ({ redisUrl }) => {
  const local = new EventEmitter();
  local.setMaxListeners(200);
  const terminais = new Map();
  const origem = randomUUID();
  let publicador = null;

  if (redisUrl) {
    try {
      const { default: Redis } = await import('ioredis');
      publicador = new Redis(redisUrl);
      const assinante = new Redis(redisUrl);
      await assinante.subscribe(CANAL);
      assinante.on('message', (_, mensagem) => {
        const { origem: de, evento } = JSON.parse(mensagem);
        if (de !== origem) local.emit('evento', evento);
      });
      console.log('[eventos] Redis conectado');
    } catch (erro) {
      console.warn(`[eventos] Redis indisponível (${erro.message}); seguindo só em memória`);
    }
  }

  const emitir = (evento) => {
    local.emit('evento', evento);
    publicador?.publish(CANAL, JSON.stringify({ origem, evento })).catch(() => {});
  };

  const terminal = (equipe, texto, tipo = 'info') => {
    const linhas = terminais.get(equipe) ?? [];
    for (const parte of String(texto).split('\n')) {
      if (!parte.trim()) continue;
      const linha = { t: Date.now(), texto: parte.slice(0, 2000), tipo };
      linhas.push(linha);
      emitir({ tipo: 'terminal', equipe, linha });
    }
    if (linhas.length > LINHAS_POR_TERMINAL) linhas.splice(0, linhas.length - LINHAS_POR_TERMINAL);
    terminais.set(equipe, linhas);
  };

  return {
    emitir,
    terminal,
    aoEvento: (fn) => local.on('evento', fn),
    removerOuvinte: (fn) => local.off('evento', fn),
    todasLinhas: () => Object.fromEntries(terminais),
  };
};
