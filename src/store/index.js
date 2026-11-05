import { criarStoreMemoria } from './memoria.js';
import { criarStorePostgres } from './postgres.js';

export const criarStore = async (cfg) => {
  if (!cfg.databaseUrl) return criarStoreMemoria(cfg.dados);
  try {
    const store = await criarStorePostgres(cfg.databaseUrl, cfg.raiz);
    console.log('[store] Postgres conectado');
    return store;
  } catch (erro) {
    console.warn(`[store] Postgres indisponível (${erro.message}); usando arquivo em ${cfg.dados}`);
    return criarStoreMemoria(cfg.dados);
  }
};
