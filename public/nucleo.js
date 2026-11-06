// "Núcleo" do Cérebro: um núcleo de luz no centro, com o conhecimento girando em volta num disco inclinado.
// Cada equipe é um anel do disco; cada nota é um ponto de luz no anel dela. Quando uma equipe trabalha,
// o anel dela acende e gira mais rápido; cada mensagem trocada vira um cometa que cai no anel de quem recebeu.
// Só desenho: os dados chegam por dados(), atividade() e cometa(), e os cliques saem por aoClicar/aoPassar.

const INCLINACAO = 0.36; // achatamento do disco (vista de lado)
const GIRO = -0.32; // rotação do disco na tela (rad)
const POEIRA = 1100;

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};
const rgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mistura = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

const BASE_DENTRO = rgb('#f4f0ff');
const BASE_MEIO = rgb('#b9a2ff');
const BASE_FORA = rgb('#7a4fe0');

export const criarNucleo = (canvas, op = {}) => {
  const ctx = canvas.getContext('2d');
  const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const N = {
    aneis: [], // { chave, titulo, cor, rgb, notas: [{ id, titulo, validado, nasceu, ang, rr }] }
    porChave: new Map(),
    nivel: new Map(), // chave -> 0..1 (atividade alvo)
    brilho: new Map(), // chave -> 0..1 (atividade suavizada)
    geral: 0,
    geralAlvo: 0,
    cometas: [],
    flashes: [],
    poeira: [],
    foco: null, // chave da equipe filtrada
    sel: null,
    hover: null,
    t0: performance.now(),
    ultimo: performance.now(),
    geo: null,
    vivo: true,
    pontos: [], // posições de tela das notas (para o clique)
    rotulos: [], // posições de tela dos nomes das equipes
  };

  // ------------------------------------------------------------ geometria

  const medir = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = Math.max(120, Math.min(h * 0.8, w * 0.43));
    N.geo = { w, h, cx: w / 2, cy: h * 0.49, a, nucleo: a * 0.12, dentro: a * 0.2, fora: a };
    return N.geo;
  };

  // Ponto do disco (raio r, ângulo th) na tela; z > 0 = na frente do núcleo.
  const projetar = (r, th) => {
    const g = N.geo;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th) * INCLINACAO;
    const c = Math.cos(GIRO);
    const s = Math.sin(GIRO);
    return { x: g.cx + x * c - y * s, y: g.cy + x * s + y * c, z: Math.sin(th) };
  };

  // Faixa de raio de cada anel (as equipes que mais sabem ficam mais perto do núcleo).
  const faixa = (i) => {
    const g = N.geo;
    const n = Math.max(1, N.aneis.length);
    const larg = (g.fora - g.dentro) / n;
    return { de: g.dentro + larg * i, ate: g.dentro + larg * (i + 1), meio: g.dentro + larg * (i + 0.5), larg };
  };

  const velocidade = (r) => 0.55 * Math.pow(N.geo.dentro / r, 1.5); // rad/s, mais rápido perto do centro

  const semear = () => {
    N.poeira = [];
    for (let i = 0; i < POEIRA; i++) {
      const u = Math.random();
      N.poeira.push({ u: Math.pow(u, 0.85), th: Math.random() * Math.PI * 2, tam: Math.random() < 0.08 ? 1.6 : 0.5 + Math.random() * 0.9, a: 0.25 + Math.random() * 0.65, cint: Math.random() * Math.PI * 2 });
    }
  };

  // ------------------------------------------------------------ dados

  const dados = (aneis) => {
    const antes = new Map(N.aneis.flatMap((a) => a.notas.map((n) => [n.id, n])));
    N.aneis = aneis.map((a) => ({
      ...a,
      rgb: rgb(a.cor),
      notas: a.notas.map((n) => {
        const velha = antes.get(n.id);
        return { ...n, ang: velha?.ang ?? hash(n.id) * Math.PI * 2, rr: hash(`${n.id}#r`) };
      }),
    }));
    N.porChave = new Map(N.aneis.map((a, i) => [a.chave, i]));
  };

  const atividade = (mapa) => {
    N.nivel = new Map(mapa);
    N.geralAlvo = Math.min(1, [...mapa.values()].reduce((s, v) => s + v, 0) / 2);
  };

  // Mensagem: um cometa entra de fora e cai no anel de quem recebeu (ou no núcleo).
  const cometa = (chave, cor) => {
    if (!N.geo || calmo) return;
    const i = chave != null ? N.porChave.get(chave) : undefined;
    const alvo = i === undefined ? N.geo.nucleo * 1.1 : faixa(i).meio;
    const th = Math.random() * Math.PI * 2;
    N.cometas.push({ r0: N.geo.fora * 1.25, r1: alvo, th0: th, giro: 1.6 + Math.random() * 1.2, cor: rgb(cor || '#e6deff'), t: 0, dur: 1.5 + Math.random() * 0.5, chave: i === undefined ? null : chave });
    if (N.cometas.length > 40) N.cometas.shift();
  };

  // ------------------------------------------------------------ desenho

  const brilhoDe = (chave) => N.brilho.get(chave) ?? 0;
  const apagado = (chave) => N.foco && N.foco !== chave;

  const desenharNucleo = (g, t) => {
    const pulso = 0.5 - 0.5 * Math.cos((t / 2600) * Math.PI * 2);
    const forca = 0.55 + 0.45 * N.geral;
    // halo grande
    const halo = ctx.createRadialGradient(g.cx, g.cy, g.nucleo * 0.5, g.cx, g.cy, g.nucleo * (5.5 + 1.5 * N.geral));
    halo.addColorStop(0, `rgba(182,92,255,${0.32 * forca + 0.06 * pulso})`);
    halo.addColorStop(0.35, `rgba(157,123,255,${0.13 * forca})`);
    halo.addColorStop(1, 'rgba(157,123,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.nucleo * 7, 0, Math.PI * 2);
    ctx.fill();
    // anel de fótons (borda brilhante do núcleo)
    const anel = ctx.createRadialGradient(g.cx, g.cy, g.nucleo * 0.82, g.cx, g.cy, g.nucleo * 1.5);
    anel.addColorStop(0, 'rgba(255,255,255,0)');
    anel.addColorStop(0.18, `rgba(244,240,255,${0.85 * forca + 0.15 * pulso})`);
    anel.addColorStop(0.42, `rgba(205,189,255,${0.45 * forca})`);
    anel.addColorStop(1, 'rgba(157,123,255,0)');
    ctx.fillStyle = anel;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.nucleo * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // centro escuro
    const centro = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.nucleo * 0.95);
    centro.addColorStop(0, '#020104');
    centro.addColorStop(0.8, '#06030d');
    centro.addColorStop(1, 'rgba(10,6,22,0)');
    ctx.fillStyle = centro;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.nucleo * 0.95, 0, Math.PI * 2);
    ctx.fill();
  };

  // Arco de luz por cima do núcleo: a parte de trás do disco "dobrada" pela gravidade.
  const desenharLente = (g) => {
    const forca = 0.4 + 0.4 * N.geral;
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(GIRO);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, g.nucleo * (1.45 + k * 0.22), g.nucleo * (1.1 + k * 0.2), 0, Math.PI * 1.04, Math.PI * 1.96);
      ctx.strokeStyle = `rgba(230,222,255,${forca * (0.5 - k * 0.15)})`;
      ctx.lineWidth = 1.6 - k * 0.4;
      ctx.stroke();
    }
    ctx.restore();
  };

  const corPoeira = (r, g) => {
    const u = (r - g.dentro) / (g.fora - g.dentro);
    return u < 0.35 ? mistura(BASE_DENTRO, BASE_MEIO, u / 0.35) : mistura(BASE_MEIO, BASE_FORA, (u - 0.35) / 0.65);
  };

  const desenharPoeira = (g, t, frente) => {
    const n = Math.max(1, N.aneis.length);
    for (const p of N.poeira) {
      const r = g.dentro + p.u * (g.fora - g.dentro);
      const q = projetar(r, p.th);
      if (frente !== q.z > 0) continue;
      const i = Math.min(n - 1, Math.floor(p.u * n));
      const an = N.aneis[i];
      const b = an ? brilhoDe(an.chave) : 0;
      let cor = corPoeira(r, g);
      if (an) cor = mistura(cor, an.rgb, 0.35 + 0.35 * b);
      const cint = 0.75 + 0.25 * Math.sin(t / 900 + p.cint);
      let alfa = p.a * cint * (0.55 + 0.45 * b) * (frente ? 1 : 0.7);
      if (an && apagado(an.chave)) alfa *= 0.18;
      ctx.fillStyle = css(cor, alfa);
      const s = p.tam * (1 + 0.5 * b);
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
  };

  // Faixa colorida de cada anel: uma elipse fina que acende quando a equipe trabalha.
  const desenharAneis = (g, t, frente) => {
    N.aneis.forEach((an, i) => {
      const b = brilhoDe(an.chave);
      const f = faixa(i);
      const on = !apagado(an.chave);
      const pulso = b > 0.05 ? 0.5 - 0.5 * Math.cos((t / 1700) * Math.PI * 2) : 0;
      ctx.save();
      ctx.translate(g.cx, g.cy);
      ctx.rotate(GIRO);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.meio, f.meio * INCLINACAO, 0, frente ? 0 : Math.PI, frente ? Math.PI : Math.PI * 2);
      ctx.strokeStyle = css(an.rgb, on ? 0.07 + 0.3 * b + 0.18 * b * pulso + (N.foco === an.chave ? 0.15 : 0) : 0.02);
      ctx.lineWidth = Math.max(1, f.larg * (0.25 + 0.35 * b));
      ctx.stroke();
      ctx.restore();
    });
  };

  const desenharNotas = (g, t, frente) => {
    const agora = performance.now();
    N.aneis.forEach((an, i) => {
      const f = faixa(i);
      const on = !apagado(an.chave);
      for (const n of an.notas) {
        const r = f.de + f.larg * (0.2 + 0.6 * n.rr);
        const q = projetar(r, n.ang);
        if (frente !== q.z > 0) continue;
        const foco = n.id === N.sel || n.id === N.hover;
        const idade = n.nasceu ? (agora - n.nasceu) / 1000 : 99;
        const prof = 0.75 + 0.25 * q.z; // mais perto = maior
        const tam = (n.validado ? 2.6 : 2.1) * prof * (foco ? 1.7 : 1);
        const alfa = on ? (frente ? 1 : 0.65) : 0.12;
        // brilho
        const gl = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, tam * 5);
        gl.addColorStop(0, css(an.rgb, 0.55 * alfa));
        gl.addColorStop(1, css(an.rgb, 0));
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(q.x, q.y, tam * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(q.x, q.y, tam, 0, Math.PI * 2);
        if (n.validado) {
          ctx.fillStyle = css(mistura(an.rgb, [255, 255, 255], 0.45), alfa);
          ctx.fill();
        } else {
          ctx.fillStyle = css([8, 6, 14], alfa);
          ctx.fill();
          ctx.strokeStyle = css(an.rgb, alfa);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (idade < 5) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, tam + 4 + idade * 7, 0, Math.PI * 2);
          ctx.strokeStyle = css(an.rgb, Math.max(0, 0.8 - idade / 5) * alfa);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (foco) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, tam + 4, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(244,240,255,.9)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (on) N.pontos.push({ id: n.id, x: q.x, y: q.y, r: Math.max(7, tam * 2.5), titulo: n.titulo, z: q.z });
      }
    });
  };

  const desenharCometas = (g, dt) => {
    for (const c of N.cometas) c.t += dt;
    N.cometas = N.cometas.filter((c) => c.t < c.dur);
    ctx.globalCompositeOperation = 'lighter';
    for (const c of N.cometas) {
      const passos = 14;
      for (let k = 0; k < passos; k++) {
        const u = Math.max(0, Math.min(1, (c.t - k * 0.025) / c.dur));
        const e = 1 - Math.pow(1 - u, 2.2);
        const r = c.r0 + (c.r1 - c.r0) * e;
        const q = projetar(r, c.th0 + c.giro * e);
        const a = (1 - k / passos) * (u < 0.85 ? 1 : (1 - u) / 0.15);
        ctx.fillStyle = css(c.cor, 0.75 * a);
        const s = 2.6 * (1 - k / passos) + 0.4;
        ctx.beginPath();
        ctx.arc(q.x, q.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Chegou: um clarão no anel.
      if (c.t + dt >= c.dur * 0.97 && !c.chegou) {
        c.chegou = true;
        N.flashes.push({ chave: c.chave, t: 0, cor: c.cor });
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const desenharFlashes = (g, dt) => {
    for (const f of N.flashes) f.t += dt;
    N.flashes = N.flashes.filter((f) => f.t < 1.2);
    for (const f of N.flashes) {
      const i = f.chave == null ? undefined : N.porChave.get(f.chave);
      const r = i === undefined ? g.nucleo * 1.2 : faixa(i).meio;
      const a = 1 - f.t / 1.2;
      ctx.save();
      ctx.translate(g.cx, g.cy);
      ctx.rotate(GIRO);
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * (i === undefined ? 1 : INCLINACAO), 0, 0, Math.PI * 2);
      ctx.strokeStyle = css(f.cor, 0.45 * a);
      ctx.lineWidth = 2 + 6 * (1 - a);
      ctx.stroke();
      ctx.restore();
    }
  };

  // Nome de cada equipe na ponta direita do anel dela, em diagonal, como uma régua.
  const desenharNomes = (g) => {
    N.rotulos = [];
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const n = N.aneis.length;
    const passo = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((g.fora - g.dentro) / 15))));
    N.aneis.forEach((an, i) => {
      const b = brilhoDe(an.chave);
      const destaque = b > 0.05 || N.foco === an.chave;
      if (i % passo && !destaque) return;
      const f = faixa(i);
      const q = projetar(f.meio, -0.04);
      const x = q.x + 10;
      const y = q.y;
      ctx.font = `${destaque ? '500 ' : ''}${destaque ? 12.5 : 11.5}px Geist, system-ui, sans-serif`;
      const txt = an.titulo.length > 22 ? `${an.titulo.slice(0, 21)}…` : an.titulo;
      ctx.fillStyle = apagado(an.chave) ? 'rgba(169,169,179,.3)' : destaque ? css(mistura(an.rgb, [255, 255, 255], 0.5), 1) : 'rgba(169,169,179,.75)';
      ctx.fillText(txt, x, y);
      const larg = ctx.measureText(txt).width;
      // tracinho até o anel
      ctx.beginPath();
      ctx.moveTo(q.x + 2, y);
      ctx.lineTo(x - 3, y);
      ctx.strokeStyle = css(an.rgb, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      N.rotulos.push({ chave: an.chave, x0: x - 4, x1: x + larg + 4, y0: y - 9, y1: y + 9 });
    });
  };

  const quadro = () => {
    if (!N.vivo) return;
    const g = medir();
    const agora = performance.now();
    const dt = Math.min(0.1, (agora - N.ultimo) / 1000);
    N.ultimo = agora;
    const t = agora - N.t0;
    // atividade suavizada: acende rápido, apaga devagar
    for (const an of N.aneis) {
      const alvo = N.nivel.get(an.chave) ?? 0;
      const atual = N.brilho.get(an.chave) ?? 0;
      N.brilho.set(an.chave, atual + (alvo - atual) * Math.min(1, dt * (alvo > atual ? 4 : 1.2)));
    }
    N.geral += (N.geralAlvo - N.geral) * Math.min(1, dt * 1.5);
    // giro
    if (!calmo) {
      const acel = 1 + 1.4 * N.geral;
      const n = Math.max(1, N.aneis.length);
      for (const p of N.poeira) {
        const r = g.dentro + p.u * (g.fora - g.dentro);
        const an = N.aneis[Math.min(n - 1, Math.floor(p.u * n))];
        p.th += velocidade(r) * dt * acel * (1 + 1.2 * (an ? brilhoDe(an.chave) : 0));
      }
      N.aneis.forEach((an, i) => {
        const v = velocidade(faixa(i).meio) * 0.22 * (1 + 1.5 * brilhoDe(an.chave));
        for (const nt of an.notas) nt.ang += v * dt;
      });
    }
    ctx.clearRect(0, 0, g.w, g.h);
    N.pontos = [];
    // trás → núcleo → frente
    desenharAneis(g, t, false);
    desenharPoeira(g, t, false);
    desenharNotas(g, t, false);
    desenharNucleo(g, t);
    desenharLente(g);
    desenharAneis(g, t, true);
    ctx.globalCompositeOperation = 'lighter';
    desenharPoeira(g, t, true);
    ctx.globalCompositeOperation = 'source-over';
    desenharNotas(g, t, true);
    desenharFlashes(g, dt);
    desenharCometas(g, dt);
    desenharNomes(g);
    N.raf = requestAnimationFrame(quadro);
  };

  // ------------------------------------------------------------ interação

  const achar = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const rot = N.rotulos.find((l) => x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1);
    if (rot) return { equipe: rot.chave, x, y };
    let melhor = null;
    let dist = Infinity;
    for (const p of N.pontos) {
      const d = Math.hypot(p.x - x, p.y - y) - p.z; // na dúvida, o da frente
      if (d < p.r && d < dist) {
        melhor = p;
        dist = d;
      }
    }
    return melhor ? { nota: melhor, x, y } : { x, y };
  };
  const mover = (ev) => {
    const a = achar(ev);
    const id = a.nota?.id ?? null;
    canvas.style.cursor = a.nota || a.equipe ? 'pointer' : 'default';
    if (id !== N.hover) {
      N.hover = id;
      op.aoPassar?.(a.nota ? { id, titulo: a.nota.titulo, x: a.nota.x, y: a.nota.y } : null);
    }
  };
  const clicar = (ev) => {
    const a = achar(ev);
    if (a.equipe) return op.aoClicarEquipe?.(a.equipe);
    op.aoClicar?.(a.nota?.id ?? null);
  };
  const sair = () => {
    N.hover = null;
    op.aoPassar?.(null);
  };
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('click', clicar);
  canvas.addEventListener('pointerleave', sair);

  medir();
  semear();
  N.raf = requestAnimationFrame(quadro);

  return {
    dados,
    atividade,
    cometa,
    foco: (chave) => (N.foco = chave),
    selecionar: (id) => (N.sel = id),
    destruir: () => {
      N.vivo = false;
      cancelAnimationFrame(N.raf);
      canvas.removeEventListener('pointermove', mover);
      canvas.removeEventListener('click', clicar);
      canvas.removeEventListener('pointerleave', sair);
    },
  };
};
