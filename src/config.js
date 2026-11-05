import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const carregarEnv = (arquivo) => {
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
};

// No app de desktop a configuração do usuário fica na pasta de dados dele.
if (process.env.ORQ_DADOS) carregarEnv(path.join(process.env.ORQ_DADOS, '.env'));
carregarEnv(path.join(raiz, '.env'));

export const expandirCaminho = (p) => {
  if (!p) return p;
  const casa = p === '~' || p.startsWith('~/') ? os.homedir() + p.slice(1) : p;
  return path.resolve(raiz, casa);
};

const numero = (valor, padrao) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

export const cfg = {
  raiz,
  porta: numero(process.env.ORQ_PORTA, 4700),
  host: process.env.ORQ_HOST || '127.0.0.1',
  token: process.env.ORQ_TOKEN || '',
  dados: expandirCaminho(process.env.ORQ_DADOS || 'data'),
  vault: expandirCaminho(process.env.ORQ_VAULT || 'vault'),
  pastaProjetos: expandirCaminho(process.env.ORQ_PASTA_PROJETOS || path.join(os.homedir(), 'Singularize', 'projetos')),
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  maxAtivas: numero(process.env.ORQ_MAX_ATIVAS, 2),
  timeoutEtapaMs: numero(process.env.ORQ_TIMEOUT_MIN, 30) * 60_000,
  pausaLimiteMs: numero(process.env.ORQ_PAUSA_LIMITE_MIN, 60) * 60_000,
  simular: process.env.ORQ_SIMULAR === '1' || process.argv.includes('--simular'),
  abrir: process.env.ORQ_ABRIR === '1' || process.argv.includes('--abrir'),
  velocidadeSimulacao: numero(process.env.ORQ_SIM_VELOCIDADE, 1),
  padrao: JSON.parse(fs.readFileSync(path.join(raiz, 'orq.config.json'), 'utf8')),
};
