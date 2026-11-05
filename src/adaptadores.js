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
    args: ['-p', '{prompt}', '--permission-mode', 'acceptEdits', '--allowedTools', 'WebSearch,WebFetch,Read,Glob,Grep'],
    // O comando orq (falar com outros agentes, consultar o cérebro) já vem liberado.
    interativo: ['--allowedTools', 'Bash(orq:*)'],
    capacidades: { arquivos: true, editar: true },
  },
  gemini: {
    rotulo: 'Gemini CLI',
    comando: 'gemini',
    // auto_edit: edita arquivos sem perguntar (como o acceptEdits do Claude); comandos continuam pedindo.
    args: ['-p', '{prompt}', '--approval-mode', 'auto_edit'],
    interativo: [],
    // Sem isso o Gemini recusa rodar numa pasta nova ("not running in a trusted directory", código 55).
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    capacidades: { arquivos: true, editar: true },
  },
  // Substituto do Gemini CLI para contas pessoais do Google (o Gemini CLI parou de aceitar essas contas em 18/06/2026).
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
  /rate.?limit|quota|usage limit|limit reached|too many requests|resource.?exhausted|\b429\b|credit balance/i.test(texto);

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

export const montarArgs = (ia, prompt) => {
  const base = ia.args?.length ? ia.args : TIPOS[ia.tipo]?.args ?? ['{prompt}'];
  return base
    .map((a) => a.replaceAll('{prompt}', () => prompt).replaceAll('{modelo}', () => ia.modelo || TIPOS[ia.tipo]?.modelo || ''))
    .filter((a) => a !== '');
};

// No Windows, ferramentas instaladas pelo npm (gemini, codex…) são atalhos .cmd. O Node não abre
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

export const executar = (ia, prompt, { cwd, timeoutMs, aoLinha = () => {}, velocidade = 1, envExtra = {}, incluir = [] }) => {
  if (ia.tipo === 'simulado') return simular(prompt, aoLinha, velocidade);
  return new Promise((resolve) => {
    const diretorio = cwd && fs.existsSync(cwd) ? cwd : process.cwd();
    let saida = '';
    let erro = '';
    let estourou = false;
    const pendente = { saida: '', erro: '' };

    // O Gemini só lê arquivos dentro da pasta de trabalho: libera também o cérebro, onde fica a nota da tarefa.
    // Libera a pasta do cérebro (a nota da tarefa e as áreas ficam lá, fora da pasta do projeto).
    const flagPasta = { claude: '--add-dir', gemini: '--include-directories', antigravity: '--add-dir' }[ia.tipo];
    const pastasExtras = flagPasta && !ia.args?.length ? incluir.filter((p) => p && fs.existsSync(p)).flatMap((p) => [flagPasta, p]) : [];
    const alvo = resolverExecutavel(comandoDe(ia), [...montarArgs(ia, prompt), ...pastasExtras]);
    const filho = spawn(alvo.comando, alvo.args, {
      cwd: diretorio,
      env: envDoProcesso(alvo.comando, { ...process.env, ...envExtra, ...envDaIA(ia), NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const consumir = (canal) => (pedaco) => {
      const texto = pedaco.toString().replace(ANSI, '');
      if (canal === 'saida') saida += texto;
      else erro += texto;
      const linhas = (pendente[canal] + texto).split('\n');
      pendente[canal] = linhas.pop();
      for (const l of linhas) if (l.trim()) aoLinha(l, canal);
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
      resolve(anotar({ codigo: codigo ?? -1, saida, erro, timeout: estourou }));
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

const simular = async (prompt, aoLinha, velocidade) => {
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
    return {
      codigo: 0,
      erro: '',
      saida: JSON.stringify({
        tipo: tipoPedido,
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
    if (tipo === 'treino-executar') return { codigo: 0, erro: '', saida: `Resposta de exemplo. ${prompt.match(/Versão [\d.]+[^\n]*/)?.[0] ?? ''}` };
    if (tipo === 'treino-julgar') {
      const casos = (prompt.match(/### Caso/g) ?? []).length || 1;
      const forca = (prompt.match(/\+/g) ?? []).length;
      const notas = Array.from({ length: casos }, (_, i) => ({ caso: i + 1, nota: Math.min(100, 60 + forca * 3 + i), falta: forca > 6 ? '' : 'Poderia citar a fonte com link.' }));
      return { codigo: 0, erro: '', saida: JSON.stringify({ notas }) };
    }
  }

  if (tipo === 'avaliar') {
    aoLinha('● Conferindo critérios', 'saida');
    await passo(900);
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
          { texto: 'Atende exatamente ao que foi pedido', ok: true },
          { texto: 'Tem testes cobrindo o caso principal', ok: true },
          { texto: 'Não quebra o que já funcionava', ok: true },
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
      arquivos: [],
      aprendizado: equipe === 'Código' ? 'Separar a regra de negócio do handler HTTP facilita os testes.' : '',
    })}\n\`\`\``,
  };
};
