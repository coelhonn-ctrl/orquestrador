// O que sai pela API. Valores de variáveis de ambiente (chaves) nunca saem do servidor.
export const iaPublica = (ia) => ({ ...ia, env: Object.keys(ia.env ?? {}) });
