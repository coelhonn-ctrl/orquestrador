import fs from 'node:fs';
import path from 'node:path';
import { respostaDeCota, fimDaCota } from './adaptadores.js';

// Pool de contas por IA: a mesma ferramenta (Claude, Codex, Antigravity) com várias contas.
// Quando uma conta bate o limite, a próxima assume na hora; o contexto não se perde porque está no cérebro.
// Cada conta é só um conjunto de variáveis de ambiente: uma chave de API (ANTHROPIC_API_KEY…) ou uma pasta
// de perfil separada, onde fica o login daquela conta.

export const PERFIL_ENV = {
  // Claude Code e Codex têm variável própria para a pasta de configuração.
  claude: (dir) => ({ CLAUDE_CONFIG_DIR: dir }),
  codex: (dir) => ({ CODEX_HOME: dir }),
  // O Antigravity guarda o login na pasta do usuário: o perfil troca a pasta do usuário.
  antigravity: (dir) => ({ HOME: dir, USERPROFILE: dir }),
};

const agoraMs = () => Date.now();
const livre = (c) => !(c.limiteAte && Date.parse(c.limiteAte) > agoraMs()) && !c.problema;

// A conta principal (o login padrão da ferramenta) vem sempre primeiro; depois as contas extras.
export const contasDe = (ia) => [{ id: 'principal', nome: 'Conta principal', env: {}, limiteAte: ia.contaPrincipal?.limiteAte ?? null, problema: ia.contaPrincipal?.problema ?? null, desligada: ia.contaPrincipal?.desligada }, ...(ia.contas ?? [])].filter((c) => !c.desligada);

export const contasLivres = (ia) => contasDe(ia).filter(livre);

export const comConta = (ia, conta) => (conta.id === 'principal' ? { ...ia, contaAtual: 'principal' } : { ...ia, env: { ...(ia.env ?? {}), ...(conta.env ?? {}) }, contaAtual: conta.id });

export const marcarConta = (ia, contaId, mudanca) => {
  if (contaId === 'principal') ia.contaPrincipal = { ...(ia.contaPrincipal ?? {}), ...mudanca };
  else ia.contas = (ia.contas ?? []).map((c) => (c.id === contaId ? { ...c, ...mudanca } : c));
};

// Roda nas contas livres desta IA, uma depois da outra, até uma responder sem bater o limite.
// Se todas baterem, a IA inteira fica fora até a primeira conta liberar.
export const executarComContas = async (ia, rodar, { pausaMs, aviso = () => {} }) => {
  const livres = contasLivres(ia);
  if (!livres.length) return { r: { codigo: -1, saida: '', erro: 'todas as contas desta IA estão sem cota', timeout: false }, conta: null, esgotou: true };
  let ultimo = null;
  for (const [i, conta] of livres.entries()) {
    const r = await rodar(comConta(ia, conta));
    ultimo = { r, conta };
    if (!respostaDeCota(r)) {
      ia.contaEmUso = conta.id;
      return ultimo;
    }
    // A hora em que a cota volta vem da própria mensagem da IA ("resets 5pm"); sem ela, a pausa padrão.
    marcarConta(ia, conta.id, { limiteAte: fimDaCota(`${r.saida}\n${r.erro}`, pausaMs), ultimaCota: new Date().toISOString() });
    const proxima = livres[i + 1];
    aviso(proxima ? `⚠ ${ia.nome}: a conta "${conta.nome}" bateu o limite. Trocando para a conta "${proxima.nome}".` : `⚠ ${ia.nome}: todas as contas bateram o limite.`);
  }
  const datas = contasDe(ia).map((c) => (c.id === 'principal' ? ia.contaPrincipal?.limiteAte : c.limiteAte)).filter(Boolean).map(Date.parse).filter((t) => t > agoraMs());
  // Só datas futuras: um limite antigo de outra conta não pode liberar a IA antes da hora.
  if (datas.length) ia.limiteAte = new Date(Math.min(...datas)).toISOString();
  return { ...ultimo, esgotou: true };
};

export const pastaPerfil = (dados, iaId, contaId) => {
  const dir = path.join(dados, 'perfis', `${iaId}-${contaId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
