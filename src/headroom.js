import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { detectar, resolverExecutavel, esquecerResolvidos } from './adaptadores.js';
import { atualizarPath } from './caminhos.js';

// Headroom (headroom-ai) é um proxy local que comprime o contexto antes de chegar ao provedor.
// O app instala, sobe e derruba o proxy, e aponta as IAs escolhidas para ele via variável de ambiente.
// Funciona com clientes Anthropic e OpenAI-compatíveis (Claude Code, Codex, CLIs customizados).

const COMPATIVEIS = ['claude', 'codex', 'custom'];
const PADRAO = { usar: false, porta: 8787, ias: ['claude', 'codex'] };

export const criarHeadroom = ({ store, bus, raiz }) => {
  const venv = path.join(raiz, '.headroom');
  const binVenv = path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', 'headroom');
  let proxy = null;
  let estado = { instalado: false, caminho: null, rodando: false, instalando: false, erro: '' };

  const log = (texto, tipo = 'saida') => bus.terminal('headroom', texto, tipo);

  const ajustes = async () => ({ ...PADRAO, ...((await store.obter('ajustes', 'headroom')) ?? {}) });

  const publicar = async () => {
    const a = await ajustes();
    const dados = { ...estado, ...a, compativeis: COMPATIVEIS };
    bus.emitir({ tipo: 'headroom', headroom: dados });
    return dados;
  };

  const verificarPorta = async (porta) => {
    try {
      await fetch(`http://127.0.0.1:${porta}/`, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      return false;
    }
  };

  const detectarInstalacao = async () => {
    estado.caminho = fs.existsSync(binVenv) ? binVenv : await detectar('headroom');
    estado.instalado = !!estado.caminho;
    return estado.instalado;
  };

  const rodarComando = (comando, args) =>
    new Promise((resolve) => {
      log(`$ ${comando} ${args.join(' ')}`, 'cmd');
      const alvo = resolverExecutavel(comando, args);
      const filho = spawn(alvo.comando, alvo.args, { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const repassar = (tipo) => (d) => d.toString().split('\n').forEach((l) => l.trim() && log(l, tipo));
      filho.stdout.on('data', repassar('saida'));
      filho.stderr.on('data', repassar('saida'));
      filho.on('error', (e) => resolve({ codigo: -1, erro: e.message }));
      filho.on('close', (codigo) => resolve({ codigo }));
    });

  // Um Python que funciona de verdade (no Windows, "python" pode ser só o atalho da Microsoft Store).
  const pythonServe = (cmd) =>
    new Promise((resolve) => {
      const alvo = resolverExecutavel(cmd, ['-c', 'import sys; print(int(sys.version_info >= (3, 10)))']);
      execFile(alvo.comando, alvo.args, { timeout: 15000, windowsHide: true }, (erro, saida) => resolve(!erro && saida.trim() === '1'));
    });

  // O que falta para instalar o Headroom. { ok: true } quando dá para seguir.
  const requisitos = async () => {
    atualizarPath();
    esquecerResolvidos();
    if (await detectar('uv')) return { ok: true, via: 'uv' };
    if (await detectar('pipx')) return { ok: true, via: 'pipx' };
    for (const cmd of ['python3', 'python']) if ((await detectar(cmd)) && (await pythonServe(cmd))) return { ok: true, via: cmd };
    return { ok: false, falta: 'python' };
  };

  const instalar = async ({ completo = false } = {}) => {
    if (estado.instalando) return publicar();
    estado.instalando = true;
    estado.erro = '';
    await publicar();
    try {
      // [proxy] é leve; [all] traz o modelo de compressão (PyTorch, vários GB).
      const pacote = completo ? 'headroom-ai[all]' : 'headroom-ai[proxy]';
      const tentativas = [];
      if (await detectar('uv')) tentativas.push(['uv', ['tool', 'install', '--python', '3.13', pacote]]);
      if (await detectar('pipx')) tentativas.push(['pipx', ['install', pacote]]);
      atualizarPath();
      esquecerResolvidos();
      let python = null;
      for (const cmd of ['python3', 'python']) if (!python && (await detectar(cmd)) && (await pythonServe(cmd))) python = cmd;
      // Último recurso: um venv só do app, em .headroom/, sem mexer no Python do sistema.
      if (python) tentativas.push(['venv', python]);
      if (!tentativas.length) throw new Error('Falta o Python. Clique em Instalar Headroom para instalá-lo (pedimos sua permissão antes).');
      for (const [cmd, args] of tentativas) {
        const r =
          cmd === 'venv'
            ? (await rodarComando(args, ['-m', 'venv', venv])).codigo === 0
              ? await rodarComando(path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', 'pip'), ['install', pacote])
              : { codigo: 1 }
            : await rodarComando(cmd, args);
        if (r.codigo === 0 && (await detectarInstalacao())) {
          log('✓ Headroom instalado', 'ok');
          return publicar();
        }
      }
      throw new Error('A instalação terminou, mas o comando headroom não apareceu no PATH. Veja o log.');
    } catch (e) {
      estado.erro = e.message;
      log(`✗ ${e.message}`, 'erro');
      return publicar();
    } finally {
      estado.instalando = false;
      await publicar();
    }
  };

  const parar = async () => {
    if (proxy) {
      proxy.kill('SIGTERM');
      proxy = null;
    }
    estado.rodando = false;
  };

  const iniciar = async () => {
    const a = await ajustes();
    if (await verificarPorta(a.porta)) {
      estado.rodando = true;
      log(`● Proxy já respondendo na porta ${a.porta}`, 'info');
      return;
    }
    if (!(await detectarInstalacao())) throw new Error('Headroom não está instalado.');
    log(`$ headroom proxy --port ${a.porta}`, 'cmd');
    const alvo = resolverExecutavel(estado.caminho ?? 'headroom', ['proxy', '--port', String(a.porta)]);
    proxy = spawn(alvo.comando, alvo.args, { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const repassar = (d) => d.toString().split('\n').forEach((l) => l.trim() && log(l));
    proxy.stdout.on('data', repassar);
    proxy.stderr.on('data', repassar);
    proxy.on('close', (codigo) => {
      proxy = null;
      estado.rodando = false;
      log(`● Proxy encerrado (código ${codigo})`, codigo ? 'erro' : 'info');
      publicar();
    });
    for (let i = 0; i < 20 && proxy; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await verificarPorta(a.porta)) {
        estado.rodando = true;
        log(`✓ Proxy no ar em 127.0.0.1:${a.porta}`, 'ok');
        return;
      }
    }
    if (!estado.rodando) throw new Error('O proxy não respondeu. Veja o log do Headroom.');
  };

  const configurar = async (mudancas) => {
    const a = await ajustes();
    if (mudancas.porta !== undefined) a.porta = Math.min(65535, Math.max(1024, Number(mudancas.porta) || PADRAO.porta));
    if (Array.isArray(mudancas.ias)) a.ias = mudancas.ias.map(String);
    if (mudancas.usar !== undefined) a.usar = !!mudancas.usar;
    await store.salvar('ajustes', { id: 'headroom', ...a });
    estado.erro = '';
    try {
      if (a.usar) {
        if (mudancas.porta !== undefined) await parar();
        await iniciar();
      } else await parar();
    } catch (e) {
      estado.erro = e.message;
      log(`✗ ${e.message}`, 'erro');
    }
    return publicar();
  };

  const economia = async () => {
    if (!(await detectarInstalacao())) return 'Headroom não está instalado.';
    return new Promise((resolve) => {
      let saida = '';
      const alvo = resolverExecutavel(estado.caminho ?? 'headroom', ['savings']);
      const filho = spawn(alvo.comando, alvo.args, { env: { ...process.env, NO_COLOR: '1' } });
      filho.stdout.on('data', (d) => (saida += d));
      filho.stderr.on('data', (d) => (saida += d));
      filho.on('error', (e) => resolve(e.message));
      filho.on('close', () => resolve(saida.replace(/\x1b\[[0-9;]*m/g, '').trim() || 'Sem dados ainda.'));
    });
  };

  // Variáveis que fazem a IA passar pelo proxy. Só quando ligado, no ar e escolhida para essa IA.
  const envPara = async (ia) => {
    const a = await ajustes();
    if (!a.usar || !estado.rodando || !COMPATIVEIS.includes(ia.tipo) || !a.ias.includes(ia.id)) return {};
    const base = `http://127.0.0.1:${a.porta}`;
    return { ANTHROPIC_BASE_URL: base, OPENAI_BASE_URL: `${base}/v1` };
  };

  const iniciarSeLigado = async () => {
    await detectarInstalacao();
    const a = await ajustes();
    if (a.usar) {
      try {
        await iniciar();
      } catch (e) {
        estado.erro = e.message;
        log(`✗ ${e.message}`, 'erro');
      }
    }
    return publicar();
  };

  return { publicar, instalar, requisitos, configurar, economia, envPara, iniciarSeLigado, parar, estado: () => publicar() };
};
