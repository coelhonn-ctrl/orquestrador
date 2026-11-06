import { spawn, execFile } from 'node:child_process';
import net from 'node:net';

// Ambiente de teste de uma entrega: sobe os processos que a equipe indicou (servidor web, API…) na pasta do
// projeto, guarda o log e confere quando o endereço responde. Um ambiente por tarefa; o app derruba tudo ao fechar.

const ambientes = new Map(); // tarefaId -> { processos: [{ nome, filho }], log: [] }

export const portaLivre = (inicio = 5180) =>
  new Promise((resolve) => {
    const tentar = (p) => {
      if (p > inicio + 200) return resolve(inicio);
      const s = net.createServer();
      s.once('error', () => tentar(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tentar(inicio);
  });

const matar = (filho) => {
  if (!filho || filho.exitCode !== null) return;
  if (process.platform === 'win32' && filho.pid) execFile('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else {
    try {
      process.kill(-filho.pid, 'SIGTERM'); // o grupo inteiro (npm → node → vite…)
    } catch {
      filho.kill('SIGTERM');
    }
  }
};

export const parar = (id) => {
  const a = ambientes.get(id);
  if (!a) return false;
  a.parando = true;
  for (const p of a.processos) matar(p.filho);
  ambientes.delete(id);
  return true;
};

export const pararTodos = () => {
  for (const id of [...ambientes.keys()]) parar(id);
};

export const rodando = (id) => ambientes.has(id);

// processos: [{ nome, comando, pasta }]. aoLinha(texto, tipo) recebe o log; aoSair(nome, codigo) quando um cai.
// "DATABASE_URL=file:./dev.db PORT=5181 node dist/main.js" funciona no bash, mas o cmd do Windows não entende.
// Separa as variáveis do começo e passa como ambiente: o mesmo comando roda nos dois.
export const separarVariaveis = (comando) => {
  const env = {};
  let resto = String(comando).trim();
  for (;;) {
    const m = resto.match(/^([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|(\S*))\s+/);
    if (!m) break;
    env[m[1]] = m[3] ?? m[4] ?? m[5] ?? '';
    resto = resto.slice(m[0].length);
  }
  const cross = resto.match(/^(?:npx\s+)?cross-env\s+/);
  if (cross) {
    const r = separarVariaveis(resto.slice(cross[0].length));
    return { env: { ...env, ...r.env }, comando: r.comando };
  }
  return { env, comando: resto };
};

export const iniciar = (id, processos, { env = {}, aoLinha = () => {}, aoSair = () => {} } = {}) => {
  parar(id);
  const a = { processos: [], parando: false };
  ambientes.set(id, a);
  for (const p0 of processos) {
    const sep = separarVariaveis(p0.comando);
    const p = { ...p0, comando: sep.comando, env: { ...(p0.env ?? {}), ...sep.env } };
    const shell = process.platform === 'win32' ? { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', p.comando] } : { cmd: 'bash', args: ['-lc', p.comando] };
    aoLinha(`$ ${Object.keys(p.env).length ? `(${Object.keys(p.env).join(', ')}) ` : ''}${p.comando}${p.pasta ? `   (em ${p.pasta})` : ''}`, 'cmd');
    const filho = spawn(shell.cmd, shell.args, {
      cwd: p.pasta,
      env: { ...process.env, ...env, ...p.env, BROWSER: 'none', FORCE_COLOR: '0', CI: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      windowsVerbatimArguments: process.platform === 'win32',
    });
    const repassar = (d) =>
      d
        .toString()
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .split(/\r?\n/)
        .forEach((l) => l.trim() && aoLinha(`${processos.length > 1 ? `[${p.nome}] ` : ''}${l}`, 'saida'));
    filho.stdout.on('data', repassar);
    filho.stderr.on('data', repassar);
    filho.on('error', (e) => aoLinha(`✗ ${p.nome}: ${e.message}`, 'erro'));
    filho.on('close', (codigo) => {
      if (a.parando) return;
      aoLinha(`● ${p.nome} encerrou (código ${codigo})`, codigo ? 'erro' : 'info');
      aoSair(p.nome, codigo);
    });
    a.processos.push({ nome: p.nome, filho });
  }
};

// O endereço responde? Qualquer resposta HTTP serve (até 404: o servidor está no ar).
export const esperarNoAr = async (url, { ms = 180_000, vivo = () => true } = {}) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim && vivo()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      if (r.status > 0) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
};
