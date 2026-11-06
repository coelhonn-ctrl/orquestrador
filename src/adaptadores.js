import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';

// Cada IA é só um comando de terminal. {prompt} e {modelo} são trocados na hora de rodar.
// "capacidades" diz o que a ferramenta consegue: ler arquivos do disco e editar o projeto.
// O gestor usa isso para não mandar uma etapa de código para quem não edita arquivos.
export const TIPOS = {
  claude: {
    rotulo: 'Claude Code',
    comando: 'claude',
    // acceptEdits: edita arquivos sem perguntar. Busca na web e leitura liberadas (a equipe de Pesquisa precisa);
    // comandos de terminal continuam bloqueados no modo sem tela.
    // Agent: a ferramenta de sub-agentes do Claude Code. Liberada para o supervisor dividir a etapa
    // em partes independentes e rodar em paralelo (cada sub-agente com contexto próprio).
    args: ['-p', '{prompt}', '--permission-mode', 'acceptEdits', '--allowedTools', 'WebSearch,WebFetch,Read,Glob,Grep,Agent'],
    // O comando orq (falar com outros agentes, consultar o cérebro) já vem liberado.
    interativo: ['--allowedTools', 'Bash(orq:*)'],
    capacidades: { arquivos: true, editar: true },
    // Modelo por nível de dificuldade (apelidos do Claude Code: sempre o mais novo de cada família).
    flagModelo: '--model',
    niveis: { rapido: 'haiku', padrao: 'sonnet', forte: 'opus' },
  },
  // A IA do Google pelo terminal. O Gemini CLI saiu do app: o Google o desativou para contas pessoais em 18/06/2026.
  antigravity: {
    rotulo: 'Antigravity CLI (Google)',
    comando: 'agy',
    // accept-edits: edita arquivos sem perguntar; comandos sem aprovação ficam recusados no modo sem tela.
    args: ['-p', '{prompt}', '--mode', 'accept-edits'],
    interativo: [],
    capacidades: { arquivos: true, editar: true },
  },
  codex: {
    rotulo: 'Codex CLI',
    comando: 'codex',
    // Sem --skip-git-repo-check o Codex recusa pastas que não são repositório git.
    args: ['exec', '--skip-git-repo-check', '--full-auto', '{prompt}'],
    interativo: [],
    capacidades: { arquivos: true, editar: true },
    // Sem modelos padrão: usa o que estiver configurado no Codex. Dá para preencher em IAs.
    flagModelo: '-m',
    niveis: { rapido: '', padrao: '', forte: '' },
  },
  ollama: {
    rotulo: 'Ollama',
    comando: 'ollama',
    args: ['run', '{modelo}', '{prompt}'],
    interativo: ['run', '{modelo}'],
    modelo: 'qwen2.5-coder:14b',
    capacidades: { arquivos: false, editar: false },
  },
  custom: {
    rotulo: 'Outro CLI',
    comando: '',
    args: ['{prompt}'],
    interativo: [],
    capacidades: { arquivos: false, editar: false },
  },
  // Terminal comum: só para a tela livre (o gestor nunca usa).
  shell: {
    rotulo: 'Terminal (shell)',
    comando: '',
    args: [],
    interativo: [],
    capacidades: { arquivos: true, editar: true },
  },
  simulado: {
    rotulo: 'Simulado',
    comando: '',
    args: [],
    capacidades: { arquivos: true, editar: true },
  },
};

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r/g;

export const ehLimiteDeCota = (texto) =>
  /rate.?limit|quota|usage limit|limit reached|hit your (?:[\w-]+ )?limit|(?:weekly|session|daily|5-hour|opus|sonnet) limit|out of (?:extra )?usage|too many requests|resource.?exhausted|\b429\b|credit balance/i.test(texto);

// A resposta trouxe aviso de cota? Na saída de erro sempre conta; na saída normal só se ela for curta
// (uma resposta de verdade que fala de "rate limit" não pode tirar a IA de uso).
export const respostaDeCota = (r) => ehLimiteDeCota(r?.erro ?? '') || ((r?.codigo !== 0 || (r?.saida ?? '').length < 600) && ehLimiteDeCota(r?.saida ?? ''));

// Quando a cota volta. As CLIs costumam dizer ("resets 5:50pm", "continuing automatically at 6pm",
// ou "limit reached|1717000000"); sem isso, usa a pausa padrão.
export const fimDaCota = (texto, padraoMs, agora = Date.now()) => {
  const t = String(texto ?? '');
  const epoca = t.match(/\|(\d{10})\b/);
  if (epoca) {
    const ms = Number(epoca[1]) * 1000;
    if (ms > agora && ms - agora < 8 * 86_400_000) return new Date(ms + 60_000).toISOString();
  }
  // "resets Nov 8, 2am" (limite semanal: dia e hora)
  const MESES = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11 };
  const dia = t.match(/\b(?:resets?|reset at|available again)\s+(?:on\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (dia && MESES[dia[1].toLowerCase()] !== undefined) {
    let h = Number(dia[3]);
    if (dia[5]) h = (h % 12) + (/pm/i.test(dia[5]) ? 12 : 0);
    const d = new Date(agora);
    d.setMonth(MESES[dia[1].toLowerCase()], Number(dia[2]));
    d.setHours(h, Number(dia[4] ?? 0), 0, 0);
    if (d.getTime() < agora - 86_400_000) d.setFullYear(d.getFullYear() + 1);
    if (d.getTime() > agora && d.getTime() - agora < 8 * 86_400_000) return new Date(d.getTime() + 60_000).toISOString();
  }
  const m = t.match(/\b(?:resets?|reset at|available again at|automatically at|try again at)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m && (m[3] || m[2])) {
    let h = Number(m[1]);
    if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    if (h < 24) {
      const d = new Date(agora);
      d.setHours(h, Number(m[2] ?? 0), 0, 0);
      if (d.getTime() <= agora) d.setDate(d.getDate() + 1);
      return new Date(d.getTime() + 60_000).toISOString();
    }
  }
  return new Date(agora + padraoMs).toISOString();
};

const shellPadrao = () => process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');

export const comandoDe = (ia) => ia.comando || (ia.tipo === 'shell' ? shellPadrao() : TIPOS[ia.tipo]?.comando) || '';

export const argsInterativos = (ia) => {
  const base = ia.argsInterativo?.length ? ia.argsInterativo : TIPOS[ia.tipo]?.interativo ?? [];
  return base.map((a) => a.replaceAll('{modelo}', () => ia.modelo || TIPOS[ia.tipo]?.modelo || '')).filter((a) => a !== '');
};

// Variáveis que o tipo precisa + as que você configurou na IA (as suas valem mais).
export const envDaIA = (ia) => ({ ...(TIPOS[ia.tipo]?.env ?? {}), ...(ia.env ?? {}) });

// Traduz a falha de uma IA num motivo que dá para agir. Devolve '' quando não reconhece.
export const explicarFalha = (ia, r) => {
  // Avisos não são erro: o Claude, por exemplo, avisa quando o login vai vencer mesmo respondendo certo.
  const semAvisos = (t) => String(t ?? '').replace(ANSI, '').split('\n').filter((l) => !/^\s*warning\b/i.test(l)).join('\n');
  const texto = `${semAvisos(r.erro)}\n${semAvisos(r.saida)}`;
  const trecho = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 220);
  if (r.timeout) return 'demorou demais e foi interrompida';
  if (/no longer supported for Gemini Code Assist|migrate to the Antigravity|stopped serving requests/i.test(texto)) return 'não aceita mais contas pessoais do Google (o Google trocou o Gemini CLI pelo Antigravity). Em IAs, escolha o Antigravity CLI';
  if (ehLimiteDeCota(texto)) return 'sem cota no momento';
  // Saiu sem erro, mas a resposta não trouxe o JSON pedido: mostra o começo do que ela respondeu.
  if (r.codigo === 0) return `respondeu, mas não no formato que o app pediu${trecho(semAvisos(r.saida)) ? `. Ela disse: "${trecho(semAvisos(r.saida))}"` : ' (resposta vazia)'}`;
  if (/ENOENT|not recognized|command not found|não é reconhecido/i.test(texto)) return 'o comando não foi encontrado. Em IAs, clique em Procurar de novo ou Instalar';
  if (/trusted (directory|folder)|skip-git-repo-check/i.test(texto)) return 'recusou a pasta do projeto por segurança (pasta não confiável)';
  if (/auth method|not (logged|authenticated)|please (log|sign) ?in|login required|authentication (required|failed|error)|invalid api key|unauthori[sz]ed|\b401\b|run \/login/i.test(texto)) return 'não está logada. Em IAs, clique em Entrar na conta';
  const ultima = texto.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  return `saiu com código ${r.codigo}${ultima ? `: ${ultima.slice(0, 160)}` : ''}`;
};

// Falha que não passa sozinha (bloqueio, falta de login, comando sumiu): a IA fica "com problema"
// e o gestor para de escolhê-la até ela passar no Testar ou alguém entrar na conta de novo.
export const falhaPermanente = (motivo) => /não aceita mais contas pessoais|não está logada|comando não foi encontrado/.test(motivo ?? '');

// Comandos de terminal que a IA pode rodar sozinha. Sem tela (modo -p), o Claude Code não tem como pedir
// aprovação: o que não está liberado é recusado na hora, em silêncio. Esta lista vira --allowedTools Bash(cmd:*).
export const COMANDOS_PADRAO = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'tsc', 'vitest', 'jest', 'prisma', 'eslint', 'prettier', 'python', 'python3', 'pip', 'pytest', 'git status', 'git diff', 'git log', 'ls', 'dir', 'mkdir', 'cat', 'dotnet', 'go', 'cargo', 'gradle', 'gradlew', './gradlew', 'flutter'];
let comandosLiberados = COMANDOS_PADRAO;
export const definirComandosLiberados = (lista) => {
  comandosLiberados = Array.isArray(lista) ? lista.map((c) => String(c).trim()).filter(Boolean) : COMANDOS_PADRAO;
};
const comPermissoes = (ia, args) => {
  if (ia.tipo !== 'claude' || ia.args?.length || !comandosLiberados.length) return args;
  const i = args.indexOf('--allowedTools');
  const extra = comandosLiberados.map((c) => `Bash(${c.replace(/[(),]/g, '')}:*)`).join(',');
  if (i < 0) return [...args, '--allowedTools', extra];
  const novos = [...args];
  novos[i + 1] = `${novos[i + 1]},${extra}`;
  return novos;
};

export const montarArgs = (ia, prompt) => {
  const base = ia.args?.length ? ia.args : TIPOS[ia.tipo]?.args ?? ['{prompt}'];
  return base
    .map((a) => a.replaceAll('{prompt}', () => prompt).replaceAll('{modelo}', () => ia.modelo || TIPOS[ia.tipo]?.modelo || ''))
    .filter((a) => a !== '');
};

// No Windows, ferramentas instaladas pelo npm (codex…) são atalhos .cmd. O Node não abre
// .cmd sem o cmd.exe, e o cmd.exe quebra prompts com várias linhas. Então lemos o atalho e rodamos
// o script JS que ele aponta direto com o Node. .exe roda direto; o resto cai no cmd.exe.
const cacheResolvidos = new Map();
let nodeCache;
// Prefere o Node instalado no sistema; sem ele, o executável do app (em modo Node) serve.
const nodeDoSistema = () => {
  if (nodeCache !== undefined) return nodeCache;
  try {
    nodeCache = execFileSync('where', ['node'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null;
  } catch {
    nodeCache = null;
  }
  return nodeCache;
};

export const envDoProcesso = (comando, env) => {
  if (comando === process.execPath && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
  return env;
};

export const esquecerResolvidos = () => {
  cacheResolvidos.clear();
  nodeCache = undefined;
};
export const resolverExecutavel = (comando, args) => {
  if (process.platform !== 'win32' || !comando) return { comando, args };
  let caminho = cacheResolvidos.get(comando);
  if (caminho === undefined) {
    try {
      const saida = execFileSync('where', [comando], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const opcoes = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      caminho = opcoes.find((o) => /\.exe$/i.test(o)) ?? opcoes.find((o) => /\.(cmd|bat)$/i.test(o)) ?? opcoes[0] ?? null;
    } catch {
      caminho = null;
    }
    cacheResolvidos.set(comando, caminho);
  }
  if (!caminho) return { comando, args };
  if (/\.exe$/i.test(caminho)) return { comando: caminho, args };
  if (/\.(cmd|bat)$/i.test(caminho)) {
    const atalho = fs.readFileSync(caminho, 'utf8');
    const alvo = atalho.match(/"%(?:~)?dp0%\\?([^"]+?\.(?:c|m)?js)"/i)?.[1];
    if (alvo) return { comando: nodeDoSistema() ?? process.execPath, args: [path.join(path.dirname(caminho), alvo), ...args] };
    return { comando: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', caminho, ...args] };
  }
  return { comando: caminho, args };
};

export const detectar = (comando) =>
  new Promise((resolve) => {
    if (!comando) return resolve(null);
    const [prog, args] = process.platform === 'win32' ? ['where', [comando]] : ['sh', ['-c', 'command -v "$1"', 'sh', comando]];
    execFile(prog, args, (erro, saida) => resolve(erro ? null : saida.split('\n')[0].trim() || null));
  });

// Registro de cada chamada (vai para o arquivo de diagnóstico). O servidor liga com definirRegistro.
let registrar = () => {};
export const definirRegistro = (fn) => {
  registrar = fn;
};
// Consumo de cada chamada (tokens estimados por equipe, IA e nível). O servidor liga com definirConsumo.
let contarConsumo = () => {};
export const definirConsumo = (fn) => {
  contarConsumo = fn;
};

export const NIVEIS = ['rapido', 'padrao', 'forte'];
// O modelo de um nível nesta IA: o que você configurou em IAs ou o padrão do tipo. '' = o padrão da própria ferramenta.
export const modeloDoNivel = (ia, nivel) => {
  if (!nivel || ia.args?.length || !TIPOS[ia.tipo]?.flagModelo) return '';
  const proprio = ia.niveis?.[nivel];
  return (proprio !== undefined && proprio !== null ? proprio : TIPOS[ia.tipo]?.niveis?.[nivel]) || '';
};
const MODELO_INDISPONIVEL = /(model|modelo)[^\n]{0,80}(not (found|available|supported|exist)|invalid|unknown|não (existe|disponível))|(invalid|unknown|unsupported) model|issue with the selected model/i;

// nivel: rapido | padrao | forte. Escolhe o modelo daquele nível; se a conta não tiver o modelo,
// roda de novo com o modelo padrão da ferramenta e avisa (r.modeloIndisponivel).
// Limite por modelo: no Claude Max, o Sonnet tem um limite semanal próprio, separado do total. Quando um modelo
// estoura, os outros da mesma conta podem continuar funcionando. Guarda até quando cada modelo está bloqueado.
const modeloBloqueado = new Map(); // `${ia}|${perfil}|${modelo}` -> ms
const chaveModelo = (ia, opcoes, m) => `${ia.id}|${opcoes.envExtra?.CLAUDE_CONFIG_DIR ?? opcoes.envExtra?.CODEX_HOME ?? ''}|${m}`;
const bloqueado = (ia, opcoes, m) => (modeloBloqueado.get(chaveModelo(ia, opcoes, m)) ?? 0) > Date.now();
// Os outros modelos da IA, do mais próximo ao pedido: forte → padrão → rápido; padrão → forte → rápido; rápido → padrão → forte.
const alternativas = (ia, nivel) => {
  const ordem = { forte: ['padrao', 'rapido'], padrao: ['forte', 'rapido'], rapido: ['padrao', 'forte'] }[nivel] ?? ['padrao', 'forte', 'rapido'];
  return [...new Set(ordem.map((n) => modeloDoNivel(ia, n)).filter(Boolean))];
};

// Headroom (proxy local) caiu ou respondeu erro: a chamada é refeita direto no provedor e o app é avisado.
const FALHA_PROXY = /ECONNREFUSED|ECONNRESET|socket hang up|fetch failed|Unable to connect to API|API Error: Connection error|Connection error\.|API Error: 50[0-4]|Bad Gateway|connect ETIMEDOUT/i;
let aoFalharProxy = () => {};
export const definirAoFalharProxy = (fn) => {
  aoFalharProxy = typeof fn === 'function' ? fn : () => {};
};
const PROXY_ENV = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL'];
const viaProxy = (opcoes) => PROXY_ENV.some((k) => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(opcoes.envExtra?.[k] ?? ''));
const semProxy = (opcoes) => {
  const env = { ...(opcoes.envExtra ?? {}) };
  for (const k of PROXY_ENV) delete env[k];
  return { ...opcoes, envExtra: env };
};

export const executar = async (ia, prompt, opcoes = {}) => {
  // Byte nulo derruba a chamada do processo (o sistema não aceita); nunca é útil num pedido.
  prompt = String(prompt).replace(/\0/g, '');
  const { nivel = null, rotulo = {} } = opcoes;
  const inicio = Date.now();
  let modelo = modeloDoNivel(ia, nivel);
  let trocado = null;
  // O modelo pedido está no limite: vai direto para outro que ainda tem cota.
  if (modelo && bloqueado(ia, opcoes, modelo)) {
    const livre = alternativas(ia, nivel).find((m) => m !== modelo && !bloqueado(ia, opcoes, m));
    if (livre) {
      trocado = { de: modelo, para: livre };
      modelo = livre;
    }
  }
  let r = ia.tipo === 'simulado' ? await simular(prompt, opcoes.aoLinha ?? (() => {}), opcoes.velocidade ?? 1, ia) : await executarUma(ia, prompt, opcoes, modelo);
  if (ia.tipo !== 'simulado' && r.codigo !== 0 && !r.timeout && viaProxy(opcoes) && FALHA_PROXY.test(`${r.erro}\n${r.saida}`)) {
    try {
      aoFalharProxy(`${r.erro}\n${r.saida}`.slice(-400));
    } catch {}
    opcoes = semProxy(opcoes);
    r = { ...(await executarUma(ia, prompt, opcoes, modelo)), semProxy: true };
  }
  if (modelo && r.codigo !== 0 && !r.timeout && MODELO_INDISPONIVEL.test(`${r.erro}\n${r.saida}`)) {
    const outra = await executarUma(ia, prompt, opcoes, '');
    r = { ...outra, modeloIndisponivel: modelo };
  }
  // Limite do modelo: tenta os outros modelos da mesma conta antes de dar a conta como sem cota.
  if (modelo && ia.tipo !== 'simulado' && !r.modeloIndisponivel && respostaDeCota(r)) {
    const texto = `${r.erro}\n${r.saida}`;
    modeloBloqueado.set(chaveModelo(ia, opcoes, modelo), Date.parse(fimDaCota(texto, 60 * 60_000)));
    for (const m of alternativas(ia, nivel).filter((x) => x !== modelo && !bloqueado(ia, opcoes, x))) {
      const outra = await executarUma(ia, prompt, opcoes, m);
      if (!respostaDeCota(outra)) {
        trocado = { de: trocado?.de ?? modelo, para: m, ate: new Date(modeloBloqueado.get(chaveModelo(ia, opcoes, modelo))).toISOString() };
        modelo = m;
        r = outra;
        break;
      }
      modeloBloqueado.set(chaveModelo(ia, opcoes, m), Date.parse(fimDaCota(`${outra.erro}\n${outra.saida}`, 60 * 60_000)));
    }
  }
  if (trocado) r.modeloTrocado = trocado;
  r.nivel = nivel;
  r.modelo = r.modeloIndisponivel ? '' : modelo;
  try {
    contarConsumo({ ia, nivel, modelo: r.modelo, entrada: prompt.length, saida: String(r.saida ?? '').length, ms: Date.now() - inicio, codigo: r.codigo, ...rotulo });
  } catch {}
  return r;
};

const executarUma = (ia, prompt, { cwd, timeoutMs, aoLinha = () => {}, envExtra = {}, incluir = [] }, modelo) => {
  return new Promise((resolve) => {
    const diretorio = cwd && fs.existsSync(cwd) ? cwd : process.cwd();
    let saida = '';
    let erro = '';
    let estourou = false;
    const pendente = { saida: '', erro: '' };

    // Libera a pasta do cérebro (a nota da tarefa e as áreas ficam lá, fora da pasta do projeto).
    const flagPasta = { claude: '--add-dir', antigravity: '--add-dir' }[ia.tipo];
    const pastasExtras = flagPasta && !ia.args?.length ? incluir.filter((p) => p && fs.existsSync(p)).flatMap((p) => [flagPasta, p]) : [];
    const flagModelo = modelo ? [TIPOS[ia.tipo].flagModelo, modelo] : [];
    const alvo = resolverExecutavel(comandoDe(ia), [...comPermissoes(ia, montarArgs(ia, prompt)), ...flagModelo, ...pastasExtras]);
    const filho = spawn(alvo.comando, alvo.args, {
      cwd: diretorio,
      env: envDoProcesso(alvo.comando, { ...process.env, ...envExtra, ...envDaIA(ia), NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Cota estourada: algumas ferramentas (o Gemini CLI, por exemplo) ficam tentando de novo por
    // minutos. Ao ver a mensagem de limite num erro, o app encerra na hora e passa para a próxima conta ou IA.
    let cortouPorCota = false;
    const vigiarCota = (linha, canal) => {
      // Só no canal de erro: a resposta normal pode falar de "429" ou "rate limit" (ex.: testes de API).
      if (cortouPorCota || canal !== 'erro' || !ehLimiteDeCota(linha)) return;
      cortouPorCota = true;
      setTimeout(() => {
        filho.kill('SIGTERM');
        setTimeout(() => filho.kill('SIGKILL'), 3000).unref();
      }, 1500).unref();
    };
    const consumir = (canal) => (pedaco) => {
      const texto = pedaco.toString().replace(ANSI, '');
      if (canal === 'saida') saida += texto;
      else erro += texto;
      const linhas = (pendente[canal] + texto).split('\n');
      pendente[canal] = linhas.pop();
      for (const l of linhas) {
        if (!l.trim()) continue;
        aoLinha(l, canal);
        vigiarCota(l, canal);
      }
    };

    filho.stdout.on('data', consumir('saida'));
    filho.stderr.on('data', consumir('erro'));

    const timer = setTimeout(() => {
      estourou = true;
      filho.kill('SIGTERM');
      setTimeout(() => filho.kill('SIGKILL'), 5000).unref();
    }, timeoutMs ?? 30 * 60_000);

    const inicio = Date.now();
    const anotar = (r) => {
      try {
        registrar({ ia: ia.id, comando: alvo.comando, args: alvo.args.map((x) => (x === prompt ? `<prompt ${prompt.length} caracteres>` : x)), pasta: diretorio, ...r, ms: Date.now() - inicio });
      } catch {}
      return r;
    };
    filho.on('error', (e) => {
      clearTimeout(timer);
      resolve(anotar({ codigo: -1, saida, erro: `${erro}\n${e.message}`, timeout: false }));
    });
    filho.on('close', (codigo) => {
      clearTimeout(timer);
      for (const canal of ['saida', 'erro']) if (pendente[canal].trim()) aoLinha(pendente[canal], canal);
      resolve(anotar({ codigo: cortouPorCota && codigo === 0 ? 1 : codigo ?? -1, saida, erro: cortouPorCota ? `${erro}\n(interrompida pelo app: limite de uso/cota)` : erro, timeout: estourou, cortouPorCota }));
    });
  });
};

// ---------------------------------------------------------------------------
// Modo simulado: deixa ver o sistema inteiro funcionando sem nenhuma IA instalada.

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const lerPedido = (prompt) => {
  const caminho = prompt.match(/^NOTA:\s*(.+)$/m)?.[1]?.trim();
  const nota = caminho && fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : prompt;
  return {
    pedido: nota.match(/## Pedido\n([\s\S]*?)(\n## |\n### |$)/)?.[1]?.trim() ?? '',
    respondido: /Resposta do usuário/.test(nota),
  };
};

const simular = async (prompt, aoLinha, velocidade, ia = null) => {
  // Demonstração do rodízio de contas: uma conta com SIM_COTA=1 responde como se tivesse batido o limite.
  if (ia?.env?.SIM_COTA === '1') return { codigo: 1, saida: '', erro: 'Error: 429 RESOURCE_EXHAUSTED: quota exceeded for this account (simulado)' };
  const passo = (ms) => esperar(ms / velocidade);
  const tipo = prompt.match(/^TIPO_ETAPA:\s*([\w-]+)/m)?.[1] ?? 'livre';
  const { pedido, respondido } = lerPedido(prompt);

  if (tipo === 'planejar') {
    const equipes = [...prompt.matchAll(/^- ([a-z0-9-]+):/gm)].map((m) => m[1]);
    aoLinha('● Lendo a nota da tarefa', 'saida');
    await passo(700);
    aoLinha('● Entendendo o propósito do pedido', 'saida');
    await passo(700);
    const tem = (id) => equipes.includes(id);
    const ehCodigo = /c[oó]digo|codar|implementa|endpoint|api\b|fun[cç][aã]o|bug|erro|falha|corrig|refator|tela|componente|teste|deploy|banco de dados|sql|script/i.test(pedido);
    const ehSeguranca = /segur|auth|jwt|token|senha|login|owasp|vulnerab/i.test(pedido);
    const ehEscrita = /escrev|texto|artigo|resumo|e-?mail|documenta|relat[oó]rio|apresenta/i.test(pedido);
    const etapas = [];
    const novasEquipes = [];
    // Usa a equipe se ela existe; se não, cria uma sob medida (como o gestor de verdade faz).
    const usar = (id, objetivo, nova) => {
      if (tem(id)) return etapas.push({ equipe: id, objetivo });
      if (!novasEquipes.some((n) => n.nome === nova.nome)) novasEquipes.push(nova);
      etapas.push({ equipe: nova.nome, objetivo });
    };
    let tipoPedido = 'pesquisa';
    if (ehCodigo) {
      tipoPedido = 'codigo';
      if (/bug|erro|falha|corrig|quebr/i.test(pedido)) usar('debug', 'Reproduzir o problema e isolar a causa.', { nome: 'Debug', desc: 'Reproduz o erro e isola a causa.', instrucoes: 'Reproduza antes de corrigir.', requerEditar: true });
      if (ehSeguranca) usar('seguranca', 'Definir os cuidados de segurança antes de implementar.', { nome: 'Segurança', desc: 'Revisa riscos de segurança.', instrucoes: 'Siga o OWASP.', requerEditar: true });
      usar('codigo', 'Implementar a solução com testes.', { nome: 'Código', desc: 'Implementa a solução com testes.', instrucoes: 'Implemente com testes.', requerEditar: true });
      if (/refator|limp|organiz/i.test(pedido) && tem('limpo')) etapas.push({ equipe: 'limpo', objetivo: 'Revisar nomes, duplicação e camadas.' });
    } else {
      tipoPedido = ehEscrita ? 'escrita' : 'pesquisa';
      usar('pesquisa', 'Levantar as informações pedidas em fontes confiáveis.', { nome: 'Pesquisa', desc: 'Busca informações em fontes confiáveis e resume o que encontrou.', instrucoes: 'Cite as fontes.', requerEditar: false });
      if (ehEscrita) usar('redacao', 'Escrever o resultado no formato pedido.', { nome: 'Redação', desc: 'Transforma o material levantado num texto claro e no formato pedido.', instrucoes: 'Escreva em português simples, sem enrolação, no formato que o pedido pede.', requerEditar: false });
    }
    if (!etapas.length) etapas.push({ equipe: equipes[0], objetivo: 'Resolver o pedido.' });
    // Dificuldade de exemplo: debug é difícil, o resto é médio; pergunta curta é trivial.
    const trivial = pedido.length < 80 && /\?\s*$/.test(pedido) && !ehCodigo;
    for (const e of etapas) e.dificuldade = trivial ? 'simples' : /reproduzir|isolar/i.test(e.objetivo) ? 'dificil' : 'media';
    if (trivial) etapas.splice(1);
    return {
      codigo: 0,
      erro: '',
      saida: JSON.stringify({
        tipo: tipoPedido,
        complexidade: trivial ? 'trivial' : 'normal',
        fase: `Pedido de ${tipoPedido}: ${etapas.length === 1 ? 'uma etapa' : `${etapas.length} etapas`} antes da avaliação.`,
        criterios: ['Atende exatamente ao que foi pedido', 'As informações estão corretas e completas', 'Está no formato pedido'],
        novasEquipes,
        etapas,
      }),
    };
  }

  // Treinamento: casos, cópias, respostas e notas de exemplo (a nota sobe a cada rodada).
  if (tipo.startsWith('treino')) {
    await passo(500);
    const quantos = (re, padrao) => Number(prompt.match(re)?.[1] ?? padrao);
    if (tipo === 'treino-casos') {
      const n = quantos(/Crie (\d+) casos/, 4);
      const casos = Array.from({ length: n }, (_, i) => ({ pedido: `Caso de exemplo ${i + 1} sobre o objetivo do treino`, criterios: ['Responde exatamente ao que foi pedido', 'Cita de onde tirou a informação', 'É claro e objetivo'] }));
      return { codigo: 0, erro: '', saida: JSON.stringify({ casos }) };
    }
    if (tipo === 'treino-variantes') {
      const n = quantos(/Crie (\d+) (?:versões|novas versões)/, 3);
      const rodada = /Rodada anterior/.test(prompt) ? 2 : 1;
      const abordagens = ['Checklist', 'Passo a passo', 'Perguntar o que falta', 'Fontes primeiro', 'Resumo direto', 'Exemplos'];
      const variantes = Array.from({ length: n }, (_, i) => ({ nome: abordagens[i % abordagens.length], instrucoes: `Versão ${rodada}.${i + 1} (${abordagens[i % abordagens.length]}): siga o objetivo, cite fontes, responda direto e confira os critérios antes de entregar.${'+'.repeat(rodada * (i + 1))}` }));
      return { codigo: 0, erro: '', saida: JSON.stringify({ variantes }) };
    }
    // Uma IA de demonstração com "forte" no nome responde melhor (serve para ver a promoção da reserva).
    if (tipo === 'treino-executar') return { codigo: 0, erro: '', saida: `Resposta de exemplo. ${prompt.match(/Versão [\d.]+[^\n]*/)?.[0] ?? ''}${/forte/i.test(ia?.nome ?? '') ? ' +++++' : ''}` };
    if (tipo === 'treino-julgar') {
      const casos = (prompt.match(/### Caso/g) ?? []).length || 1;
      const forca = (prompt.match(/\+/g) ?? []).length;
      const notas = Array.from({ length: casos }, (_, i) => ({ caso: i + 1, nota: Math.min(100, 60 + forca * 3 + i), falta: forca > 6 ? '' : 'Poderia citar a fonte com link.' }));
      return { codigo: 0, erro: '', saida: JSON.stringify({ notas }) };
    }
  }

  if (tipo === 'analisar-equipe') {
    await passo(600);
    const nome = prompt.match(/^- Nome: (.*)$/m)?.[1]?.trim() ?? 'Equipe';
    const existentes = [...prompt.matchAll(/^- ([a-z0-9-]+): ([^:\n]+):/gm)].map((m) => ({ id: m[1], nome: m[2].trim() }));
    const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const dup = existentes.find((e) => norm(e.nome) === norm(nome) || norm(nome).includes(norm(e.nome)));
    return { codigo: 0, erro: '', saida: JSON.stringify({ duplicada: dup ? { id: dup.id, motivo: `A equipe ${dup.nome} já cobre esse escopo (simulado).` } : null, nome: nome.replace(/^equipe (de )?/i, ''), desc: prompt.match(/^- O que faz: (.*)$/m)?.[1] ?? '', instrucoes: '', treino: { recomendado: true, nivel: 'leve', motivo: 'Escopo específico: um treino leve confirma o padrão antes de usar (simulado).' } }) };
  }

  if (tipo === 'questionar') {
    await passo(700);
    const pergunta = prompt.match(/perguntou:\n"([\s\S]*?)"\n/)?.[1] ?? '';
    return { codigo: 0, erro: '', saida: JSON.stringify({ status: 'ok', resumo: 'Respondido (simulado).', resposta: `Sobre "${pergunta}": no modo demonstração esta é uma resposta de exemplo. Com uma IA real, a equipe responde com base no que entregou e corrige se você apontou um erro.`, arquivos: [] }) };
  }

  if (tipo === 'avaliar') {
    aoLinha('● Conferindo critérios', 'saida');
    await passo(900);
    // Para ver a subida para o modelo forte: pedido com "reprovar" é reprovado até ser refeito.
    if (/reprovar/i.test(pedido) && !/Subiu para o modelo forte/.test(prompt + (fs.existsSync(prompt.match(/^NOTA:\s*(.+)$/m)?.[1]?.trim() ?? '') ? fs.readFileSync(prompt.match(/^NOTA:\s*(.+)$/m)[1].trim(), 'utf8') : ''))) {
      return { codigo: 0, erro: '', saida: JSON.stringify({ status: 'ok', aprovado: false, resumo: 'Faltou citar as fontes (simulado).', criterios: [{ texto: 'Cita as fontes', ok: false, obs: 'Nenhuma fonte na resposta.' }] }) };
    }
    if (pedido.includes('?') && !respondido) {
      return {
        codigo: 0,
        erro: '',
        saida: JSON.stringify({ status: 'pergunta', pergunta: 'O pedido tem uma dúvida em aberto. Sigo com a opção mais simples?', opcoes: ['Sim, a mais simples', 'Não, a mais completa'], resumo: 'Precisa de uma decisão.' }),
      };
    }
    return {
      codigo: 0,
      erro: '',
      saida: JSON.stringify({
        status: 'ok',
        aprovado: true,
        resumo: 'Entrega confere com o pedido.',
        criterios: [
          { texto: 'Atende exatamente ao que foi pedido', ok: true, obs: 'A resposta cobre o pedido.' },
          { texto: 'As informações estão corretas e completas', ok: true, obs: 'Conferido (simulado).' },
          { texto: 'Está no formato pedido', ok: true, obs: 'Formato ok.' },
        ],
      }),
    };
  }

  const linhas = ['● Lendo a nota da tarefa', '● Consultando a área no vault', '… agente interno trabalhando', '✓ etapa concluída'];
  for (const l of linhas) {
    aoLinha(l, 'saida');
    await passo(650 + Math.random() * 600);
  }
  if (tipo === 'livre') return { codigo: 0, erro: '', saida: 'Recebido. (modo simulado: nenhuma IA real rodou)' };
  const equipe = prompt.match(/^EQUIPE:\s*(.+)$/m)?.[1] ?? 'equipe';
  return {
    codigo: 0,
    erro: '',
    saida: `Trabalho feito.\n\`\`\`json\n${JSON.stringify({
      status: 'ok',
      resumo: `${equipe} concluiu a etapa (simulado).`,
      resposta: `## O que ${equipe} entregou\n\nNo modo demonstração, este é um texto de exemplo no lugar da entrega real.\n\n- Ponto principal do pedido: ${pedido.split('\n')[0].slice(0, 120) || 'o pedido'}\n- Fontes: exemplo.org (simulado)`,
      arquivos: [],
      aprendizado:
        equipe === 'Código' || equipe === 'Pesquisa'
          ? { titulo: equipe === 'Código' ? 'Separar regra de negócio do handler HTTP' : 'Confirmar dados em duas fontes', conceito: equipe === 'Código' ? 'A regra de negócio não deve depender do transporte (HTTP); assim ela é testável e reutilizável.' : 'Um dado só é confiável quando duas fontes independentes concordam.', metodo: equipe === 'Código' ? '1. Extraia a regra para uma função pura. 2. O handler só lê a requisição, chama a função e responde. 3. Teste a função sem servidor.' : '1. Ache o dado na fonte primária. 2. Confirme numa segunda fonte independente. 3. Cite as duas.', exemplo: `Aplicado na etapa de ${equipe} (simulado).` }
          : null,
    })}\n\`\`\``,
  };
};
