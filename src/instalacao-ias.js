// Como instalar e como entrar na conta de cada IA. Nada aqui roda sozinho:
// o servidor só executa um plano quando o usuário confirma na tela, e sempre num terminal
// visível dentro do app, onde ele acompanha e responde (senha, login, termos).

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

const recarregarPathPs = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')";

const viaNpm = (pacote) =>
  WIN
    ? `if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Host 'Instalando o Node.js LTS, necessario para esta IA...'; winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements; ${recarregarPathPs} }; npm install -g ${pacote}`
    : `if ! command -v npm >/dev/null 2>&1; then echo "Esta IA precisa do Node.js (npm). Instale em https://nodejs.org e tente de novo."; exit 1; fi; ` +
      `P=$(npm prefix -g); if [ -w "$P" ]; then npm install -g ${pacote}; else echo "Sem permissao em $P: instalando em ~/.local"; npm install -g --prefix "$HOME/.local" ${pacote}; fi`;

export const PLANOS = {
  claude: {
    descricao: 'Instalador oficial da Anthropic.',
    instalar: WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
    entrar: { comando: 'claude', args: [], rotulo: 'Entrar na conta', dica: 'Abre o Claude Code. Siga o login na tela. Se ele perguntar se você confia na pasta, escolha "Yes, I trust this folder". Quando aparecer a caixa de digitar, já está logado: digite /exit.' },
  },
  gemini: {
    descricao: 'Pacote oficial @google/gemini-cli pelo npm. Atenção: desde 18/06/2026 só funciona com chave de API paga do Gemini; contas pessoais do Google usam o Antigravity.',
    instalar: viaNpm('@google/gemini-cli'),
    exibir: 'npm install -g @google/gemini-cli',
    entrar: { comando: 'gemini', args: [], rotulo: 'Entrar na conta', dica: 'Abre o Gemini CLI. Escolha "Login with Google" e conclua no navegador; depois digite /quit.' },
  },
  antigravity: {
    descricao: 'Instalador oficial do Google (antigravity.google). Fica só no seu usuário.',
    instalar: WIN ? 'irm https://antigravity.google/cli/install.ps1 | iex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    entrar: { comando: 'agy', args: [], rotulo: 'Entrar na conta', dica: 'Abre o Antigravity. Entre com a sua conta Google no navegador que abrir; depois feche com /exit.' },
  },
  codex: {
    descricao: 'Pacote oficial @openai/codex pelo npm.',
    instalar: viaNpm('@openai/codex'),
    exibir: 'npm install -g @openai/codex',
    entrar: { comando: 'codex', args: ['login'], rotulo: 'Entrar na conta', dica: 'Faz login na sua conta da OpenAI pelo navegador.' },
  },
  ollama: {
    descricao: WIN ? 'Instalador oficial pelo winget.' : MAC ? 'Pelo Homebrew.' : 'Script oficial do ollama.com (pede sua senha de administrador).',
    instalar: WIN
      ? 'winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements'
      : MAC
        ? 'if command -v brew >/dev/null 2>&1; then brew install ollama && brew services start ollama; else echo "Instale o Ollama em https://ollama.com/download"; exit 1; fi'
        : 'curl -fsSL https://ollama.com/install.sh | sh',
    exibir: WIN ? 'winget install Ollama.Ollama' : MAC ? 'brew install ollama' : 'curl -fsSL https://ollama.com/install.sh | sh',
    entrar: { comando: 'ollama', args: ['pull', '{modelo}'], rotulo: 'Baixar o modelo', dica: 'Baixa o modelo escolhido. Pode levar alguns minutos e ocupar vários GB.' },
  },
};

// Dependências de outras ferramentas (hoje: o Python do Headroom). Mesma regra: só com o "sim" do usuário.
// O uv instala só para o seu usuário, sem senha de administrador, e baixa o Python que o Headroom precisa.
export const DEPENDENCIAS = {
  python: {
    nome: 'Python',
    descricao:
      'O Headroom é feito em Python e este computador não tem um Python 3.10+ pronto para uso. Instalamos o uv, o gerenciador oficial de Python da Astral: ele fica só no seu usuário (sem senha de administrador) e traz o próprio Python, sem mexer em nada que você já tenha.',
    instalar: WIN
      ? 'irm https://astral.sh/uv/install.ps1 | iex'
      : 'if command -v curl >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh; else wget -qO- https://astral.sh/uv/install.sh | sh; fi',
    exibir: WIN ? 'irm https://astral.sh/uv/install.ps1 | iex' : 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  },
};

export const comandoDeDependencia = (id) => {
  const d = DEPENDENCIAS[id];
  if (!d) return null;
  if (WIN) return { comando: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', d.instalar], texto: d.exibir };
  return { comando: process.env.SHELL || '/bin/bash', args: ['-lc', d.instalar], texto: d.exibir };
};

// Comando de shell que roda o plano, visível no terminal do app.
export const comandoDeInstalacao = (tipo) => {
  const plano = PLANOS[tipo];
  if (!plano) return null;
  const texto = plano.exibir ?? plano.instalar;
  if (WIN) return { comando: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', plano.instalar], texto };
  return { comando: process.env.SHELL || '/bin/bash', args: ['-lc', plano.instalar], texto };
};

// Versão Linux/macOS dos planos, para instalar numa máquina remota por SSH.
export const planoUnix = (tipo) => {
  const npm = (pacote) =>
    `if ! command -v npm >/dev/null 2>&1; then echo "Esta IA precisa do Node.js (npm) nesta maquina. Instale e tente de novo."; exit 1; fi; ` +
    `P=$(npm prefix -g); if [ -w "$P" ]; then npm install -g ${pacote}; else npm install -g --prefix "$HOME/.local" ${pacote}; fi`;
  return {
    claude: { instalar: 'curl -fsSL https://claude.ai/install.sh | bash' },
    gemini: { instalar: npm('@google/gemini-cli'), exibir: 'npm install -g @google/gemini-cli' },
    codex: { instalar: npm('@openai/codex'), exibir: 'npm install -g @openai/codex' },
    antigravity: { instalar: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    agy: { instalar: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    ollama: { instalar: 'curl -fsSL https://ollama.com/install.sh | sh' },
  }[tipo];
};
