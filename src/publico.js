// O que sai pela API. Valores que parecem segredo (chaves, tokens, senhas) nunca saem do servidor;
// os outros (ex.: CLAUDE_CONFIG_DIR, a pasta de cada conta) aparecem para você conferir.
export const SEGREDO = /KEY|TOKEN|SECRET|SENHA|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

export const iaPublica = (ia) => ({
  ...ia,
  env: Object.keys(ia.env ?? {}),
  envVisivel: Object.fromEntries(Object.entries(ia.env ?? {}).filter(([k]) => !SEGREDO.test(k))),
  // Contas do pool: só os nomes das variáveis; a pasta de perfil pode aparecer (não é segredo).
  contas: (ia.contas ?? []).map((c) => ({ ...c, env: Object.keys(c.env ?? {}), pasta: c.env?.CLAUDE_CONFIG_DIR ?? c.env?.CODEX_HOME ?? c.env?.USERPROFILE ?? null })),
});
