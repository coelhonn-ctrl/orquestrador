import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { comandoDe, montarArgs, resolverExecutavel, executar, explicarFalha, envDaIA, esquecerResolvidos } from './adaptadores.js';
import { atualizarPath } from './caminhos.js';

// Diagnóstico: um registro contínuo de cada chamada às IAs (logs/ias.log) e um relatório em .txt
// com tudo o que este computador está vendo. Feito para o usuário repassar quando algo não funciona.
// Nada de segredo entra: token do app, chaves de API e valores de variáveis ficam de fora.

const WIN = process.platform === 'win32';
const LIMITE_LOG = 2 * 1024 * 1024;
const COMANDOS = ['claude', 'agy', 'gemini', 'codex', 'ollama', 'node', 'npm', 'git', 'bash', 'uv', 'python', 'python3', 'ssh'];

const umaLinha = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(-n);
const recuo = (t) => (t ? t.replace(/^/gm, '      ') : '');
const ultimas = (t, n) => String(t ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).slice(-n).join('\n');

const rodar = (cmd, args, timeout = 15000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' }, (erro, saida, errSaida) =>
      resolve({ ok: !erro, saida: String(saida ?? '').trim(), erro: String(errSaida ?? '').trim() || (erro && !saida ? erro.message : '') }),
    );
  });

const lerFim = (arquivo, linhas) => {
  try {
    if (!arquivo || !fs.existsSync(arquivo)) return '(arquivo não encontrado)';
    const tamanho = fs.statSync(arquivo).size;
    const fd = fs.openSync(arquivo, 'r');
    const ler = Math.min(tamanho, 400_000);
    const buf = Buffer.alloc(ler);
    fs.readSync(fd, buf, 0, ler, tamanho - ler);
    fs.closeSync(fd);
    return ultimas(buf.toString('utf8'), linhas) || '(vazio)';
  } catch (e) {
    return `(não deu para ler: ${e.message})`;
  }
};

const escrevivel = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const teste = path.join(dir, `.teste-${process.pid}`);
    fs.writeFileSync(teste, 'ok');
    fs.unlinkSync(teste);
    return 'ok';
  } catch (e) {
    return `SEM PERMISSÃO (${e.code ?? e.message})`;
  }
};

export const criarDiagnostico = ({ cfg, store, headroom }) => {
  const pastaLogs = path.join(cfg.dados, 'logs');
  const arquivoIAs = path.join(pastaLogs, 'ias.log');

  // Uma entrada por chamada a uma IA: quando, qual, comando, pasta, código, tempo e o fim da saída de erro.
  const registrarExecucao = (r) => {
    try {
      fs.mkdirSync(pastaLogs, { recursive: true });
      if (fs.existsSync(arquivoIAs) && fs.statSync(arquivoIAs).size > LIMITE_LOG) fs.renameSync(arquivoIAs, `${arquivoIAs}.1`);
      const cab = `${new Date().toISOString()} ${r.ia} código ${r.codigo}${r.timeout ? ' (tempo esgotado)' : ''} em ${(r.ms / 1000).toFixed(1)}s`;
      const corpo = [`  comando: ${[r.comando, ...(r.args ?? [])].join(' ')}`, `  pasta: ${r.pasta}`];
      if (r.codigo !== 0) corpo.push(`  erro: ${umaLinha(r.erro, 1200) || '(vazio)'}`);
      corpo.push(`  saída: ${umaLinha(r.saida, r.codigo === 0 ? 400 : 600) || '(vazia)'}`);
      fs.appendFileSync(arquivoIAs, `${cab}\n${corpo.join('\n')}\n`);
    } catch {}
  };

  const ocultar = (texto, segredos) => {
    let t = texto;
    for (const s of segredos) if (s && s.length >= 6) t = t.split(s).join('[oculto]');
    return t
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[chave oculta]')
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[chave oculta]')
      .replace(/([?&]token=)[^&\s"]+/gi, '$1[oculto]')
      .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[oculto]');
  };

  const onde = async (cmd) => {
    const r = WIN ? await rodar('where', [cmd]) : await rodar('sh', ['-c', 'command -v "$1"', 'sh', cmd]);
    return r.ok ? r.saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  };

  const versaoDe = async (caminho) => {
    const alvo = resolverExecutavel(caminho, ['--version']);
    const r = await rodar(alvo.comando, alvo.args, 20000);
    return umaLinha(r.saida || r.erro, 160) || '(sem resposta)';
  };

  const gerar = async ({ testar = true } = {}) => {
    atualizarPath();
    esquecerResolvidos();
    const L = [];
    const sec = (titulo) => L.push('', `===== ${titulo} =====`);
    const ias = await store.listar('ias');
    const segredos = [cfg.token, ...ias.flatMap((i) => Object.values(i.env ?? {}).map(String))];
    let versao = '?';
    try {
      versao = JSON.parse(fs.readFileSync(path.join(cfg.raiz, 'package.json'), 'utf8')).version;
    } catch {}

    L.push('Singularize Orquestrador · diagnóstico', `Gerado em: ${new Date().toLocaleString('pt-BR')} (${new Date().toISOString()})`);
    sec('Sistema');
    L.push(
      `Versão do app: ${versao}`,
      `Sistema: ${os.type()} ${os.release()} (${process.platform} ${process.arch})`,
      `Node do app: ${process.version}${process.env.ORQ_VERSAO_ELECTRON ? ` · Electron ${process.env.ORQ_VERSAO_ELECTRON}` : ''}`,
      `App de desktop: ${process.env.ORQ_DESKTOP ? 'sim' : 'não'}`,
      `Usuário / pasta pessoal: ${os.userInfo().username} · ${os.homedir()}`,
      `Memória livre: ${Math.round(os.freemem() / 1e6)} MB de ${Math.round(os.totalmem() / 1e6)} MB`,
    );

    sec('Pastas');
    L.push(
      `Dados do app: ${cfg.dados} · gravação: ${escrevivel(cfg.dados)}`,
      `Cérebro (vault): ${cfg.vault} · gravação: ${escrevivel(cfg.vault)}`,
      `Pasta padrão dos projetos: ${cfg.pastaProjetos} · existe: ${fs.existsSync(cfg.pastaProjetos) ? 'sim' : 'não'}`,
      `Pasta do app: ${cfg.raiz}`,
    );

    sec('PATH (onde o app procura os comandos)');
    const chave = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    for (const p of (process.env[chave] ?? '').split(path.delimiter).filter(Boolean)) L.push(`${fs.existsSync(p) ? '  ok   ' : '  falta'} ${p}`);

    sec('Comandos encontrados');
    for (const cmd of COMANDOS) {
      const achados = await onde(cmd);
      if (!achados.length) {
        L.push(`${cmd}: não encontrado`);
        continue;
      }
      L.push(`${cmd}: ${achados.join(' | ')}`);
      if (['claude', 'agy', 'gemini', 'codex', 'ollama', 'node', 'git'].includes(cmd)) L.push(`  versão: ${await versaoDe(cmd)}`);
    }
    if (WIN) {
      const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe')];
      L.push(`Git Bash (o Claude Code no Windows precisa dele): ${gitBash.filter((p) => fs.existsSync(p)).join(' | ') || 'não encontrado nos lugares comuns'}`);
    }

    sec('Variáveis de ambiente relevantes (só se existem; valores ocultos)');
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ComSpec', 'SHELL']) {
      const v = Object.entries(process.env).find(([x]) => x.toUpperCase() === k.toUpperCase())?.[1];
      L.push(`${k}: ${v === undefined ? '(não definida)' : ['ComSpec', 'SHELL', 'ELECTRON_RUN_AS_NODE'].includes(k) ? v : '(definida)'}`);
    }

    sec('IAs cadastradas');
    for (const ia of ias) {
      const alvo = ia.tipo === 'simulado' ? null : resolverExecutavel(comandoDe(ia), montarArgs(ia, '<prompt>'));
      L.push(
        `- ${ia.nome} [${ia.id}, tipo ${ia.tipo}] · ${ia.ativa ? 'LIGADA' : 'desligada'} · ${ia.status ?? '?'}${ia.limiteAte && Date.parse(ia.limiteAte) > Date.now() ? ` · SEM COTA até ${ia.limiteAte}` : ''}`,
        `    caminho detectado: ${ia.caminho ?? '(nenhum)'}`,
        alvo ? `    o app executa: ${[alvo.comando, ...alvo.args].join(' ')}` : '    (demonstração, não executa nada)',
        `    variáveis próprias: ${Object.keys(envDaIA(ia)).join(', ') || 'nenhuma'}`,
      );
    }

    sec('Equipes');
    for (const e of await store.listar('equipes')) L.push(`- ${e.nome} [${e.id}] · principal: ${e.principal || '(nenhuma)'} · reserva: ${e.reserva || '(nenhuma)'} · ${e.ativa === false ? 'desligada' : 'ativa'}${e.projetoId ? ` · projeto ${e.projetoId}` : ''}`);

    sec('Projetos');
    for (const p of await store.listar('projetos')) L.push(`- ${p.nome} · modo ${p.modo ?? 'automatico'} · pasta ${p.pasta} (${p.maquinaId ? `remota em ${p.maquinaId}` : fs.existsSync(p.pasta) ? 'existe' : 'NÃO EXISTE'}) · IAs: ${p.ias?.length ? p.ias.join(', ') : 'qualquer ligada'}`);

    const maquinas = await store.listar('maquinas');
    if (maquinas.length) {
      sec('Máquinas remotas');
      for (const m of maquinas) L.push(`- ${m.nome} · ${m.destino}${m.porta ? `:${m.porta}` : ''} · ${m.estado ?? 'não testada'}${m.erro ? ` · erro: ${m.erro}` : ''} · comandos lá: ${(m.comandos ?? []).join(', ') || '-'}`);
    }

    sec('Tarefas com problema (últimas 10)');
    const problemas = (await store.listar('tarefas')).filter((t) => ['falhou', 'esperando'].includes(t.estado)).slice(-10);
    if (!problemas.length) L.push('(nenhuma)');
    for (const t of problemas) L.push(`- ${t.id} · ${t.estado} · ${t.fase}`);

    sec('Headroom');
    try {
      const h = await headroom.estado();
      L.push(`instalado: ${h.instalado ? 'sim' : 'não'} · ligado: ${h.usar ? 'sim' : 'não'} · proxy no ar: ${h.rodando ? 'sim' : 'não'}${h.erro ? ` · erro: ${h.erro}` : ''}`);
    } catch (e) {
      L.push(`(não deu para ler: ${e.message})`);
    }

    if (testar) {
      sec('Teste ao vivo de cada IA ligada (mesmo pedido do botão Testar)');
      const ligadas = ias.filter((i) => i.ativa && !['shell', 'simulado'].includes(i.tipo));
      if (!ligadas.length) L.push('(nenhuma IA real ligada)');
      for (const ia of ligadas) {
        const r = await executar(ia, 'Responda apenas com o JSON {"status":"ok"}', { cwd: os.homedir(), timeoutMs: 90_000, envExtra: await headroom.envPara(ia).catch(() => ({})) });
        L.push(
          `- ${ia.nome}: ${r.codigo === 0 ? 'RESPONDEU' : 'FALHOU'} · código ${r.codigo}${r.timeout ? ' (tempo esgotado)' : ''}${r.codigo === 0 ? '' : ` · ${explicarFalha(ia, r)}`}`,
          `    saída:\n${recuo(ultimas(r.saida, 25)) || '      (vazia)'}`,
          `    erros:\n${recuo(ultimas(r.erro, 40)) || '      (vazio)'}`,
        );
      }
    }

    sec(`Últimas chamadas às IAs (${arquivoIAs})`);
    L.push(lerFim(arquivoIAs, 150));
    sec(`Registro do servidor (${process.env.ORQ_LOG_ARQUIVO ?? 'sem arquivo: rodando fora do app de desktop'})`);
    L.push(process.env.ORQ_LOG_ARQUIVO ? lerFim(process.env.ORQ_LOG_ARQUIVO, 200) : '(não se aplica)');

    const texto = ocultar(L.join('\n'), segredos);
    const pasta = path.join(path.dirname(cfg.vault), 'diagnosticos');
    const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    let arquivo = path.join(pasta, `diagnostico-${carimbo}.txt`);
    try {
      fs.mkdirSync(pasta, { recursive: true });
      fs.writeFileSync(arquivo, texto);
    } catch {
      arquivo = path.join(pastaLogs, `diagnostico-${carimbo}.txt`);
      fs.mkdirSync(pastaLogs, { recursive: true });
      fs.writeFileSync(arquivo, texto);
    }
    return { arquivo, texto };
  };

  return { registrarExecucao, gerar, arquivoIAs };
};
