import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolverExecutavel } from './adaptadores.js';

// Máquinas remotas por SSH, como o Remote-SSH do VS Code: o projeto mora lá, as IAs rodam lá
// e o app só manda os comandos. Usa o cliente OpenSSH do sistema (já vem no Windows 10+, Linux e macOS),
// então vale tudo o que o seu ~/.ssh/config já tem: aliases, chaves, ProxyJump.

export const PROMPT = '\u0000ORQ_PROMPT\u0000';

// Aspas simples para o shell remoto.
export const aspas = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const expandir = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

// "~/projetos/x" precisa do $HOME do lado de lá, então não pode ir entre aspas simples inteiro.
const pastaRemota = (pasta) => (pasta?.startsWith('~/') ? `"$HOME"/${aspas(pasta.slice(2))}` : pasta === '~' ? '"$HOME"' : aspas(pasta));

export const argsSsh = (m, { interativo = false, encaminhar = null } = {}) => {
  const a = [];
  if (m.porta) a.push('-p', String(m.porta));
  if (m.chave) a.push('-i', expandir(m.chave));
  a.push('-o', 'ConnectTimeout=12', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30');
  if (interativo) a.push('-t');
  else a.push('-T', '-o', 'BatchMode=yes');
  if (encaminhar) a.push('-o', 'ExitOnForwardFailure=no', '-R', `${encaminhar.remota}:127.0.0.1:${encaminhar.local}`);
  a.push(m.destino);
  return a;
};

// Linha de comando que roda do lado remoto num shell de login (para pegar o PATH de lá).
// Com promptStdin, o prompt chega pela entrada padrão: nada de aspas quebrando texto longo.
export const comandoRemoto = ({ pasta, comando, args = [], env = {}, promptStdin = false, shell = false }) => {
  const exporta = Object.entries(env)
    .map(([k, v]) => `export ${k}=${aspas(v)};`)
    .join(' ');
  const linha = shell ? 'exec "${SHELL:-/bin/sh}" -l' : [comando, ...args].map((a) => (a === PROMPT ? '"$ORQ_PROMPT"' : aspas(a))).join(' ');
  const interno = `${exporta} export PATH="$HOME/.singularize/bin:$HOME/.local/bin:$PATH"; ${pasta ? `cd ${pastaRemota(pasta)} || { echo "Pasta nao encontrada: ${pasta.replace(/"/g, '')}"; exit 1; };` : ''} ${linha}`;
  return `${promptStdin ? 'export ORQ_PROMPT="$(cat)"; ' : ''}exec "\${SHELL:-/bin/sh}" -lc ${aspas(interno)}`;
};

const ssh = () => resolverExecutavel('ssh', []).comando;

const rodarSsh = (m, remoto, { entrada = null, timeoutMs = 30_000 } = {}) =>
  new Promise((resolve) => {
    const filho = spawn(ssh(), [...argsSsh(m), remoto], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let saida = '';
    let erro = '';
    const timer = setTimeout(() => filho.kill(), timeoutMs);
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (erro += d));
    filho.on('error', (e) => {
      clearTimeout(timer);
      resolve({ codigo: -1, saida, erro: e.code === 'ENOENT' ? 'O comando ssh não foi encontrado neste computador. No Windows, ative o "Cliente OpenSSH" em Recursos opcionais.' : e.message });
    });
    filho.on('close', (codigo) => {
      clearTimeout(timer);
      resolve({ codigo, saida, erro });
    });
    if (entrada) filho.stdin.end(entrada);
    else filho.stdin.end();
  });

const COMANDOS = ['claude', 'agy', 'gemini', 'codex', 'ollama', 'node', 'git'];

const explicarErro = (erro) => {
  if (/Permission denied/i.test(erro)) return 'Acesso negado. Configure o acesso sem senha (botão abaixo) ou confira usuário e chave.';
  if (/Could not resolve hostname/i.test(erro)) return 'Endereço não encontrado. Confira o nome da máquina ou o alias no ~/.ssh/config.';
  if (/timed out|Connection refused|No route/i.test(erro)) return 'Não conectou: a máquina está desligada, fora da rede ou a porta SSH está fechada.';
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(erro)) return 'A chave da máquina mudou desde a última conexão. Verifique se é a máquina certa antes de continuar.';
  return erro.trim().split('\n').slice(-2).join(' ') || 'Falha desconhecida no SSH.';
};

// Testa a conexão, descobre o sistema e quais IAs existem lá, e instala o comando `orq` remoto.
export const testarMaquina = async (m, raizApp, extras = []) => {
  const procurar = [...new Set([...COMANDOS, ...extras.filter((c) => /^[\w.+-]+$/.test(c))])];
  const r = await rodarSsh(m, `exec "\${SHELL:-/bin/sh}" -lc ${aspas(`echo "SO:$(uname -s) $(uname -m)"; export PATH="$HOME/.local/bin:$PATH"; for c in ${procurar.join(' ')}; do command -v $c >/dev/null 2>&1 && echo "TEM:$c"; done`)}`);
  if (r.codigo !== 0) return { ok: false, erro: explicarErro(r.erro) };
  const comandos = [...r.saida.matchAll(/^TEM:(\S+)/gm)].map((x) => x[1]);
  const so = r.saida.match(/^SO:(.+)$/m)?.[1]?.trim() ?? '';
  let orq = false;
  if (comandos.includes('node')) {
    const codigo = fs.readFileSync(path.join(raizApp, 'bin', 'orq.mjs'), 'utf8');
    const envio = await rodarSsh(
      m,
      `mkdir -p "$HOME/.singularize/bin" && cat > "$HOME/.singularize/bin/orq.mjs" && printf '#!/bin/sh\\nexec node "$HOME/.singularize/bin/orq.mjs" "$@"\\n' > "$HOME/.singularize/bin/orq" && chmod +x "$HOME/.singularize/bin/orq"`,
      { entrada: codigo },
    );
    orq = envio.codigo === 0;
  }
  return { ok: true, so, comandos, orq };
};

// Executa uma etapa (gestor/equipes) na máquina remota, com o prompt pela entrada padrão.
export const executarRemoto = (m, { pasta, comando, args, env, prompt, timeoutMs, aoLinha }) =>
  new Promise((resolve) => {
    const remoto = comandoRemoto({ pasta, comando, args, env, promptStdin: true });
    const filho = spawn(ssh(), [...argsSsh(m), remoto], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let saida = '';
    let erro = '';
    let estourou = false;
    const pend = { saida: '', erro: '' };
    const consumir = (canal) => (pedaco) => {
      const t = pedaco.toString().replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\r/g, '');
      if (canal === 'saida') saida += t;
      else erro += t;
      const linhas = (pend[canal] + t).split('\n');
      pend[canal] = linhas.pop();
      for (const l of linhas) if (l.trim()) aoLinha?.(l, canal);
    };
    filho.stdout.on('data', consumir('saida'));
    filho.stderr.on('data', consumir('erro'));
    const timer = setTimeout(() => {
      estourou = true;
      filho.kill();
    }, timeoutMs ?? 30 * 60_000);
    filho.on('error', (e) => {
      clearTimeout(timer);
      resolve({ codigo: -1, saida, erro: `${erro}\n${e.message}`, timeout: false });
    });
    filho.on('close', (codigo) => {
      clearTimeout(timer);
      if (codigo === 255) aoLinha?.(`SSH: ${explicarErro(erro)}`, 'erro');
      resolve({ codigo: codigo ?? -1, saida, erro, timeout: estourou });
    });
    filho.stdin.end(prompt);
  });

export const chavePublicaLocal = async () => {
  const dir = path.join(os.homedir(), '.ssh');
  const pub = ['id_ed25519.pub', 'id_rsa.pub', 'id_ecdsa.pub'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
  if (pub) return fs.readFileSync(pub, 'utf8').trim();
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, 'id_ed25519');
  await new Promise((resolve, reject) => {
    const filho = spawn(resolverExecutavel('ssh-keygen', []).comando, ['-t', 'ed25519', '-N', '', '-f', destino, '-C', `singularize@${os.hostname()}`], { stdio: 'ignore', windowsHide: true });
    filho.on('error', reject);
    filho.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ssh-keygen falhou'))));
  });
  return fs.readFileSync(`${destino}.pub`, 'utf8').trim();
};

export const comandoSsh = ssh;
