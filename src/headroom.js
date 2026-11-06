import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { detectar, resolverExecutavel, esquecerResolvidos, definirAoFalharProxy } from './adaptadores.js';
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
  let estado = { instalado: false, caminho: null, rodando: false, instalando: false, erro: '', porta: null, modo: 'normal' };
  let ultimas = []; // últimas linhas do proxy (para dizer o motivo quando ele não sobe)
  let reinicios = []; // instantes dos reinícios automáticos
  let vigia = null;
  let semRust = false; // o Windows (Smart App Control/antivírus) bloqueou a parte compilada: roda em modo simples

  // Python no Windows escreve em cp1252 quando a saída não é um terminal, e o banner do Headroom usa caracteres
  // que o cp1252 não tem: o proxy morria na largada. UTF-8 sempre.
  const envProxy = () => ({ ...process.env, NO_COLOR: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(semRust ? { HEADROOM_REQUIRE_RUST_CORE: 'false' } : {}) });

  const log = (texto, tipo = 'saida') => bus.terminal('headroom', texto, tipo);

  const ajustes = async () => ({ ...PADRAO, ...((await store.obter('ajustes', 'headroom')) ?? {}) });

  const publicar = async () => {
    const a = await ajustes();
    const dados = { ...estado, ...a, compativeis: COMPATIVEIS };
    bus.emitir({ tipo: 'headroom', headroom: dados });
    return dados;
  };

  // Alguém responde na porta? (qualquer programa)
  const verificarPorta = async (porta) => {
    try {
      await fetch(`http://127.0.0.1:${porta}/`, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      return false;
    }
  };

  // É o Headroom mesmo? O proxy responde GET /health com {"status": "healthy", ...}.
  const ehHeadroom = async (porta) => {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/health`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return false;
      const j = await r.json().catch(() => null);
      return !!j && (typeof j.status === 'string' || 'stats' in j || 'optimize' in j);
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
      const filho = spawn(alvo.comando, alvo.args, { env: envProxy(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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

  // No Windows, o comando headroom é um atalho que abre o Python: matar só o atalho deixava o proxy órfão na porta.
  const matar = (filho) => {
    if (!filho) return;
    if (process.platform === 'win32' && filho.pid) execFile('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else filho.kill('SIGTERM');
  };

  const parar = async () => {
    clearInterval(vigia);
    vigia = null;
    if (proxy) {
      const p = proxy;
      proxy = null;
      p.__parado = true;
      matar(p);
    }
    estado.rodando = false;
  };

  // Por que não subiu, em português, a partir do que o proxy escreveu.
  const motivo = () => {
    const t = ultimas.join('\n');
    if (/WinError 10013|EACCES|forbidden by its access permissions|permiss[aã]o/i.test(t)) return 'porta-bloqueada';
    if (/WinError 10048|address already in use|already in use|Errno 98/i.test(t)) return 'porta-ocupada';
    if (/DLL load failed|_core|application control policy|Smart App Control/i.test(t)) return 'dll-bloqueada';
    if (/UnicodeEncodeError|charmap/i.test(t)) return 'codificacao';
    if (/No module named|ModuleNotFoundError|ImportError|missing .*extra|pip install/i.test(t)) return 'dependencia';
    return '';
  };
  const EXPLICA = {
    'porta-bloqueada': 'o Windows reservou a porta (acontece com Docker, WSL ou Hyper-V)',
    'porta-ocupada': 'outro programa está usando a porta',
    'dll-bloqueada': 'o Windows (Smart App Control ou antivírus) bloqueou um arquivo do Headroom',
    codificacao: 'erro de codificação de texto do Python',
    dependencia: 'faltam partes do Headroom (reinstale)',
  };

  // Sobe o proxy numa porta e espera ele responder. Devolve true se ficou no ar.
  const subir = async (porta) => {
    ultimas = [];
    const extra = semRust ? ['--no-optimize'] : [];
    log(`$ headroom proxy --port ${porta}${extra.length ? ` ${extra.join(' ')}` : ''}`, 'cmd');
    const alvo = resolverExecutavel(estado.caminho ?? 'headroom', ['proxy', '--port', String(porta), ...extra]);
    const filho = spawn(alvo.comando, alvo.args, { env: envProxy(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    proxy = filho;
    let saiu = null;
    const repassar = (d) =>
      d
        .toString()
        .split('\n')
        .forEach((l) => {
          if (!l.trim()) return;
          ultimas.push(l);
          if (ultimas.length > 60) ultimas.shift();
          log(l);
        });
    filho.stdout.on('data', repassar);
    filho.stderr.on('data', repassar);
    filho.on('error', (e) => {
      ultimas.push(e.message);
      saiu = -1;
    });
    filho.on('close', (codigo) => {
      saiu = codigo ?? 0;
      if (proxy === filho) {
        proxy = null;
        const estava = estado.rodando;
        estado.rodando = false;
        if (!filho.__parado) {
          log(`● Proxy encerrado (código ${codigo})`, codigo ? 'erro' : 'info');
          // Caiu depois de estar no ar: tenta subir de novo sozinho (até 3 vezes em 10 minutos).
          if (estava) reerguer('o proxy caiu');
        }
        publicar();
      }
    });
    // Python no Windows pode levar uns segundos na primeira vez (antivírus, compilação); espera até 45 s.
    for (let i = 0; i < 90 && saiu === null; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if ((await ehHeadroom(porta)) || (i > 6 && (await verificarPorta(porta)))) return true;
    }
    if (saiu === null) {
      filho.__parado = true;
      matar(filho);
      ultimas.push('não respondeu em 45 s');
    }
    if (proxy === filho) proxy = null;
    return false;
  };

  const iniciar = async () => {
    const a = await ajustes();
    if (await ehHeadroom(a.porta)) {
      estado.rodando = true;
      estado.porta = a.porta;
      log(`● Proxy já respondendo na porta ${a.porta}`, 'info');
      vigiar();
      return;
    }
    if (!(await detectarInstalacao())) throw new Error('Headroom não está instalado.');
    // Tenta a porta escolhida e, se o Windows bloquear ou outro programa estiver nela, as próximas.
    const portas = [a.porta, ...Array.from({ length: 6 }, (_, i) => a.porta + 1 + i), 18787, 28787];
    let ultimoMotivo = '';
    for (const porta of portas) {
      if (porta > 65535) continue;
      if (porta !== a.porta && (await verificarPorta(porta))) continue;
      if (porta === a.porta && (await verificarPorta(porta))) {
        ultimoMotivo = 'porta-ocupada';
        log(`⚠ A porta ${porta} está ocupada por outro programa; tentando a próxima.`, 'aviso');
        continue;
      }
      if (await subir(porta)) {
        estado.rodando = true;
        estado.porta = porta;
        estado.modo = semRust ? 'simples' : 'normal';
        if (porta !== a.porta) {
          await store.salvar('ajustes', { id: 'headroom', ...a, porta });
          log(`✓ A porta ${a.porta} não serviu; o Headroom ficou na ${porta} (salvo).`, 'ok');
        }
        log(`✓ Proxy no ar em 127.0.0.1:${porta}${semRust ? ' (modo simples: sem compressão, o Windows bloqueou a parte otimizada)' : ''}`, 'ok');
        vigiar();
        return;
      }
      ultimoMotivo = motivo() || ultimoMotivo;
      if (ultimoMotivo === 'dll-bloqueada' && !semRust) {
        semRust = true;
        log('⚠ O Windows bloqueou a parte compilada do Headroom. Tentando o modo simples.', 'aviso');
        if (await subir(porta)) {
          estado.rodando = true;
          estado.porta = porta;
          estado.modo = 'simples';
          log(`✓ Proxy no ar em 127.0.0.1:${porta} (modo simples)`, 'ok');
          vigiar();
          return;
        }
        ultimoMotivo = motivo() || ultimoMotivo;
      }
      // Só vale tentar outra porta quando o problema é a porta.
      if (!['porta-bloqueada', 'porta-ocupada'].includes(ultimoMotivo)) break;
    }
    const linha = ultimas.filter((l) => /error|erro|exception|traceback|failed|denied/i.test(l)).slice(-1)[0] ?? ultimas.slice(-1)[0] ?? '';
    throw new Error(`O proxy não subiu${ultimoMotivo ? `: ${EXPLICA[ultimoMotivo]}` : ''}.${linha ? ` Última mensagem: ${linha.trim().slice(0, 200)}` : ''} As IAs seguem direto, sem o Headroom.`);
  };

  // A cada 30 s confere se o proxy segue respondendo; se não, as IAs vão direto e ele tenta subir de novo.
  const vigiar = () => {
    clearInterval(vigia);
    vigia = setInterval(async () => {
      const a = await ajustes();
      if (!a.usar) return clearInterval(vigia);
      const porta = estado.porta ?? a.porta;
      const ok = await ehHeadroom(porta);
      if (ok !== estado.rodando) {
        estado.rodando = ok;
        publicar();
      }
      if (!ok && !proxy) reerguer('o proxy parou de responder');
    }, 30_000);
    vigia.unref?.();
  };

  let reerguendo = false;
  const reerguer = async (porque) => {
    if (reerguendo) return;
    const agora = Date.now();
    reinicios = reinicios.filter((t) => agora - t < 10 * 60_000);
    if (reinicios.length >= 3) {
      estado.erro = 'O Headroom caiu várias vezes seguidas. As IAs seguem direto; veja o log e clique em Usar Headroom para tentar de novo.';
      log(`✗ ${estado.erro}`, 'erro');
      clearInterval(vigia);
      return publicar();
    }
    reinicios.push(agora);
    reerguendo = true;
    log(`↻ ${porque}; subindo de novo…`, 'aviso');
    try {
      await iniciar();
      estado.erro = '';
    } catch (e) {
      estado.erro = e.message;
      log(`✗ ${e.message}`, 'erro');
    } finally {
      reerguendo = false;
      publicar();
    }
  };

  // Uma IA não conseguiu falar com o proxy no meio de uma chamada (ela já foi refeita direto).
  definirAoFalharProxy((texto) => {
    log(`⚠ Uma IA não conseguiu passar pelo Headroom (${String(texto).trim().split('\n').pop().slice(0, 140)}). Ela foi refeita direto.`, 'aviso');
    estado.rodando = false;
    publicar();
    ehHeadroom(estado.porta ?? PADRAO.porta).then((ok) => {
      if (ok) {
        estado.rodando = true;
        publicar();
      } else if (!proxy) reerguer('o proxy não respondeu a uma IA');
    });
  });

  const configurar = async (mudancas) => {
    const a = await ajustes();
    if (mudancas.porta !== undefined) a.porta = Math.min(65535, Math.max(1024, Number(mudancas.porta) || PADRAO.porta));
    if (Array.isArray(mudancas.ias)) a.ias = mudancas.ias.map(String);
    if (mudancas.usar !== undefined) a.usar = !!mudancas.usar;
    await store.salvar('ajustes', { id: 'headroom', ...a });
    estado.erro = '';
    reinicios = [];
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
      const filho = spawn(alvo.comando, alvo.args, { env: envProxy(), windowsHide: true });
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
    const base = `http://127.0.0.1:${estado.porta ?? a.porta}`;
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
