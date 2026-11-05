// Terminal em janela, por cima do app: usado para instalar uma IA e para entrar na conta dela.
// O usuário vê tudo o que roda e responde quando a ferramenta pedir (senha, login, termos).
import { Terminal } from '/vendor/xterm/lib/xterm.mjs';
import { FitAddon } from '/vendor/xterm-fit/lib/addon-fit.mjs';

const esperando = new Map(); // sessao -> resolve

export const avisarFim = (evento) => {
  esperando.get(evento.sessao)?.(evento);
};

export const abrirTerminal = ({ titulo, descricao = '', comando = '', sessao, token, esc }) =>
  new Promise((resolve) => {
    const caixa = document.createElement('div');
    caixa.className = 'cv-modal';
    caixa.setAttribute('role', 'dialog');
    caixa.setAttribute('aria-modal', 'true');
    caixa.setAttribute('aria-label', titulo);
    caixa.innerHTML = `<div class="cv-modal-caixa term-modal">
      <div style="display:flex;align-items:baseline;gap:12px"><h2 class="titulo" style="font-size:26px">${esc(titulo)}</h2><div class="cresce"></div><span class="selo acento" data-estado>rodando…</span></div>
      ${descricao ? `<p class="dica" style="font-size:14px">${esc(descricao)}</p>` : ''}
      ${comando ? `<code class="mono" style="font-size:12px;color:var(--suave);word-break:break-all">${esc(comando)}</code>` : ''}
      <div class="term-modal-tela"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center">
        <span class="dica" style="margin-right:auto">Clique no terminal para digitar, se ele pedir algo.</span>
        <button type="button" class="btn pequeno" data-fechar>Fechar</button>
      </div>
    </div>`;
    document.body.appendChild(caixa);

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      scrollback: 4000,
      theme: { background: '#08080b', foreground: '#eaeaf0', cursor: '#9d7bff', selectionBackground: '#3a2c6b', green: '#6fd39b', red: '#f08a80', yellow: '#f0b45a', blue: '#9d7bff', magenta: '#b794ff', cyan: '#a7c7e8' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(caixa.querySelector('.term-modal-tela'));
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty?agente=${encodeURIComponent(sessao)}&token=${encodeURIComponent(token())}`);
    const tamanho = () => {
      try {
        fit.fit();
      } catch {}
      if (sock.readyState === 1) sock.send(JSON.stringify({ t: 'tam', cols: term.cols, rows: term.rows }));
    };
    sock.onopen = tamanho;
    sock.onmessage = (m) => term.write(typeof m.data === 'string' ? m.data : '');
    term.onData((d) => sock.readyState === 1 && sock.send(JSON.stringify({ t: 'in', d })));
    requestAnimationFrame(tamanho);
    term.focus();

    let resultado = null;
    esperando.set(sessao, (ev) => {
      resultado = ev;
      const selo = caixa.querySelector('[data-estado]');
      selo.textContent = ev.codigo === 0 ? 'concluído' : `terminou com erro (código ${ev.codigo})`;
      selo.className = `selo ${ev.codigo === 0 ? 'ok' : 'erro'}`;
    });

    caixa.querySelector('[data-fechar]').addEventListener('click', () => {
      esperando.delete(sessao);
      sock.close();
      term.dispose();
      caixa.remove();
      resolve(resultado);
    });
  });
