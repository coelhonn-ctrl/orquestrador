// Grafo 2D com física simples, desenhado num canvas: o par do modo 3D (3d-force-graph).
// Mesma ideia: pontos que se repelem, ligações que puxam, partículas correndo pelas ligações,
// arrastar para mover, roda do mouse para zoom. Os nós são os mesmos objetos do modo 3D.

const idDe = (x) => (x && typeof x === 'object' ? x.id : x);

export const criarGrafo2D = (container, op = {}) => {
  const o = {
    cor: (n) => n.cor ?? '#9d7bff',
    raio: (n) => 4 + Math.sqrt(n.val ?? 1) * 2.2,
    apagado: () => false,
    escala: () => 1,
    anel: () => null,
    corLigacao: () => 'rgba(157,123,255,.35)',
    corParticula: () => '#e07bff',
    larguraLigacao: () => 1,
    distancia: () => 90,
    aoClicar: () => {},
    aoPassar: () => {},
    titulo: () => '',
    ...op,
  };
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:grab;touch-action:none';
  container.appendChild(canvas);
  const G = { nodes: [], links: [], porId: new Map(), vista: { x: 0, y: 0, z: 1 }, calor: 1, particulas: [], ativos: new Set(), arrasto: null, vivo: true, quadro: null, enquadrou: false };

  const pontas = (l) => [G.porId.get(idDe(l.source)), G.porId.get(idDe(l.target))];

  const dados = ({ nodes, links }) => {
    const novos = nodes.filter((n) => !G.porId.has(n.id));
    G.nodes = nodes;
    G.links = links;
    G.porId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of novos) {
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) continue;
      // Nó novo nasce perto de quem ele se liga.
      const l = links.find((x) => idDe(x.source) === n.id || idDe(x.target) === n.id);
      const viz = l && G.porId.get(idDe(l.source) === n.id ? idDe(l.target) : idDe(l.source));
      const ang = Math.random() * Math.PI * 2;
      const d = viz && Number.isFinite(viz.x) ? 40 : 80 + Math.random() * 120;
      n.x = (viz?.x ?? 0) + Math.cos(ang) * d;
      n.y = (viz?.y ?? 0) + Math.sin(ang) * d;
    }
    for (const n of nodes) {
      n.v2x ??= 0;
      n.v2y ??= 0;
    }
    if (novos.length) G.calor = Math.max(G.calor, 0.7);
  };

  const passo = () => {
    const ns = G.nodes;
    const a = G.calor;
    for (let i = 0; i < ns.length; i++) {
      const p = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const q = ns[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.25;
        }
        if (d2 > 360000) continue;
        const d = Math.sqrt(d2);
        let f = (1400 * Math.sqrt((p.val ?? 1) * (q.val ?? 1))) / d2;
        const min = o.raio(p) + o.raio(q) + 10;
        if (d < min) f += (min - d) * 0.5;
        const fx = (dx / d) * f * a;
        const fy = (dy / d) * f * a;
        p.v2x -= fx;
        p.v2y -= fy;
        q.v2x += fx;
        q.v2y += fy;
      }
    }
    for (const l of G.links) {
      const [p, q] = pontas(l);
      if (!p || !q) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - o.distancia(l)) / d) * 0.05 * a;
      p.v2x += dx * f;
      p.v2y += dy * f;
      q.v2x -= dx * f;
      q.v2y -= dy * f;
    }
    for (const n of ns) {
      n.v2x -= n.x * 0.003 * a;
      n.v2y -= n.y * 0.003 * a;
      if (n.preso) {
        n.v2x = n.v2y = 0;
        continue;
      }
      n.v2x *= 0.62;
      n.v2y *= 0.62;
      n.x += n.v2x;
      n.y += n.v2y;
    }
    G.calor = Math.max(0.02, G.calor * 0.99);
  };

  // Curva levemente arqueada da ligação; devolve o ponto em t (0..1) e a ponta para a seta.
  const curva = (p, q) => {
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const c = { x: mx - dy * 0.12, y: my + dx * 0.12 };
    const em = (t) => ({ x: (1 - t) * (1 - t) * p.x + 2 * (1 - t) * t * c.x + t * t * q.x, y: (1 - t) * (1 - t) * p.y + 2 * (1 - t) * t * c.y + t * t * q.y });
    return { c, em };
  };

  const desenhar = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const z = G.vista.z;
    ctx.save();
    ctx.translate(G.vista.x, G.vista.y);
    ctx.scale(z, z);
    const t = performance.now();

    for (const l of G.links) {
      const [p, q] = pontas(l);
      if (!p || !q) continue;
      const apag = o.apagado(p) || o.apagado(q);
      const { c, em } = curva(p, q);
      ctx.globalAlpha = apag ? 0.15 : 1;
      ctx.strokeStyle = o.corLigacao(l);
      ctx.lineWidth = (o.larguraLigacao(l) * (G.ativos.has(l.id) ? 1.8 : 1)) / z;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(c.x, c.y, q.x, q.y);
      ctx.stroke();
      // Seta perto do destino.
      const r = o.raio(q) * o.escala(q);
      const tf = Math.max(0.5, 1 - (r + 4) / (Math.hypot(q.x - p.x, q.y - p.y) || 1));
      const a = em(tf);
      const b = em(tf - 0.04);
      const ang = Math.atan2(a.y - b.y, a.x - b.x);
      const s = 6 / Math.max(0.6, z);
      ctx.fillStyle = o.corParticula(l);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x - Math.cos(ang - 0.45) * s, a.y - Math.sin(ang - 0.45) * s);
      ctx.lineTo(a.x - Math.cos(ang + 0.45) * s, a.y - Math.sin(ang + 0.45) * s);
      ctx.fill();
      // Ligação de um trabalho em andamento: um fluxo contínuo e lento de pontos.
      if (G.ativos.has(l.id) && !apag) {
        for (let k = 0; k < 2; k++) {
          const pt = em(((t / 2200 + k / 2) % 1));
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2 / Math.max(0.7, z), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Partículas de mensagens (uma por mensagem, corre uma vez).
    G.particulas = G.particulas.filter((pa) => pa.t < 1);
    for (const pa of G.particulas) {
      const [p, q] = pontas(pa.l);
      if (!p || !q) {
        pa.t = 1;
        continue;
      }
      pa.t += 0.016;
      const pt = curva(p, q).em(Math.min(1, pa.t));
      ctx.globalAlpha = 1;
      ctx.fillStyle = o.corParticula(pa.l);
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.4 / Math.max(0.7, z), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (const n of G.nodes) {
      const apag = o.apagado(n);
      const e = o.escala(n);
      const r = o.raio(n) * e;
      const anel = o.anel(n);
      ctx.globalAlpha = apag ? 0.18 : 1;
      if (anel && !apag) {
        // Halo de quem está trabalhando: acende e apaga devagar, junto com o pulso.
        const g = ctx.createRadialGradient(n.x, n.y, r * 0.6, n.x, n.y, r * 2.6);
        g.addColorStop(0, anel);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.35 + (e - 1) * 1.6;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = o.cor(n);
      ctx.beginPath();
      if (o.forma?.(n) === 'quadrado' && ctx.roundRect) ctx.roundRect(n.x - r * 0.9, n.y - r * 0.9, r * 1.8, r * 1.8, r * 0.45);
      else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (n.vazado) {
        ctx.fillStyle = '#0b0a10';
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0, r - 1.8 / Math.max(1, z)), 0, Math.PI * 2);
        ctx.fill();
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

  const doMundo = (sx, sy) => ({ x: (sx - G.vista.x) / G.vista.z, y: (sy - G.vista.y) / G.vista.z });
  const paraTela = (n) => ({ x: n.x * G.vista.z + G.vista.x, y: n.y * G.vista.z + G.vista.y });
  const noEm = (sx, sy) => {
    const m = doMundo(sx, sy);
    let melhor = null;
    let dist = Infinity;
    for (const n of G.nodes) {
      const d = Math.hypot(n.x - m.x, n.y - m.y);
      if (d < o.raio(n) * o.escala(n) + 6 / G.vista.z && d < dist) {
        melhor = n;
        dist = d;
      }
    }
    return melhor;
  };

  const enquadrar = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!G.nodes.length || !w) {
      G.vista = { x: w / 2, y: h / 2, z: 1 };
      return;
    }
    const xs = G.nodes.map((n) => n.x);
    const ys = G.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 70;
    const maxX = Math.max(...xs) + 70;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;
    const z = Math.min(2.2, Math.max(0.2, Math.min(w / (maxX - minX), h / (maxY - minY))));
    G.vista = { z, x: w / 2 - ((minX + maxX) / 2) * z, y: h / 2 - ((minY + maxY) / 2) * z };
  };

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const [sx, sy] = pos(ev);
      const antes = doMundo(sx, sy);
      const z = Math.min(4, Math.max(0.15, G.vista.z * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))));
      G.vista = { z, x: sx - antes.x * z, y: sy - antes.y * z };
    },
    { passive: false },
  );
  canvas.addEventListener('pointerdown', (ev) => {
    const [sx, sy] = pos(ev);
    const n = noEm(sx, sy);
    canvas.setPointerCapture(ev.pointerId);
    G.arrasto = { n, sx, sy, vx: G.vista.x, vy: G.vista.y, moveu: false };
    if (n) {
      n.preso = true;
      G.calor = Math.max(G.calor, 0.3);
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [sx, sy] = pos(ev);
    const a = G.arrasto;
    if (!a) {
      const n = noEm(sx, sy);
      canvas.style.cursor = n ? 'pointer' : 'grab';
      canvas.title = n ? o.titulo(n) : '';
      o.aoPassar(n);
      return;
    }
    if (Math.hypot(sx - a.sx, sy - a.sy) > 3) a.moveu = true;
    if (a.n) {
      const m = doMundo(sx, sy);
      a.n.x = m.x;
      a.n.y = m.y;
      G.calor = Math.max(G.calor, 0.25);
    } else {
      G.vista.x = a.vx + (sx - a.sx);
      G.vista.y = a.vy + (sy - a.sy);
      canvas.style.cursor = 'grabbing';
    }
  });
  const soltar = () => {
    const a = G.arrasto;
    G.arrasto = null;
    if (!a) return;
    if (a.n) a.n.preso = false;
    if (!a.moveu) o.aoClicar(a.n ?? null);
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('pointerleave', () => o.aoPassar(null));

  G.vista = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, z: 1 };
  laco();

  return {
    dados,
    emitir: (l) => G.particulas.push({ l, t: 0 }),
    ativos: (set) => (G.ativos = set),
    aquecer: (v = 0.5) => (G.calor = Math.max(G.calor, v)),
    assentar: (passos = 200) => {
      for (let i = 0; i < passos; i++) passo();
    },
    enquadrar,
    paraTela,
    destruir: () => {
      G.vivo = false;
      cancelAnimationFrame(G.quadro);
      canvas.remove();
    },
  };
};
