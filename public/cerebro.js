// Tela "Cérebro": o graph view do Obsidian, dentro do app.
// Cada ponto é uma nota do vault; os pontos grandes são as equipes. Dá para filtrar por equipe
// e ver o conhecimento dela se formando, ao vivo, conforme as tarefas andam.

const CORES = ['#9d7bff', '#e07bff', '#ff8fc7', '#6fd39b', '#f0b45a', '#c4a7ff', '#ff9b7a', '#b65cff', '#f2d16b', '#8fe0c0', '#ff6fa5', '#d9c6ff'];
const CINZA = '#6e6e78';
const DISTANCIA = { area: 70, link: 95, trabalho: 150 };

export const criarTelaCerebro = ({ S, $, esc, api, toast, markdown, lerLocal, gravarLocal }) => {
  const G = {
    nos: [],
    ligacoes: [],
    pos: new Map(), // id -> { x, y, vx, vy, preso, nasceu }
    vista: { x: 0, y: 0, z: 1 },
    filtro: lerLocal('orq.cerebro.filtro', 'tudo'),
    tarefas: lerLocal('orq.cerebro.tarefas', '1') === '1',
    busca: '',
    sel: null,
    hover: null,
    calor: 1,
    quadro: null,
    vivo: false,
    carregando: false,
    primeira: true,
  };

  // A cor segue a família: Segurança web e Segurança de eventos ficam com a mesma cor.
  const grupoCor = (chave) => {
    const hub = G.nos.find((n) => n.tipo === 'equipe' && (n.equipe ?? n.area) === chave);
    return hub?.familia ? `familia:${hub.familia}` : chave;
  };
  const corDe = (equipeOuArea) => {
    if (!equipeOuArea) return CINZA;
    const ids = [...new Set(G.nos.filter((n) => n.tipo === 'equipe').map((n) => grupoCor(n.equipe ?? n.area)))].sort();
    const i = ids.indexOf(grupoCor(equipeOuArea));
    return CORES[(i < 0 ? 0 : i) % CORES.length];
  };
  const chaveEquipe = (n) => (n.tipo === 'equipe' ? n.equipe ?? n.area : n.equipe ?? n.area);
  const corNo = (n) => (n.tipo === 'tarefa' ? (n.estado === 'falhou' ? '#f08a80' : '#8f8f99') : n.tipo === 'outro' ? CINZA : corDe(chaveEquipe(n)));
  const raio = (n) => (n.tipo === 'equipe' ? 11 + Math.sqrt(n.notas) * 2.4 : n.tipo === 'tarefa' ? 4.5 : 4 + Math.min(6, Math.sqrt(n.tamanho / 700)));

  // ---------------------------------------------------------------- dados

  const visiveis = () => {
    const nos = G.nos.filter((n) => (G.tarefas || n.tipo !== 'tarefa') && n.id !== 'README.md');
    const ids = new Set(nos.map((n) => n.id));
    return { nos, ligacoes: G.ligacoes.filter((l) => ids.has(l.de) && ids.has(l.para)) };
  };

  // O que pertence à equipe filtrada: o nó dela, as notas da área, as tarefas em que trabalhou e o que elas citam.
  const doFiltro = () => {
    if (G.filtro === 'tudo') return null;
    const hub = G.nos.find((n) => n.tipo === 'equipe' && (n.equipe ?? n.area) === G.filtro);
    if (!hub) return null;
    const dentro = new Set([hub.id]);
    for (const l of G.ligacoes) {
      if (l.de === hub.id) dentro.add(l.para);
      if (l.para === hub.id) dentro.add(l.de);
    }
    for (const l of G.ligacoes) {
      if (l.tipo !== 'link') continue;
      if (dentro.has(l.de)) dentro.add(l.para);
      else if (dentro.has(l.para)) dentro.add(l.de);
    }
    return dentro;
  };

  const vizinhos = (id) => {
    const v = new Set([id]);
    for (const l of G.ligacoes) {
      if (l.de === id) v.add(l.para);
      if (l.para === id) v.add(l.de);
    }
    return v;
  };

  const carregar = async () => {
    if (G.carregando) return;
    G.carregando = true;
    try {
      const d = await api('GET', '/api/cerebro/grafo');
      const novos = d.nos.filter((n) => !G.pos.has(n.id));
      G.nos = d.nos;
      G.ligacoes = d.ligacoes;
      // Nó novo nasce perto de quem ele se liga (a equipe dele), não no meio do nada.
      for (const n of novos) {
        const l = d.ligacoes.find((x) => (x.de === n.id && G.pos.has(x.para)) || (x.para === n.id && G.pos.has(x.de)));
        const perto = l ? G.pos.get(l.de === n.id ? l.para : l.de) : null;
        const ang = Math.random() * Math.PI * 2;
        const dist = perto ? 30 : 120 + Math.random() * 160;
        G.pos.set(n.id, { x: (perto?.x ?? 0) + Math.cos(ang) * dist, y: (perto?.y ?? 0) + Math.sin(ang) * dist, vx: 0, vy: 0, preso: false, nasceu: G.primeira ? 0 : performance.now() });
      }
      for (const id of [...G.pos.keys()]) if (!d.nos.some((n) => n.id === id)) G.pos.delete(id);
      if (novos.length) G.calor = Math.max(G.calor, G.primeira ? 1 : 0.6);
      if (G.sel && !G.nos.some((n) => n.id === G.sel)) G.sel = null;
      if (G.primeira) {
        G.primeira = false;
        for (let i = 0; i < 220; i++) passo();
        ajustar();
      }
      lateral();
      cabecalho();
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      G.carregando = false;
    }
  };

  // ---------------------------------------------------------------- física

  const passo = () => {
    const { nos, ligacoes } = visiveis();
    const ps = nos.map((n) => [n, G.pos.get(n.id)]).filter(([, p]) => p);
    const a = G.calor;
    for (let i = 0; i < ps.length; i++) {
      const [ni, pi] = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const [nj, pj] = ps[j];
        let dx = pj.x - pi.x;
        let dy = pj.y - pi.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.25;
        }
        if (d2 > 250000) continue;
        const d = Math.sqrt(d2);
        const carga = (ni.tipo === 'equipe' ? 3 : 1) * (nj.tipo === 'equipe' ? 3 : 1);
        let f = (900 * carga) / d2;
        const minimo = raio(ni) + raio(nj) + 6;
        if (d < minimo) f += (minimo - d) * 0.5;
        const fx = (dx / d) * f * a;
        const fy = (dy / d) * f * a;
        pi.vx -= fx;
        pi.vy -= fy;
        pj.vx += fx;
        pj.vy += fy;
      }
    }
    for (const l of ligacoes) {
      const p1 = G.pos.get(l.de);
      const p2 = G.pos.get(l.para);
      if (!p1 || !p2) continue;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - (DISTANCIA[l.tipo] ?? 90)) / d) * (l.tipo === 'trabalho' ? 0.02 : 0.06) * a;
      p1.vx += dx * f;
      p1.vy += dy * f;
      p2.vx -= dx * f;
      p2.vy -= dy * f;
    }
    for (const [n, p] of ps) {
      const g = n.tipo === 'equipe' ? 0.004 : 0.002;
      p.vx -= p.x * g * a;
      p.vy -= p.y * g * a;
      if (p.preso) {
        p.vx = p.vy = 0;
        continue;
      }
      p.vx *= 0.62;
      p.vy *= 0.62;
      p.x += p.vx;
      p.y += p.vy;
    }
    G.calor = Math.max(0.02, G.calor * 0.992);
  };

  // ---------------------------------------------------------------- desenho

  const tela = () => $('#cb-tela');
  const paraTela = (x, y) => ({ x: x * G.vista.z + G.vista.x, y: y * G.vista.z + G.vista.y });
  const doMundo = (sx, sy) => ({ x: (sx - G.vista.x) / G.vista.z, y: (sy - G.vista.y) / G.vista.z });

  const desenhar = () => {
    const c = tela();
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { nos, ligacoes } = visiveis();
    const filtro = doFiltro();
    const foco = G.hover ?? G.sel;
    const perto = foco ? vizinhos(foco) : null;
    const busca = G.busca.trim().toLowerCase();
    const casa = (n) => !busca || `${n.titulo} ${n.id}`.toLowerCase().includes(busca);
    const aceso = (id, n) => (!filtro || filtro.has(id)) && (!perto || perto.has(id)) && (!n || casa(n));
    const agora = performance.now();

    ctx.save();
    ctx.translate(G.vista.x, G.vista.y);
    ctx.scale(G.vista.z, G.vista.z);
    for (const l of ligacoes) {
      const p1 = G.pos.get(l.de);
      const p2 = G.pos.get(l.para);
      if (!p1 || !p2) continue;
      const on = aceso(l.de) && aceso(l.para);
      ctx.strokeStyle = on ? (perto ? 'rgba(205,189,255,.55)' : 'rgba(157,123,255,.22)') : 'rgba(157,123,255,.05)';
      ctx.lineWidth = (l.tipo === 'link' ? 1.2 : 0.8) / G.vista.z;
      ctx.setLineDash(l.tipo === 'trabalho' ? [4 / G.vista.z, 4 / G.vista.z] : []);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const n of nos) {
      const p = G.pos.get(n.id);
      if (!p) continue;
      const on = aceso(n.id, n);
      const cor = corNo(n);
      // Nota nova: cresce e brilha por alguns segundos.
      const idade = p.nasceu ? (agora - p.nasceu) / 1000 : 99;
      const escala = idade < 0.6 ? 0.3 + idade / 0.85 : 1;
      const r = raio(n) * escala;
      ctx.globalAlpha = on ? 1 : 0.12;
      if (idade < 4) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6 + idade * 3, 0, Math.PI * 2);
        ctx.strokeStyle = cor;
        ctx.globalAlpha = (on ? 1 : 0.12) * Math.max(0, 0.7 - idade / 6);
        ctx.lineWidth = 2 / G.vista.z;
        ctx.stroke();
        ctx.globalAlpha = on ? 1 : 0.12;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      // Rascunho = anel; validado = cheio (como no Obsidian com cores por estado).
      if (n.tipo === 'conhecimento' && n.estado !== 'validado') {
        ctx.fillStyle = '#0b0a10';
        ctx.fill();
        ctx.strokeStyle = cor;
        ctx.lineWidth = 1.8 / Math.max(1, G.vista.z * 0.8);
        ctx.stroke();
      } else {
        ctx.fillStyle = cor;
        ctx.fill();
      }
      if (n.id === G.sel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#eaeaf0';
        ctx.lineWidth = 1.5 / G.vista.z;
        ctx.stroke();
      }
      const rotulo = n.tipo === 'equipe' || n.id === foco || (perto?.has(n.id) && G.vista.z > 0.7) || (busca && casa(n)) || G.vista.z > 1.6;
      if (rotulo && on) {
        const tam = n.tipo === 'equipe' ? 15 : 12;
        ctx.font = `${n.tipo === 'equipe' ? '500 ' : ''}${tam / G.vista.z}px ${n.tipo === 'equipe' ? 'Newsreader, Georgia, serif' : 'Geist, system-ui, sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = n.tipo === 'equipe' ? '#eaeaf0' : '#a9a9b3';
        const texto = n.titulo.length > 38 ? `${n.titulo.slice(0, 36)}…` : n.titulo;
        ctx.fillText(texto, p.x, p.y + r + 4 / G.vista.z);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const laco = () => {
    if (!G.vivo) return;
    if (G.calor > 0.025 || G.arrasto) passo();
    desenhar();
    G.quadro = requestAnimationFrame(laco);
  };

  // ---------------------------------------------------------------- interação

  const noEm = (sx, sy) => {
    const m = doMundo(sx, sy);
    const { nos } = visiveis();
    let melhor = null;
    let dist = Infinity;
    for (const n of nos) {
      const p = G.pos.get(n.id);
      if (!p) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < raio(n) + 6 / G.vista.z && d < dist) {
        melhor = n;
        dist = d;
      }
    }
    return melhor;
  };

  const ajustar = () => {
    const c = tela();
    if (!c) return;
    const filtro = doFiltro();
    const ids = visiveis().nos.map((n) => n.id).filter((id) => !filtro || filtro.has(id));
    const ps = ids.map((id) => G.pos.get(id)).filter(Boolean);
    if (!ps.length) {
      G.vista = { x: c.clientWidth / 2, y: c.clientHeight / 2, z: 1 };
      return;
    }
    const minX = Math.min(...ps.map((p) => p.x)) - 60;
    const maxX = Math.max(...ps.map((p) => p.x)) + 60;
    const minY = Math.min(...ps.map((p) => p.y)) - 60;
    const maxY = Math.max(...ps.map((p) => p.y)) + 60;
    const z = Math.min(2.2, Math.max(0.2, Math.min(c.clientWidth / (maxX - minX), c.clientHeight / (maxY - minY))));
    G.vista = { z, x: c.clientWidth / 2 - ((minX + maxX) / 2) * z, y: c.clientHeight / 2 - ((minY + maxY) / 2) * z };
  };

  const ligarEventos = () => {
    const c = tela();
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect();
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;
      const antes = doMundo(sx, sy);
      const z = Math.min(4, Math.max(0.15, G.vista.z * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))));
      G.vista = { z, x: sx - antes.x * z, y: sy - antes.y * z };
    }, { passive: false });
    c.addEventListener('pointerdown', (ev) => {
      const r = c.getBoundingClientRect();
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;
      const n = noEm(sx, sy);
      c.setPointerCapture(ev.pointerId);
      G.arrasto = { n, sx, sy, vx: G.vista.x, vy: G.vista.y, moveu: false };
      if (n) {
        G.pos.get(n.id).preso = true;
        G.calor = Math.max(G.calor, 0.3);
      }
    });
    c.addEventListener('pointermove', (ev) => {
      const r = c.getBoundingClientRect();
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;
      const a = G.arrasto;
      if (!a) {
        const n = noEm(sx, sy);
        G.hover = n?.id ?? null;
        c.style.cursor = n ? 'pointer' : 'grab';
        c.title = n ? `${n.titulo}${n.tipo === 'equipe' ? ` · ${n.notas} ${n.notas === 1 ? 'nota' : 'notas'}` : ''}` : '';
        return;
      }
      if (Math.hypot(sx - a.sx, sy - a.sy) > 3) a.moveu = true;
      if (a.n) {
        const m = doMundo(sx, sy);
        const p = G.pos.get(a.n.id);
        p.x = m.x;
        p.y = m.y;
        G.calor = Math.max(G.calor, 0.25);
      } else {
        G.vista.x = a.vx + (sx - a.sx);
        G.vista.y = a.vy + (sy - a.sy);
        c.style.cursor = 'grabbing';
      }
    });
    const soltar = () => {
      const a = G.arrasto;
      G.arrasto = null;
      if (!a) return;
      if (a.n) G.pos.get(a.n.id).preso = false;
      if (!a.moveu) selecionar(a.n?.id ?? null);
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);
    c.addEventListener('pointerleave', () => (G.hover = null));
  };

  const selecionar = async (id) => {
    G.sel = id;
    const n = G.nos.find((x) => x.id === id);
    // Clicar numa equipe = filtrar por ela.
    if (n?.tipo === 'equipe') return filtrar(n.equipe ?? n.area);
    lateral();
    if (!n || n.tipo === 'equipe') return;
    const caixa = $('#cb-nota');
    if (!caixa) return;
    caixa.innerHTML = '<p class="dica">Abrindo a nota…</p>';
    try {
      const nota = await api('GET', `/api/cerebro/nota?caminho=${encodeURIComponent(n.id)}`);
      if (G.sel !== id) return;
      const corpo = nota.conteudo.replace(/^---[\s\S]*?---\s*/, '');
      caixa.innerHTML = `<article class="manual cb-md">${markdown(corpo).html}</article>`;
    } catch {
      caixa.innerHTML = '<p class="dica erro">Não deu para abrir esta nota.</p>';
    }
  };

  const filtrar = (f) => {
    G.filtro = f;
    gravarLocal('orq.cerebro.filtro', f);
    G.sel = null;
    cabecalho();
    lateral();
    ajustar();
  };

  // ---------------------------------------------------------------- painéis

  const equipesNoGrafo = () => G.nos.filter((n) => n.tipo === 'equipe').sort((a, b) => b.notas - a.notas || a.titulo.localeCompare(b.titulo));

  const cabecalho = () => {
    const caixa = $('#cb-filtros');
    if (!caixa) return;
    const total = G.nos.filter((n) => n.tipo === 'conhecimento');
    caixa.innerHTML =
      `<button type="button" class="pill" data-cb="filtro" data-v="tudo" aria-pressed="${G.filtro === 'tudo'}">Tudo <span class="dica">${total.length}</span></button>` +
      equipesNoGrafo()
        .map((n) => {
          const k = n.equipe ?? n.area;
          return `<button type="button" class="pill" data-cb="filtro" data-v="${esc(k)}" aria-pressed="${G.filtro === k}"><span class="ponto" style="background:${corDe(k)}"></span>${esc(n.titulo)} <span class="dica">${n.notas}</span></button>`;
        })
        .join('');
    const conhecimento = total.length;
    const validadas = total.filter((n) => n.estado === 'validado').length;
    const tarefas = G.nos.filter((n) => n.tipo === 'tarefa').length;
    $('#cb-numeros').innerHTML = `<span><b>${conhecimento}</b> ${conhecimento === 1 ? 'nota' : 'notas'} de conhecimento</span><span><b>${validadas}</b> ${validadas === 1 ? 'validada' : 'validadas'}</span><span><b>${G.ligacoes.length}</b> ligações</span><span><b>${tarefas}</b> ${tarefas === 1 ? 'tarefa' : 'tarefas'}</span>`;
    const vazio = $('#cb-vazio');
    if (vazio) vazio.hidden = conhecimento + tarefas > 0;
  };

  const quando = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    return `há ${Math.round(s / 86400)} d`;
  };

  // Painel da direita: a equipe filtrada (o que ela está formando) ou a nota escolhida.
  const lateral = () => {
    const caixa = $('#cb-lado');
    if (!caixa) return;
    const n = G.nos.find((x) => x.id === G.sel);
    if (n && n.tipo !== 'equipe') {
      const k = chaveEquipe(n);
      const hub = G.nos.find((x) => x.tipo === 'equipe' && (x.equipe ?? x.area) === k);
      const ligadas = [...vizinhos(n.id)].filter((id) => id !== n.id).map((id) => G.nos.find((x) => x.id === id)).filter(Boolean);
      caixa.innerHTML = `<div class="empilha" style="gap:10px">
        <button type="button" class="link" data-cb="voltar" style="align-self:flex-start">← ${G.filtro === 'tudo' ? 'Visão geral' : 'Voltar para a equipe'}</button>
        <h2 class="titulo" style="font-size:26px;line-height:1.15">${esc(n.titulo)}</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          ${n.tipo === 'tarefa' ? `<span class="selo">tarefa · ${esc(n.estado ?? '')}</span>` : n.tipo === 'conhecimento' ? `<span class="selo ${n.estado === 'validado' ? 'ok' : 'espera'}">${n.estado === 'validado' ? 'validado' : 'rascunho'}</span>` : ''}
          ${hub ? `<span class="selo"><span class="ponto" style="background:${corDe(k)}"></span>${esc(hub.titulo)}</span>` : ''}
          <span class="dica">atualizada ${quando(n.atualizado)}</span>
        </div>
        <span class="mono dica" style="font-size:12px;word-break:break-all">${esc(n.id)}</span>
        ${n.tipo === 'conhecimento' && n.estado !== 'validado' ? `<button type="button" class="btn contorno pequeno" data-cb="validar" data-id="${esc(n.id)}" style="align-self:flex-start" data-dica="Marca como conhecimento confiável. As equipes dão preferência a notas validadas.">Validar esta nota</button>` : ''}
        ${ligadas.length ? `<div class="empilha" style="gap:4px"><span class="rotulo">Ligada a</span>${ligadas.slice(0, 12).map((x) => `<button type="button" class="link cb-item" data-cb="ir" data-id="${esc(x.id)}"><span class="ponto" style="background:${corNo(x)}"></span>${esc(x.titulo)}</button>`).join('')}</div>` : ''}
        <div id="cb-nota" class="cb-nota"></div>
      </div>`;
      return;
    }
    const hub = G.filtro === 'tudo' ? null : G.nos.find((x) => x.tipo === 'equipe' && (x.equipe ?? x.area) === G.filtro);
    if (hub) {
      const k = G.filtro;
      const notas = G.nos.filter((x) => x.tipo === 'conhecimento' && chaveEquipe(x) === k).sort((a, b) => b.atualizado - a.atualizado);
      const tarefas = G.ligacoes.filter((l) => l.tipo === 'trabalho' && (l.de === hub.id || l.para === hub.id)).map((l) => G.nos.find((x) => x.id === (l.de === hub.id ? l.para : l.de))).filter(Boolean);
      const equipe = S.d.equipes.find((e) => e.id === hub.equipe);
      const validadas = notas.filter((x) => x.estado === 'validado').length;
      caixa.innerHTML = `<div class="empilha" style="gap:12px">
        <button type="button" class="link" data-cb="filtro" data-v="tudo" style="align-self:flex-start">← Visão geral</button>
        <div style="display:flex;align-items:center;gap:10px"><span class="ponto" style="width:12px;height:12px;background:${corDe(k)}"></span><h2 class="titulo" style="font-size:30px">${esc(hub.titulo)}</h2></div>
        ${equipe ? `<p class="dica" style="font-size:14px;line-height:1.5">${esc(equipe.desc)}</p>` : ''}
        <div class="cb-cartoes">
          <div><b>${notas.length}</b><span>${notas.length === 1 ? 'nota' : 'notas'}</span></div>
          <div><b>${validadas}</b><span>${validadas === 1 ? 'validada' : 'validadas'}</span></div>
          <div><b>${tarefas.length}</b><span>${tarefas.length === 1 ? 'tarefa' : 'tarefas'}</span></div>
        </div>
        <span class="rotulo">O que esta equipe já sabe</span>
        ${notas.length ? notas.slice(0, 30).map((x) => `<button type="button" class="link cb-item" data-cb="ir" data-id="${esc(x.id)}"><span class="ponto ${x.estado === 'validado' ? '' : 'vazado'}" style="--cor:${corDe(k)};background:${x.estado === 'validado' ? corDe(k) : 'transparent'}"></span><span class="cresce">${esc(x.titulo)}</span><span class="dica">${quando(x.atualizado)}</span></button>`).join('') : '<p class="dica">Ainda nada. Quando esta equipe aprender algo numa tarefa, a nota aparece aqui e no grafo.</p>'}
        ${tarefas.length ? `<span class="rotulo" style="margin-top:6px">Tarefas em que trabalhou</span>${tarefas.slice(0, 12).map((x) => `<button type="button" class="link cb-item" data-cb="ir" data-id="${esc(x.id)}"><span class="ponto" style="background:${corNo(x)}"></span>${esc(x.titulo)}</button>`).join('')}` : ''}
      </div>`;
      return;
    }
    const recentes = G.nos.filter((x) => x.tipo === 'conhecimento').sort((a, b) => b.atualizado - a.atualizado).slice(0, 12);
    caixa.innerHTML = `<div class="empilha" style="gap:12px">
      <h2 class="titulo" style="font-size:28px">Como ler o grafo</h2>
      <ul class="cb-legenda">
        <li><span class="ponto" style="width:14px;height:14px;background:var(--acento)"></span>Equipe. Quanto maior, mais ela já aprendeu.</li>
        <li><span class="ponto" style="background:var(--acento)"></span>Nota validada: conhecimento que você aprovou.</li>
        <li><span class="ponto vazado" style="--cor:var(--acento)"></span>Rascunho: a equipe aprendeu, falta você aprovar.</li>
        <li><span class="ponto" style="background:#8f8f99"></span>Tarefa. A linha tracejada liga às equipes que trabalharam nela.</li>
      </ul>
      <p class="dica">Clique numa equipe para ver só o que ela está formando. Clique numa nota para ler. Arraste para mover, use a roda do mouse para zoom.</p>
      ${recentes.length ? `<span class="rotulo">Aprendido por último</span>${recentes.map((x) => `<button type="button" class="link cb-item" data-cb="ir" data-id="${esc(x.id)}"><span class="ponto" style="background:${corNo(x)}"></span><span class="cresce">${esc(x.titulo)}</span><span class="dica">${quando(x.atualizado)}</span></button>`).join('')}` : ''}
    </div>`;
  };

  // ---------------------------------------------------------------- tela

  // A tela ocupa exatamente o que sobra da janela abaixo do topo (que pode quebrar em duas linhas).
  const encaixar = () => {
    const el = document.querySelector('.cerebro');
    if (el) el.style.height = `${Math.max(520, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 8)}px`;
  };

  const montar = () => {
    $('#app').innerHTML = `<div class="cerebro">
      <div class="cb-topo">
        <div class="empilha" style="gap:4px">
          <h1 class="titulo" style="font-size:34px">Cérebro</h1>
          <span class="dica" id="cb-numeros"></span>
        </div>
        <div class="cresce"></div>
        <input class="campo" id="cb-busca" type="search" placeholder="Procurar nota…" aria-label="Procurar nota" style="width:220px;height:38px">
        <label class="check" data-dica="Mostra as tarefas e as equipes que trabalharam em cada uma."><input type="checkbox" id="cb-tarefas" ${G.tarefas ? 'checked' : ''}>Tarefas</label>
        <button type="button" class="btn contorno pequeno" data-cb="ajustar">Enquadrar</button>
      </div>
      <div class="cb-filtros" id="cb-filtros" role="group" aria-label="Filtrar por equipe"></div>
      <div class="cb-corpo">
        <div class="cb-area">
          <canvas id="cb-tela" aria-label="Grafo do cérebro: notas e equipes" role="img"></canvas>
          <div class="cb-vazio" id="cb-vazio" hidden>
            <h2 class="titulo" style="font-size:28px">O cérebro ainda está vazio</h2>
            <p class="dica" style="font-size:15px;line-height:1.55">Cada tarefa vira uma nota, e cada coisa que uma equipe aprende vira um ponto ligado a ela. Mande uma solicitação e volte aqui para ver o conhecimento se formar.</p>
          </div>
        </div>
        <aside class="cb-lado" id="cb-lado" aria-live="polite"></aside>
      </div>
    </div>`;
    ligarEventos();
    encaixar();
    window.addEventListener('resize', encaixar);
    $('#cb-busca').addEventListener('input', (ev) => (G.busca = ev.target.value));
    $('#cb-tarefas').addEventListener('change', (ev) => {
      G.tarefas = ev.target.checked;
      gravarLocal('orq.cerebro.tarefas', G.tarefas ? '1' : '0');
      G.calor = Math.max(G.calor, 0.4);
    });
    $('#app').addEventListener('click', clique);
    G.vivo = true;
    G.vista = { x: tela().clientWidth / 2, y: tela().clientHeight / 2, z: 1 };
    cabecalho();
    lateral();
    carregar();
    laco();
  };

  const clique = async (ev) => {
    const b = ev.target.closest('[data-cb]');
    if (!b) return;
    const acao = b.dataset.cb;
    if (acao === 'filtro') return filtrar(b.dataset.v);
    if (acao === 'ajustar') return ajustar();
    if (acao === 'voltar') return selecionar(null);
    if (acao === 'ir') return selecionar(b.dataset.id);
    if (acao === 'validar') {
      await api('POST', '/api/cerebro/validar', { caminho: b.dataset.id });
      toast('Nota validada.');
      return carregar();
    }
  };

  const desmontar = () => {
    window.removeEventListener('resize', encaixar);
    G.vivo = false;
    cancelAnimationFrame(G.quadro);
    $('#app').removeEventListener('click', clique);
  };

  let espera = null;
  const mudou = () => {
    if (!G.vivo) return;
    clearTimeout(espera);
    espera = setTimeout(carregar, 600);
  };

  return { montar, desmontar, atualizar: () => {}, mudou };
};
