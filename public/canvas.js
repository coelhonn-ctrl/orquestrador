// Tela livre: agentes (terminais reais), notas e rascunhos num plano infinito, ligados por fios.
import { Terminal } from '/vendor/xterm/lib/xterm.mjs';
import { FitAddon } from '/vendor/xterm-fit/lib/addon-fit.mjs';

const TEMA_TERMINAL = {
  background: '#08080b',
  foreground: '#eaeaf0',
  cursor: '#9d7bff',
  cursorAccent: '#08080b',
  selectionBackground: '#3a2c6b',
  black: '#000000',
  red: '#f08a80',
  green: '#6fd39b',
  yellow: '#f0b45a',
  blue: '#9d7bff',
  magenta: '#b794ff',
  cyan: '#a7c7e8',
  white: '#eaeaf0',
  brightBlack: '#6e6e78',
  brightRed: '#f4a7a0',
  brightGreen: '#a7e8c0',
  brightYellow: '#f5c98a',
  brightBlue: '#cdbdff',
  brightMagenta: '#e6deff',
  brightCyan: '#c7dbef',
  brightWhite: '#ffffff',
};
const CORES = ['roxo', 'ambar', 'verde', 'cinza'];

export const criarTelaCanvas = ({ S, $, esc, api, toast, token, ajuda, comAjuda, lerLocal }) => {
  const C = {
    ws: lerLocal('orq.cv.ws', 'geral'),
    doc: null,
    autor: Math.random().toString(36).slice(2),
    els: new Map(),
    salvarT: null,
    gesto: null,
    painel: lerLocal('orq.cv.painel', '1') === '1',
    mensagens: [],
    pulsos: new Map(),
    dialogo: null,
    vivo: false,
  };

  const agente = (id) => S.d.agentes.find((a) => a.id === id);
  const iaNome = (id) => S.d.ias.find((i) => i.id === id)?.nome ?? '—';
  const z = () => C.doc?.vista?.z ?? 1;

  // ---------------------------------------------------------------- salvar

  const salvar = () => {
    clearTimeout(C.salvarT);
    C.salvarT = setTimeout(async () => {
      C.salvarT = null;
      if (!C.doc) return;
      await api('PUT', `/api/canvas/${encodeURIComponent(C.ws)}`, { ...C.doc, autor: C.autor }).catch(() => {});
    }, 450);
  };

  // ---------------------------------------------------------------- montagem

  const montar = async () => {
    C.vivo = true;
    document.body.classList.add('modo-canvas');
    $('#app').innerHTML = `<div class="cv">
      <div class="cv-barra">
        <nav class="cv-espacos" id="cv-espacos" aria-label="Espaço"></nav>
        <div class="cresce"></div>
        <button type="button" class="btn pequeno" data-cv="novo-agente" data-dica="Abre um ou mais terminais com a IA que você escolher.">Novos agentes</button>
        <button type="button" class="pill cheia" data-cv="nova-nota" data-dica="Bloco de texto para anotar ideias. Duplo clique no fundo também cria uma.">Nota</button>
        <button type="button" class="pill cheia" data-cv="novo-rascunho" data-dica="Área para desenhar à mão livre: fluxos, telas, setas.">Rascunho</button>
        ${comAjuda('<label class="check"><input type="checkbox" id="cv-livre" data-cv-mudar="livre">Comunicação livre</label>', 'Desligado: só agentes ligados por fio conversam. Ligado: todos os agentes deste espaço podem falar entre si.')}
        <div class="cv-zoom" role="group" aria-label="Zoom">
          <button type="button" class="icone-btn" data-cv="zoom-menos" aria-label="Diminuir zoom">−</button>
          <span id="cv-z" class="num">100%</span>
          <button type="button" class="icone-btn" data-cv="zoom-mais" aria-label="Aumentar zoom">+</button>
          <button type="button" class="link" data-cv="ajustar" data-dica="Enquadra tudo o que está na tela.">Ajustar</button>
        </div>
        <button type="button" class="pill cheia" data-cv="painel" aria-pressed="${C.painel}" data-dica="Mostra ou esconde a conversa entre agentes e o envio de mensagens do operador.">Mensagens</button>
      </div>
      <div class="cv-corpo">
        <div class="cv-area" id="cv-area" tabindex="-1">
          <div class="cv-mundo" id="cv-mundo"><svg class="cv-fios" id="cv-fios" aria-hidden="true"></svg></div>
          <div class="cv-vazio" id="cv-vazio" hidden>
            <p class="titulo" style="font-size:32px">Tela livre</p>
            <ol class="cv-passos">
              <li><b>Crie agentes.</b> Cada um é um terminal real com a IA que você escolher.</li>
              <li><b>Ligue quem conversa com quem.</b> Arraste o círculo roxo na borda de um agente até outro.</li>
              <li><b>Peça algo.</b> Digite no terminal ou use o painel de mensagens. Os agentes respondem entre si pelo comando <code>orq</code>, apontando notas do cérebro.</li>
            </ol>
            <p class="dica">Arraste o fundo para mover a tela, use a roda do mouse para dar zoom e duplo clique para criar uma nota.</p>
            <button type="button" class="btn" data-cv="novo-agente">Criar agentes</button>
          </div>
        </div>
        <aside class="cv-painel" id="cv-painel" aria-label="Mensagens entre agentes" ${C.painel ? '' : 'hidden'}></aside>
      </div>
      <div id="cv-dialogo"></div>
    </div>`;
    ligarGestos();
    await carregar();
  };

  const carregar = async () => {
    const [doc, mensagens] = await Promise.all([api('GET', `/api/canvas/${encodeURIComponent(C.ws)}`), api('GET', `/api/mensagens?workspace=${encodeURIComponent(C.ws)}`)]);
    if (!C.vivo) return;
    for (const r of C.els.values()) destruir(r);
    C.els.clear();
    C.doc = doc;
    C.mensagens = mensagens;
    renderEspacos();
    renderTudo();
    renderPainel();
    if (!doc.nos.length) ajustar();
  };

  const desmontar = () => {
    C.vivo = false;
    document.body.classList.remove('modo-canvas');
    if (C.salvarT) {
      clearTimeout(C.salvarT);
      api('PUT', `/api/canvas/${encodeURIComponent(C.ws)}`, { ...C.doc, autor: C.autor }).catch(() => {});
    }
    for (const r of C.els.values()) destruir(r);
    C.els.clear();
  };

  const renderEspacos = () => {
    const espacos = [{ id: 'geral', nome: 'Geral' }, ...S.d.projetos];
    $('#cv-espacos').innerHTML = espacos.map((p) => `<button type="button" class="pill" data-cv="espaco" data-id="${esc(p.id)}" aria-pressed="${C.ws === p.id}">${esc(p.nome)}</button>`).join('');
    const livre = $('#cv-livre');
    if (livre) livre.checked = !!C.doc?.livre;
  };

  // ---------------------------------------------------------------- nós

  const aplicarVista = () => {
    const v = C.doc.vista;
    $('#cv-mundo').style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    $('#cv-z').textContent = `${Math.round(v.z * 100)}%`;
  };

  const renderTudo = () => {
    if (!C.doc || !C.vivo) return;
    aplicarVista();
    const vivos = new Set();
    C.doc.nos.forEach((n, i) => {
      vivos.add(n.id);
      let r = C.els.get(n.id);
      if (!r) {
        r = criarNo(n);
        if (!r) return;
        C.els.set(n.id, r);
        $('#cv-mundo').appendChild(r.el);
      }
      r.no = n;
      Object.assign(r.el.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px`, zIndex: String(i + 1) });
      if (n.tipo === 'agente') atualizarAgente(r);
      if (n.tipo === 'nota') {
        r.el.dataset.cor = n.cor;
        if (document.activeElement !== r.texto) r.texto.value = n.texto ?? '';
      }
      if (n.tipo === 'rascunho') {
        if (document.activeElement !== r.titulo) r.titulo.value = n.titulo ?? '';
        desenhar(r);
      }
    });
    for (const [id, r] of C.els) {
      if (!vivos.has(id)) {
        destruir(r);
        C.els.delete(id);
      }
    }
    renderFios();
    $('#cv-vazio').hidden = C.doc.nos.length > 0;
  };

  const criarNo = (n) => {
    const el = document.createElement('div');
    el.className = `no no-${n.tipo}`;
    el.dataset.no = n.id;
    const remover = `<button type="button" class="no-btn" data-cv="remover-no" aria-label="Remover">×</button>`;
    if (n.tipo === 'agente') {
      el.dataset.agente = n.agenteId;
      el.innerHTML = `<div class="no-cab" data-arrasta>
          <span class="ponto"></span><span class="no-nome"></span><span class="no-sub"></span>
          <div class="cresce"></div><span class="no-acoes"></span>${remover}
        </div>
        <div class="no-term"></div>
        <button type="button" class="no-porta" data-porta aria-label="Arraste até outro agente para ligar" data-dica="Arraste até outro agente para os dois poderem conversar."></button>
        <span class="no-redim" data-redim aria-hidden="true"></span>`;
      const r = { el, no: n, tipo: 'agente', caixa: el.querySelector('.no-term') };
      ligarTerminal(r);
      return r;
    }
    if (n.tipo === 'nota') {
      el.innerHTML = `<div class="no-cab" data-arrasta><span class="no-sub">Nota</span><div class="cresce"></div>
          <button type="button" class="no-btn" data-cv="cor" aria-label="Trocar cor"><span class="ponto"></span></button>${remover}</div>
        <label class="sr" for="tx-${esc(n.id)}">Texto da nota</label>
        <textarea class="no-texto" id="tx-${esc(n.id)}" placeholder="Escreva…"></textarea>
        <span class="no-redim" data-redim aria-hidden="true"></span>`;
      const r = { el, no: n, tipo: 'nota', texto: el.querySelector('textarea') };
      r.texto.addEventListener('input', () => {
        r.no.texto = r.texto.value;
        salvar();
      });
      return r;
    }
    el.innerHTML = `<div class="no-cab" data-arrasta>
        <label class="sr" for="ti-${esc(n.id)}">Título do rascunho</label>
        <input class="no-titulo" id="ti-${esc(n.id)}" placeholder="Rascunho" autocomplete="off">
        <div class="cresce"></div>
        <button type="button" class="no-btn texto" data-cv="desfazer">Desfazer</button>
        <button type="button" class="no-btn texto" data-cv="limpar">Limpar</button>${remover}</div>
      <svg class="no-desenho" role="img" aria-label="Rascunho à mão livre"></svg>
      <span class="no-redim" data-redim aria-hidden="true"></span>`;
    const r = { el, no: n, tipo: 'rascunho', svg: el.querySelector('svg'), titulo: el.querySelector('input') };
    r.titulo.addEventListener('input', () => {
      r.no.titulo = r.titulo.value;
      salvar();
    });
    ligarDesenho(r);
    return r;
  };

  const destruir = (r) => {
    r.fechado = true;
    r.sock?.close();
    r.observador?.disconnect();
    r.term?.dispose();
    r.el.remove();
  };

  const atualizarAgente = (r) => {
    const a = agente(r.no.agenteId);
    if (!a) return;
    const estado = a.rodando ? 'rodando' : a.estado === 'saiu' ? 'saiu' : 'parado';
    r.el.dataset.estado = estado;
    r.el.querySelector('.no-nome').textContent = a.nome;
    const mq = S.d.maquinas.find((m) => m.id === (a.maquinaId ?? S.d.projetos.find((p) => p.id === a.projetoId)?.maquinaId));
    r.el.querySelector('.no-sub').textContent = `${iaNome(a.iaId)}${mq ? ` · em ${mq.nome}` : ''}${a.papel ? ` · ${a.papel}` : ''}`;
    const acoes = a.rodando
      ? `<button type="button" class="no-btn texto" data-cv="reiniciar" data-dica="Fecha e abre o terminal de novo, com as configurações atuais.">Reiniciar</button><button type="button" class="no-btn texto" data-cv="parar" data-dica="Encerra o terminal. Mensagens novas ficam guardadas até ele iniciar de novo.">Parar</button>`
      : `<button type="button" class="no-btn texto destaque" data-cv="iniciar" data-dica="Abre o terminal com a IA deste agente.">Iniciar</button>`;
    const chave = `${estado}`;
    if (r.acoesChave !== chave) {
      r.el.querySelector('.no-acoes').innerHTML = `${acoes}<button type="button" class="no-btn texto" data-cv="editar-agente" data-dica="Nome, IA, papel, área do cérebro e pasta.">Editar</button>`;
      r.acoesChave = chave;
    }
  };

  // ---------------------------------------------------------------- terminal real

  const ligarTerminal = (r) => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 6000,
      theme: TEMA_TERMINAL,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(r.caixa);
    r.term = term;
    r.fit = fit;
    r.tam = { cols: 0, rows: 0 };

    const ajustarTam = () => {
      if (r.fechado || !r.caixa.clientWidth) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols !== r.tam.cols || term.rows !== r.tam.rows) {
        r.tam = { cols: term.cols, rows: term.rows };
        if (r.sock?.readyState === 1) r.sock.send(JSON.stringify({ t: 'tam', ...r.tam }));
      }
    };
    r.ajustarTam = ajustarTam;
    r.observador = new ResizeObserver(() => requestAnimationFrame(ajustarTam));
    r.observador.observe(r.caixa);

    term.onData((d) => {
      if (r.sock?.readyState === 1) r.sock.send(JSON.stringify({ t: 'in', d }));
    });

    const conectar = () => {
      if (r.fechado) return;
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty?agente=${encodeURIComponent(r.no.agenteId)}&token=${encodeURIComponent(token())}`);
      r.sock = sock;
      sock.onopen = () => {
        term.reset();
        ajustarTam();
        sock.send(JSON.stringify({ t: 'tam', ...r.tam }));
      };
      sock.onmessage = (m) => term.write(typeof m.data === 'string' ? m.data : '');
      sock.onclose = () => !r.fechado && setTimeout(conectar, 2000);
    };
    conectar();
    requestAnimationFrame(ajustarTam);
  };

  // ---------------------------------------------------------------- rascunho à mão livre

  const caminho = (pts) => {
    if (pts.length < 2) return '';
    let d = `M${pts[0]} ${pts[1]}`;
    for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
    return d;
  };

  const desenhar = (r) => {
    r.svg.innerHTML = (r.no.tracos ?? []).map((t) => `<path d="${caminho(t)}"/>`).join('') + (r.atual ? `<path d="${caminho(r.atual)}"/>` : '');
  };

  const ligarDesenho = (r) => {
    r.svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      r.svg.setPointerCapture(ev.pointerId);
      const caixa = r.svg.getBoundingClientRect();
      const ponto = (e) => [Math.round((e.clientX - caixa.left) / z()), Math.round((e.clientY - caixa.top) / z())];
      r.atual = ponto(ev);
      const mover = (e) => {
        r.atual.push(...ponto(e));
        desenhar(r);
      };
      const soltar = () => {
        r.svg.removeEventListener('pointermove', mover);
        if (r.atual.length >= 4) (r.no.tracos ??= []).push(r.atual);
        r.atual = null;
        desenhar(r);
        salvar();
      };
      r.svg.addEventListener('pointermove', mover);
      r.svg.addEventListener('pointerup', soltar, { once: true });
      r.svg.addEventListener('pointercancel', soltar, { once: true });
    });
  };

  // ---------------------------------------------------------------- fios

  const noDoAgente = (id) => C.doc.nos.find((n) => n.tipo === 'agente' && n.agenteId === id);

  const pontas = (a, b) => {
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y)) {
      const dir = cb.x > ca.x ? 1 : -1;
      return { x1: ca.x + (dir * a.w) / 2, y1: ca.y, x2: cb.x - (dir * b.w) / 2, y2: cb.y, h: true };
    }
    const dir = cb.y > ca.y ? 1 : -1;
    return { x1: ca.x, y1: ca.y + (dir * a.h) / 2, x2: cb.x, y2: cb.y - (dir * b.h) / 2, h: false };
  };

  const curva = ({ x1, y1, x2, y2, h }) => {
    const d = h ? Math.max(40, Math.abs(x2 - x1) / 2) * Math.sign(x2 - x1 || 1) : Math.max(40, Math.abs(y2 - y1) / 2) * Math.sign(y2 - y1 || 1);
    return h ? `M${x1} ${y1} C${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y1 + d}, ${x2} ${y2 - d}, ${x2} ${y2}`;
  };

  const renderFios = () => {
    const svg = $('#cv-fios');
    if (!svg) return;
    const agora = Date.now();
    const partes = [];
    for (const c of C.doc.conexoes) {
      const a = noDoAgente(c.de);
      const b = noDoAgente(c.para);
      if (!a || !b) continue;
      const p = pontas(a, b);
      const mx = (p.x1 + p.x2) / 2;
      const my = (p.y1 + p.y2) / 2;
      const chave = [c.de, c.para].sort().join('|');
      const pulso = C.pulsos.get(chave);
      const ativo = pulso && pulso.ate > agora;
      partes.push(`<g class="fio ${ativo ? 'pulso' : ''}">
        <path class="fio-linha" d="${curva(p)}"/>
        ${ativo ? `<text class="fio-rotulo" x="${mx}" y="${my - 14}" text-anchor="middle">${esc(pulso.texto)}</text>` : ''}
        <g class="fio-x" data-cv="remover-fio" data-id="${esc(c.id)}" role="button" aria-label="Desligar"><circle cx="${mx}" cy="${my}" r="10"/><path d="M${mx - 4} ${my - 4} L${mx + 4} ${my + 4} M${mx + 4} ${my - 4} L${mx - 4} ${my + 4}"/></g>
      </g>`);
    }
    if (C.gesto?.tipo === 'ligar' && C.gesto.ponta) partes.push(`<path class="fio-temp" d="M${C.gesto.ox} ${C.gesto.oy} L${C.gesto.ponta.x} ${C.gesto.ponta.y}"/>`);
    svg.innerHTML = partes.join('');
  };

  const pulsar = (m) => {
    const chave = [m.de, m.para].sort().join('|');
    const texto = m.objetivo.length > 46 ? `${m.objetivo.slice(0, 45)}…` : m.objetivo;
    C.pulsos.set(chave, { ate: Date.now() + 4000, texto });
    renderFios();
    setTimeout(() => C.vivo && renderFios(), 4100);
  };

  // ---------------------------------------------------------------- gestos: mover, redimensionar, ligar, pan, zoom

  const mundoDe = (ev) => {
    const area = $('#cv-area').getBoundingClientRect();
    const v = C.doc.vista;
    return { x: (ev.clientX - area.left - v.x) / v.z, y: (ev.clientY - area.top - v.y) / v.z };
  };

  const trazerFrente = (n) => {
    const i = C.doc.nos.indexOf(n);
    if (i < 0 || i === C.doc.nos.length - 1) return;
    C.doc.nos.splice(i, 1);
    C.doc.nos.push(n);
    C.doc.nos.forEach((x, k) => {
      const el = C.els.get(x.id)?.el;
      if (el) el.style.zIndex = String(k + 1);
    });
  };

  const ligarGestos = () => {
    const area = $('#cv-area');

    area.addEventListener('pointerdown', (ev) => {
      if (!C.doc || ev.button > 1) return;
      const alvo = ev.target;
      const noEl = alvo.closest('.no');
      const n = noEl ? C.doc.nos.find((x) => x.id === noEl.dataset.no) : null;
      if (alvo.closest('[data-cv]') || alvo.closest('input, textarea, select') || alvo.closest('.fio-x')) return;

      if (n && alvo.closest('[data-porta]')) {
        const p = { x: n.x + n.w, y: n.y + n.h / 2 };
        C.gesto = { tipo: 'ligar', de: n.agenteId, ox: p.x, oy: p.y, ponta: p };
      } else if (n && alvo.closest('[data-redim]')) {
        C.gesto = { tipo: 'redim', n, x0: ev.clientX, y0: ev.clientY, w0: n.w, h0: n.h };
      } else if (n && alvo.closest('[data-arrasta]')) {
        C.gesto = { tipo: 'mover', n, x0: ev.clientX, y0: ev.clientY, nx: n.x, ny: n.y };
      } else if (!noEl) {
        C.gesto = { tipo: 'pan', x0: ev.clientX, y0: ev.clientY, vx: C.doc.vista.x, vy: C.doc.vista.y };
        area.classList.add('arrastando');
      } else {
        if (n) trazerFrente(n);
        return;
      }
      if (n) trazerFrente(n);
      area.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });

    area.addEventListener('pointermove', (ev) => {
      const g = C.gesto;
      if (!g) return;
      const v = C.doc.vista;
      if (g.tipo === 'pan') {
        v.x = g.vx + ev.clientX - g.x0;
        v.y = g.vy + ev.clientY - g.y0;
        aplicarVista();
      } else if (g.tipo === 'mover') {
        g.n.x = Math.round(g.nx + (ev.clientX - g.x0) / v.z);
        g.n.y = Math.round(g.ny + (ev.clientY - g.y0) / v.z);
        const el = C.els.get(g.n.id)?.el;
        if (el) Object.assign(el.style, { left: `${g.n.x}px`, top: `${g.n.y}px` });
        renderFios();
      } else if (g.tipo === 'redim') {
        g.n.w = Math.max(220, Math.round(g.w0 + (ev.clientX - g.x0) / v.z));
        g.n.h = Math.max(140, Math.round(g.h0 + (ev.clientY - g.y0) / v.z));
        const el = C.els.get(g.n.id)?.el;
        if (el) Object.assign(el.style, { width: `${g.n.w}px`, height: `${g.n.h}px` });
        renderFios();
      } else if (g.tipo === 'ligar') {
        g.ponta = mundoDe(ev);
        renderFios();
      }
    });

    const terminar = (ev) => {
      const g = C.gesto;
      if (!g) return;
      C.gesto = null;
      area.classList.remove('arrastando');
      if (g.tipo === 'ligar') {
        const alvo = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.no-agente');
        const para = alvo?.dataset.agente;
        if (para && para !== g.de) {
          const chave = [g.de, para].sort().join('|');
          if (!C.doc.conexoes.some((c) => [c.de, c.para].sort().join('|') === chave)) {
            C.doc.conexoes.push({ id: `c-${Date.now().toString(36)}`, de: g.de, para });
            toast(`${agente(g.de)?.nome} e ${agente(para)?.nome} agora podem conversar.`);
          }
        }
        renderFios();
      }
      salvar();
    };
    area.addEventListener('pointerup', terminar);
    area.addEventListener('pointercancel', terminar);

    area.addEventListener(
      'wheel',
      (ev) => {
        if (!C.doc) return;
        const dentroDeNo = ev.target.closest('.no');
        if (dentroDeNo && !ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        if (!ev.ctrlKey && !ev.metaKey && Math.abs(ev.deltaX) + Math.abs(ev.deltaY) > 0 && !ev.altKey && ev.deltaMode === 0 && Math.abs(ev.deltaY) < 40) {
          // Trackpad: dois dedos arrastam a tela.
          C.doc.vista.x -= ev.deltaX;
          C.doc.vista.y -= ev.deltaY;
          aplicarVista();
          salvar();
          return;
        }
        zoomEm(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0018));
      },
      { passive: false },
    );

    area.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.no') || !C.doc) return;
      const p = mundoDe(ev);
      adicionar({ tipo: 'nota', x: Math.round(p.x - 130), y: Math.round(p.y - 20), w: 260, h: 200, texto: '', cor: 'roxo' });
    });
  };

  const zoomEm = (cx, cy, fator) => {
    const area = $('#cv-area').getBoundingClientRect();
    const v = C.doc.vista;
    const novo = Math.min(2.5, Math.max(0.2, v.z * fator));
    const px = cx - area.left;
    const py = cy - area.top;
    v.x = px - ((px - v.x) / v.z) * novo;
    v.y = py - ((py - v.y) / v.z) * novo;
    v.z = novo;
    aplicarVista();
    salvar();
  };

  const ajustar = () => {
    if (!C.doc) return;
    const area = $('#cv-area').getBoundingClientRect();
    const v = C.doc.vista;
    if (!C.doc.nos.length) {
      Object.assign(v, { x: 60, y: 60, z: 1 });
      return aplicarVista();
    }
    const minX = Math.min(...C.doc.nos.map((n) => n.x));
    const minY = Math.min(...C.doc.nos.map((n) => n.y));
    const maxX = Math.max(...C.doc.nos.map((n) => n.x + n.w));
    const maxY = Math.max(...C.doc.nos.map((n) => n.y + n.h));
    const zz = Math.min(1.2, Math.max(0.2, Math.min((area.width - 80) / (maxX - minX), (area.height - 80) / (maxY - minY))));
    Object.assign(v, { z: zz, x: (area.width - (maxX - minX) * zz) / 2 - minX * zz, y: (area.height - (maxY - minY) * zz) / 2 - minY * zz });
    aplicarVista();
    salvar();
  };

  const centroVisivel = () => {
    const area = $('#cv-area').getBoundingClientRect();
    const v = C.doc.vista;
    return { x: Math.round((area.width / 2 - v.x) / v.z), y: Math.round((area.height / 2 - v.y) / v.z) };
  };

  const adicionar = (dados) => {
    const n = { id: `${dados.tipo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...dados };
    C.doc.nos.push(n);
    renderTudo();
    salvar();
    if (n.tipo === 'nota') C.els.get(n.id)?.texto.focus();
    if (n.tipo === 'rascunho') C.els.get(n.id)?.titulo.focus();
  };

  // ---------------------------------------------------------------- painel de mensagens

  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const rotuloEstado = { 'na-fila': 'na fila', 'aguardando-agente': 'espera o agente iniciar', entregue: 'entregue' };

  const renderPainel = () => {
    const painel = $('#cv-painel');
    if (!painel || painel.hidden) return;
    if (painel.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) {
      const lista = $('#cv-msgs');
      if (lista) lista.innerHTML = htmlMensagens();
      return;
    }
    const doEspaco = S.d.agentes.filter((a) => a.workspace === C.ws);
    painel.innerHTML = `
      <h2 class="rotulo">Conversa entre agentes ${ajuda('Tudo o que os agentes deste espaço pediram uns aos outros. Cada mensagem é curta e aponta notas do cérebro para os detalhes.')}</h2>
      <ol class="cv-msgs" id="cv-msgs" aria-live="polite">${htmlMensagens()}</ol>
      ${doEspaco.length ? '' : '<p class="dica" style="padding-top:14px;border-top:1px solid var(--linha)">Crie agentes neste espaço para mandar mensagens a eles por aqui.</p>'}
      <form class="cv-enviar" data-form="cv-mensagem" ${doEspaco.length ? '' : 'hidden'}>
        <h3 class="rotulo" style="color:var(--texto)">Mensagem do operador</h3>
        <div class="grupo"><label for="cv-para">Para</label><select class="campo" id="cv-para" name="para">${doEspaco.map((a) => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('')}</select></div>
        <div class="grupo"><label for="cv-obj">Objetivo</label><textarea class="campo" id="cv-obj" name="objetivo" rows="3" maxlength="600" placeholder="O que você precisa, em uma ou duas frases."></textarea></div>
        <div class="grupo"><label for="cv-refs">Do cérebro (opcional) ${ajuda('Caminhos de notas do vault que o agente deve ler. Separe com vírgula ou use a busca abaixo.')}</label><input class="campo mono" id="cv-refs" name="refs" placeholder="20-areas/seguranca/como-testar.md" autocomplete="off"></div>
        <div class="grupo"><label for="cv-busca">Procurar no cérebro</label><input class="campo" id="cv-busca" data-cv-mudar="busca" placeholder="Ex.: owasp, testes, jwt" autocomplete="off"></div>
        <ul class="cv-achados" id="cv-achados"></ul>
        <button class="btn pequeno" type="submit" ${doEspaco.length ? '' : 'disabled'}>Enviar</button>
      </form>`;
    const lista = $('#cv-msgs');
    lista.scrollTop = lista.scrollHeight;
  };

  const htmlMensagens = () =>
    C.mensagens.length
      ? C.mensagens
          .slice(-60)
          .map(
            (m) => `<li>
          <span class="dica">${hora(m.criada)} · <span style="color:var(--texto)">${esc(m.deNome)}</span> → <span style="color:var(--texto)">${esc(m.paraNome)}</span>${m.re ? ` · resposta a ${esc(m.re)}` : ''} · ${rotuloEstado[m.estado] ?? m.estado}</span>
          <span class="serif" style="font-size:16px;line-height:1.4">${esc(m.objetivo)}</span>
          ${m.refs.map((r) => `<span class="mono acento" style="font-size:11.5px;word-break:break-all">${esc(r)}</span>`).join('')}
        </li>`,
          )
          .join('')
      : '<li class="dica">Ainda ninguém conversou neste espaço. Ligue dois agentes com um fio e peça algo a um deles.</li>';

  let buscaT = null;
  const buscarCerebro = (termo) => {
    clearTimeout(buscaT);
    buscaT = setTimeout(async () => {
      const lista = $('#cv-achados');
      if (!lista) return;
      if (!termo.trim()) return (lista.innerHTML = '');
      const { itens } = await api('GET', `/api/cerebro?q=${encodeURIComponent(termo)}&limite=6`);
      lista.innerHTML = itens.length
        ? itens.map((i) => `<li><button type="button" class="link" data-cv="usar-ref" data-caminho="${esc(i.caminho)}" style="text-align:left"><span class="mono" style="font-size:12px">${esc(i.caminho)}</span>${i.estado ? ` <span class="dica">${esc(i.estado)}</span>` : ''}</button></li>`).join('')
        : '<li class="dica">Nada no cérebro com esses termos.</li>';
    }, 250);
  };

  // ---------------------------------------------------------------- diálogo de agentes

  const abrirDialogo = (editar = null) => {
    const a = editar ? agente(editar) : null;
    const projeto = S.d.projetos.find((p) => p.id === C.ws);
    const ias = S.d.ias.filter((i) => i.ativa && (i.status === 'pronto' || i.tipo === 'simulado'));
    const areas = [...new Set([...(S.d.areas ?? []), ...S.d.equipes.map((e) => e.area).filter(Boolean)])].sort();
    const padraoIA = a?.iaId ?? (ias.find((i) => i.tipo === 'claude') ?? ias[0])?.id;
    $('#cv-dialogo').innerHTML = `<div class="cv-modal" role="dialog" aria-modal="true" aria-labelledby="cv-dlg-t">
      <form class="cv-modal-caixa" data-form="cv-agente" data-editar="${esc(editar ?? '')}">
        <h2 class="titulo" id="cv-dlg-t" style="font-size:30px">${a ? `Editar ${esc(a.nome)}` : 'Novos agentes'}</h2>
        <p class="dica" style="font-size:14px">${a ? 'Mudanças de IA ou pasta valem a partir do próximo início.' : 'Cada agente é um terminal real com a IA escolhida. Com mais de um, eles ganham o mesmo papel e um número no nome.'}</p>
        <div class="cv-grade">
          <div class="grupo"><label for="ag-nome">${a ? 'Nome' : 'Nome ou prefixo'}</label><input class="campo" id="ag-nome" name="nome" required value="${esc(a?.nome ?? '')}" placeholder="Ex.: Revisor"></div>
          ${a ? '' : `<div class="grupo"><label for="ag-qtd">Quantos</label><input class="campo num" id="ag-qtd" name="quantidade" type="number" min="1" max="12" value="1"></div>`}
          <div class="grupo"><label for="ag-ia">IA</label><select class="campo" id="ag-ia" name="iaId">${ias.map((i) => `<option value="${esc(i.id)}" ${i.id === padraoIA ? 'selected' : ''}>${esc(i.nome)}</option>`).join('')}</select></div>
          <div class="grupo"><label for="ag-area">Área do cérebro ${ajuda('Pasta do vault com o que já funcionou nesse assunto. O agente é avisado para consultar antes de começar.')}</label><select class="campo" id="ag-area" name="area"><option value="">Nenhuma</option>${areas.map((x) => `<option ${x === a?.area ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
          <div class="grupo largo"><label for="ag-papel">Papel ${ajuda('Uma frase dizendo o que este agente faz. Os outros agentes veem isso no orq quem.')}</label><input class="campo" id="ag-papel" name="papel" maxlength="300" value="${esc(a?.papel ?? '')}" placeholder="Ex.: revisa PRs procurando falhas de segurança"></div>
          <div class="grupo"><label for="ag-maquina">Máquina ${ajuda('Onde o terminal roda: aqui ou numa máquina remota por SSH (cadastrada em Máquinas).')}</label><select class="campo" id="ag-maquina" name="maquinaId"><option value="">${projeto?.maquinaId ? 'A do projeto' : 'Este computador'}</option>${S.d.maquinas.map((m) => `<option value="${esc(m.id)}" ${a?.maquinaId === m.id ? 'selected' : ''}>${esc(m.nome)} (SSH)</option>`).join('')}</select></div>
          <div class="grupo largo"><label for="ag-pasta">Pasta onde o terminal abre</label><input class="campo mono" id="ag-pasta" name="pasta" value="${esc(a?.pasta ?? projeto?.pasta ?? '')}" placeholder="~/projetos/meu-repo"></div>
        </div>
        ${comAjuda(`<label class="check"><input type="checkbox" name="briefing" ${a?.briefing === false ? '' : 'checked'}><span>Apresentar o agente ao time ao iniciar</span></label>`, 'Ao abrir, o terminal recebe um aviso curto: nome, papel, área do cérebro e como usar o orq. Desligue para terminais comuns.')}
        ${a ? '' : `<label class="check"><input type="checkbox" name="iniciar" checked><span>Iniciar já</span></label>`}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn texto" data-cv="fechar-dialogo">Cancelar</button>
          <button type="submit" class="btn">${a ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    </div>`;
    $('#ag-nome').focus();
  };

  const fecharDialogo = () => ($('#cv-dialogo').innerHTML = '');

  // ---------------------------------------------------------------- ações

  const acoes = {
    espaco: (b) => {
      C.ws = b.dataset.id;
      localStorage.setItem('orq.cv.ws', C.ws);
      carregar();
    },
    'novo-agente': () => abrirDialogo(),
    'editar-agente': (b) => abrirDialogo(b.closest('.no').dataset.agente),
    'fechar-dialogo': fecharDialogo,
    'nova-nota': () => {
      const c = centroVisivel();
      adicionar({ tipo: 'nota', x: c.x - 130, y: c.y - 100, w: 260, h: 200, texto: '', cor: 'roxo' });
    },
    'novo-rascunho': () => {
      const c = centroVisivel();
      adicionar({ tipo: 'rascunho', x: c.x - 220, y: c.y - 160, w: 440, h: 320, titulo: '', tracos: [] });
    },
    'remover-no': async (b) => {
      const el = b.closest('.no');
      const n = C.doc.nos.find((x) => x.id === el.dataset.no);
      if (!n) return;
      if (n.tipo === 'agente') {
        if (!confirm(`Remover o agente ${agente(n.agenteId)?.nome}? O terminal é encerrado.`)) return;
        await api('DELETE', `/api/agentes/${encodeURIComponent(n.agenteId)}`);
        return;
      }
      if ((n.texto || n.tracos?.length) && !confirm('Remover este item?')) return;
      C.doc.nos = C.doc.nos.filter((x) => x !== n);
      renderTudo();
      salvar();
    },
    'remover-fio': (b) => {
      C.doc.conexoes = C.doc.conexoes.filter((c) => c.id !== b.dataset.id);
      renderFios();
      salvar();
    },
    cor: (b) => {
      const n = C.doc.nos.find((x) => x.id === b.closest('.no').dataset.no);
      n.cor = CORES[(CORES.indexOf(n.cor) + 1) % CORES.length];
      renderTudo();
      salvar();
    },
    limpar: (b) => {
      const n = C.doc.nos.find((x) => x.id === b.closest('.no').dataset.no);
      if (n.tracos?.length && !confirm('Apagar o desenho?')) return;
      n.tracos = [];
      renderTudo();
      salvar();
    },
    desfazer: (b) => {
      const n = C.doc.nos.find((x) => x.id === b.closest('.no').dataset.no);
      n.tracos?.pop();
      renderTudo();
      salvar();
    },
    iniciar: async (b) => {
      const r = C.els.get(b.closest('.no').dataset.no);
      await api('POST', `/api/agentes/${encodeURIComponent(r.no.agenteId)}/iniciar`, r.tam);
      r.term?.focus();
    },
    parar: (b) => api('POST', `/api/agentes/${encodeURIComponent(b.closest('.no').dataset.agente)}/parar`),
    reiniciar: (b) => {
      const r = C.els.get(b.closest('.no').dataset.no);
      return api('POST', `/api/agentes/${encodeURIComponent(r.no.agenteId)}/reiniciar`, r.tam);
    },
    'zoom-mais': () => {
      const a = $('#cv-area').getBoundingClientRect();
      zoomEm(a.left + a.width / 2, a.top + a.height / 2, 1.2);
    },
    'zoom-menos': () => {
      const a = $('#cv-area').getBoundingClientRect();
      zoomEm(a.left + a.width / 2, a.top + a.height / 2, 1 / 1.2);
    },
    ajustar,
    painel: (b) => {
      C.painel = !C.painel;
      localStorage.setItem('orq.cv.painel', C.painel ? '1' : '0');
      b.setAttribute('aria-pressed', String(C.painel));
      $('#cv-painel').hidden = !C.painel;
      renderPainel();
      for (const r of C.els.values()) r.ajustarTam?.();
    },
    'usar-ref': (b) => {
      const campo = $('#cv-refs');
      const atuais = campo.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!atuais.includes(b.dataset.caminho)) atuais.push(b.dataset.caminho);
      campo.value = atuais.join(', ');
    },
  };

  const formularios = {
    'cv-agente': async (f) => {
      const d = Object.fromEntries(new FormData(f).entries());
      const editar = f.dataset.editar;
      if (editar) {
        await api('PATCH', `/api/agentes/${encodeURIComponent(editar)}`, { nome: d.nome, iaId: d.iaId, papel: d.papel, area: d.area, pasta: d.pasta, maquinaId: d.maquinaId || null, briefing: !!d.briefing });
      } else {
        const c = centroVisivel();
        const qtd = Number(d.quantidade) || 1;
        await api('POST', '/api/agentes', {
          ...d,
          quantidade: qtd,
          briefing: !!d.briefing,
          iniciar: !!d.iniciar,
          workspace: C.ws,
          projetoId: S.d.projetos.some((p) => p.id === C.ws) ? C.ws : null,
          x: c.x - (Math.min(qtd, 3) * 680) / 2,
          y: c.y - 210,
        });
      }
      fecharDialogo();
    },
    'cv-mensagem': async (f) => {
      const d = Object.fromEntries(new FormData(f).entries());
      if (!d.objetivo?.trim()) return;
      await api('POST', '/api/mensagens', { de: 'operador', para: d.para, objetivo: d.objetivo, refs: d.refs });
      f.elements.objetivo.value = '';
      f.elements.refs.value = '';
    },
  };

  // ---------------------------------------------------------------- eventos do app

  const evento = (e) => {
    if (!C.vivo || !C.doc) return;
    if (e.tipo === 'canvas' && e.canvas.id === C.ws && e.autor !== C.autor) {
      if (C.gesto) return;
      const vista = C.doc.vista;
      if (C.salvarT) {
        // Tenho mudanças locais ainda não salvas: só incorporo agentes novos e removidos no servidor.
        const meus = new Set(C.doc.nos.filter((n) => n.tipo === 'agente').map((n) => n.agenteId));
        const deles = new Set(e.canvas.nos.filter((n) => n.tipo === 'agente').map((n) => n.agenteId));
        C.doc.nos = C.doc.nos.filter((n) => n.tipo !== 'agente' || deles.has(n.agenteId)).concat(e.canvas.nos.filter((n) => n.tipo === 'agente' && !meus.has(n.agenteId)));
        C.doc.conexoes = C.doc.conexoes.filter((c) => deles.has(c.de) && deles.has(c.para));
      } else C.doc = { ...e.canvas, vista };
      renderEspacos();
      renderTudo();
      renderPainel();
    }
    if (e.tipo === 'agente' || e.tipo === 'agente.removido') {
      renderTudo();
      renderPainel();
    }
    if (e.tipo === 'mensagem' && e.mensagem.workspace === C.ws) {
      const i = C.mensagens.findIndex((m) => m.id === e.mensagem.id);
      if (i < 0) {
        C.mensagens.push(e.mensagem);
        pulsar(e.mensagem);
      } else C.mensagens[i] = e.mensagem;
      renderPainel();
    }
    if (e.tipo === 'projeto' || e.tipo === 'projeto.removido') renderEspacos();
  };

  // Delegação: o app.js repassa cliques e envios que têm data-cv / data-form daqui.
  const clique = (b) => acoes[b.dataset.cv]?.(b);
  const enviar = (f) => formularios[f.dataset.form]?.(f);
  const mudar = (el) => {
    if (el.dataset.cvMudar === 'livre') {
      C.doc.livre = el.checked;
      salvar();
      toast(el.checked ? 'Todos os agentes deste espaço podem conversar entre si.' : 'Só agentes ligados por fio podem conversar.');
    }
  };
  const digitar = (el) => {
    if (el.dataset.cvMudar === 'busca') buscarCerebro(el.value);
  };

  return { montar, desmontar, atualizar: () => (renderTudo(), renderPainel()), evento, clique, enviar, mudar, digitar, temFormulario: (nome) => nome in formularios };
};
