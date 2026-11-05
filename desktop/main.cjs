// Singularize Orquestrador como app de desktop: uma janela, sem terminal e sem navegador.
// O servidor roda escondido como processo filho (o próprio executável em modo Node) e a janela
// carrega a interface dele. Ao fechar, o servidor encerra os terminais e grava o estado.
const { app, BrowserWindow, dialog, shell, Menu, nativeImage, ipcMain, session } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const NOME = 'Singularize Orquestrador';
app.setName(NOME);
if (process.platform === 'win32') app.setAppUserModelId('com.singularize.orquestrador');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let janela = null;
let servidor = null;
let endereco = null;
let saindo = false;

const pastaDados = () => path.join(app.getPath('userData'), 'dados');
const pastaCerebro = () => path.join(app.getPath('documents'), 'Singularize', 'cerebro');
const pastaProjetos = () => path.join(app.getPath('documents'), 'Singularize', 'projetos');
const arquivoLog = () => path.join(app.getPath('userData'), 'servidor.log');
const icone = () => nativeImage.createFromPath(path.join(RAIZ, 'instalador', process.platform === 'win32' ? 'icone.ico' : 'icone.png'));

// Configurações do usuário (porta, token para acesso remoto) ficam em dados/.env.
const lerEnvUsuario = () => {
  const arq = path.join(pastaDados(), '.env');
  const valores = {};
  if (!fs.existsSync(arq)) return valores;
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) valores[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return valores;
};

const portaLivre = (preferida) =>
  new Promise((resolve) => {
    const teste = net.createServer();
    teste.once('error', () => {
      const outro = net.createServer();
      outro.listen(0, '127.0.0.1', () => {
        const { port } = outro.address();
        outro.close(() => resolve(port));
      });
    });
    teste.listen(preferida, '127.0.0.1', () => teste.close(() => resolve(preferida)));
  });

const esperarServidor = async (url, token, limiteMs = 40_000) => {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (!servidor) throw new Error('O servidor parou ao iniciar.');
    try {
      const r = await fetch(`${url}/api/sistema/ocupado`, { headers: { 'x-orq-token': token } });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('O servidor demorou demais para responder.');
};

const iniciarServidor = async () => {
  fs.mkdirSync(pastaDados(), { recursive: true });
  fs.mkdirSync(pastaCerebro(), { recursive: true });
  const envUsuario = lerEnvUsuario();
  const porta = await portaLivre(Number(envUsuario.ORQ_PORTA) || 4700);
  const token = envUsuario.ORQ_TOKEN || crypto.randomBytes(24).toString('hex');
  const host = envUsuario.ORQ_HOST || '127.0.0.1';
  const log = fs.createWriteStream(arquivoLog(), { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} · ${NOME} ${app.getVersion()} ---\n`);

  servidor = spawn(process.execPath, [path.join(RAIZ, 'src', 'server.js')], {
    cwd: RAIZ,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ORQ_DESKTOP: '1',
      ORQ_LOG_ARQUIVO: arquivoLog(),
      ORQ_VERSAO_ELECTRON: process.versions.electron,
      ORQ_PORTA: String(porta),
      ORQ_HOST: host,
      ORQ_TOKEN: token,
      ORQ_DADOS: pastaDados(),
      ORQ_VAULT: envUsuario.ORQ_VAULT || pastaCerebro(),
      ORQ_PASTA_PROJETOS: envUsuario.ORQ_PASTA_PROJETOS || pastaProjetos(),
    },
    // stdin fica aberto de propósito: se este app morrer de qualquer jeito, o servidor percebe e encerra.
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  servidor.stdout.pipe(log);
  servidor.stderr.pipe(log);
  servidor.on('exit', (codigo) => {
    servidor = null;
    if (saindo) return;
    dialog
      .showMessageBox({
        type: 'error',
        title: NOME,
        message: 'O motor do app parou inesperadamente.',
        detail: `Código ${codigo}. O registro está em:\n${arquivoLog()}`,
        buttons: ['Reiniciar o app', 'Fechar'],
      })
      .then(({ response }) => {
        if (response === 0) app.relaunch();
        app.exit(0);
      });
  });

  const url = `http://127.0.0.1:${porta}`;
  await esperarServidor(url, token);
  return { url, token };
};

const telaAbertura = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#000;color:#eaeaf0;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:14px">
<div style="font-size:30px">Singularize <span style="color:#8f8f99">Orquestrador</span></div>
<div style="font:14px system-ui,sans-serif;color:#8f8f99">Preparando suas equipes…</div>
<div style="width:160px;height:2px;background:#26262d;overflow:hidden;border-radius:2px"><div style="width:40%;height:2px;background:#9d7bff;animation:a 1.1s ease-in-out infinite"></div></div>
<style>@keyframes a{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}</style></body></html>`)}`;

const criarJanela = () => {
  janela = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#000000',
    title: NOME,
    icon: icone(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  janela.once('ready-to-show', () => janela.show());
  // A tela de abertura é trocada pela interface assim que o servidor sobe; o cancelamento dela é esperado.
  janela.__abertura = janela.loadURL(telaAbertura).catch(() => {});

  // Links de fora (documentação, nodejs.org) abrem no navegador padrão; o app nunca sai da própria interface.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (endereco && url.startsWith(endereco)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000000', icon: icone() } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith('data:') || (endereco && url.startsWith(endereco))) return;
    ev.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  janela.on('close', async (ev) => {
    if (saindo) return;
    ev.preventDefault();
    let ocupado = { agentes: 0, tarefas: 0 };
    try {
      const r = await fetch(`${endereco}/api/sistema/ocupado`, { headers: { 'x-orq-token': janela.__token } });
      ocupado = await r.json();
    } catch {}
    if (ocupado.agentes || ocupado.tarefas) {
      const partes = [ocupado.agentes ? `${ocupado.agentes} agente(s) com terminal aberto` : '', ocupado.tarefas ? `${ocupado.tarefas} tarefa(s) em execução` : ''].filter(Boolean);
      const { response } = await dialog.showMessageBox(janela, {
        type: 'question',
        title: NOME,
        message: 'Fechar o Singularize Orquestrador?',
        detail: `Há ${partes.join(' e ')}. Os terminais serão encerrados; as tarefas continuam de onde pararam na próxima vez que você abrir o app.`,
        buttons: ['Fechar mesmo assim', 'Continuar usando'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return;
    }
    await encerrar();
  });
};

const encerrar = async () => {
  saindo = true;
  if (servidor && endereco) {
    try {
      await fetch(`${endereco}/api/sistema/encerrar`, { method: 'POST', headers: { 'x-orq-token': janela?.__token ?? '' } });
    } catch {}
    const fim = Date.now() + 5000;
    while (servidor && Date.now() < fim) await new Promise((r) => setTimeout(r, 100));
    servidor?.kill();
  }
  app.exit(0);
};

// Seletor de pastas nativo, só para a própria interface do app.
// Mostra um arquivo (ex.: o diagnóstico) selecionado no Explorer / gerenciador de arquivos.
ipcMain.handle('mostrar-arquivo', (evento, caminho) => {
  if (typeof caminho === 'string' && fs.existsSync(caminho)) shell.showItemInFolder(caminho);
});

ipcMain.handle('escolher-pasta', async (evento, inicial) => {
  if (!endereco || !evento.senderFrame?.url?.startsWith(endereco)) return null;
  const r = await dialog.showOpenDialog(janela, {
    title: 'Escolha a pasta',
    defaultPath: inicial && fs.existsSync(inicial) ? inicial : pastaProjetos(),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  return r.canceled ? null : r.filePaths[0];
});

app.on('second-instance', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.whenReady().then(async () => {
  // Limpa o cache da janela: uma atualização do app nunca mostra a tela antiga.
  await session.defaultSession.clearCache().catch(() => {});
  Menu.setApplicationMenu(null);
  criarJanela();
  try {
    const { url, token } = await iniciarServidor();
    endereco = url;
    janela.__token = token;
    await janela.__abertura;
    await janela.loadURL(`${url}/?token=${encodeURIComponent(token)}`).catch((e) => {
      // ERR_ABORTED (-3) só indica que uma navegação substituiu outra; não é falha.
      if (e.code !== 'ERR_ABORTED' && e.errno !== -3) throw e;
    });
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', title: NOME, message: 'Não foi possível abrir o app.', detail: `${e.message}\n\nRegistro: ${arquivoLog()}` });
    saindo = true;
    servidor?.kill();
    app.exit(1);
  }
});

app.on('window-all-closed', () => encerrar());
