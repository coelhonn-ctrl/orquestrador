// Tela "Cérebro": o graph view do Obsidian, dentro do app.
// Cada ponto é uma nota do vault; os pontos grandes são as equipes. Dá para filtrar por equipe
// e ver o conhecimento dela se formando, ao vivo, conforme as tarefas andam.

import { carregar3D, lerModo, gravarModo, botoesModo } from '/lib3d.js';
import { criarNucleo } from '/nucleo.js';
import { criarGalaxia, suportaGalaxia } from '/galaxia.js';
import { COR, COR_TIPO, VERBO, NOME_PAPEL, ESTADOS_ATIVOS, criarAtividade, duracao, curto } from '/atividade.js';

const MODOS = ['nucleo', '2d', '3d'];
const ROTULO_TAREFA = { fila: 'na fila', planejando: 'planejando', executando: 'em andamento', esperando: 'esperando você', revisao: 'para revisar', pausada: 'pausada' };
const ORDEM_TAREFA = { executando: 0, planejando: 1, esperando: 2, pausada: 3, revisao: 4, fila: 5 };
const ROTULO_TREINO = { 'gerando-casos': 'criando casos de teste', treinando: 'treinando', 'provando-ias': 'provando as IAs' };

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
    modo: lerModo('orq.cerebro.vista', 'nucleo', MODOS),
    nc: null, // o núcleo (modo padrão)
    A: criarAtividade(S), // quem está trabalhando agora
    usos: new Map(), // nota -> { em, equipe, como }: o conhecimento usado agora
    eventos: [], // últimas mensagens entre os agentes
    relogio: null,
    g3: null, // grafo 3D (quando o modo é 3D)
    n3: new Map(), // id -> nó do 3D (objetos próprios: o 3D guarda posição x/y/z neles)
    assinatura3: '',
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
      dados3D();
      dadosNucleo();
      recentes();
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
    if (G.modo === '3d') quadro3D();
    else if (G.modo === '2d') {
      if (G.calor > 0.025 || G.arrasto) passo();
      desenhar();
    }
    G.quadro = requestAnimationFrame(laco);
  };

  // ---------------------------------------------------------------- modo 3D

  // Mesma regra de destaque do 2D: filtro por equipe, vizinhos do ponto em foco e a busca.
  const estadoDestaque = () => {
    const filtro = doFiltro();
    const foco = G.hover ?? G.sel;
    const perto = foco ? vizinhos(foco) : null;
    const busca = G.busca.trim().toLowerCase();
    const casa = (n) => !busca || `${n.titulo} ${n.id}`.toLowerCase().includes(busca);
    return { filtro, foco, perto, busca, casa, aceso: (n) => (!filtro || filtro.has(n.id)) && (!perto || perto.has(n.id)) && casa(n) };
  };

  const dados3D = () => {
    if (!G.g3) return;
    const { nos, ligacoes } = visiveis();
    const ids = new Set(nos.map((n) => n.id));
    for (const id of [...G.n3.keys()]) if (!ids.has(id)) G.n3.delete(id);
    for (const n of nos) {
      const o = G.n3.get(n.id) ?? { id: n.id };
      o.ref = n;
      o.val = Math.max(0.6, Math.pow(raio(n) / 4, 3));
      G.n3.set(n.id, o);
    }
    G.g3.graphData({ nodes: [...G.n3.values()], links: ligacoes.map((l) => ({ source: l.de, target: l.para, tipo: l.tipo })) });
    G.assinatura3 = '';
  };

  const cor3D = (o) => {
    const n = o.ref;
    const { aceso } = G.estado3 ?? estadoDestaque();
    const cor = corNo(n);
    if (!aceso(n)) return `${cor}26`;
    // Rascunho (ainda não validado): mais transparente, como o anel do 2D.
    return n.tipo === 'conhecimento' && n.estado !== 'validado' ? `${cor}88` : cor;
  };

  const montar3D = async () => {
    const area = $('#cb-3d');
    if (!area) return;
    let ForceGraph3D;
    try {
      ForceGraph3D = await carregar3D();
    } catch (e) {
      toast(`Não foi possível abrir o 3D (${e.message}). Voltando ao 2D.`, 'erro');
      return trocarModo('2d');
    }
    if (!G.vivo || G.modo !== '3d' || !$('#cb-3d')) return;
    const g = ForceGraph3D({ controlType: 'orbit' })(area)
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeId('id')
      .nodeVal('val')
      .nodeRelSize(3)
      .nodeColor(cor3D)
      .nodeOpacity(0.95)
      .nodeResolution(14)
      .nodeLabel((o) => `<div class="cm-rotulo"><b>${esc(o.ref.titulo)}</b><span>${esc(o.ref.tipo === 'equipe' ? `equipe · ${o.ref.notas} ${o.ref.notas === 1 ? 'nota' : 'notas'}` : o.ref.tipo === 'tarefa' ? `tarefa · ${o.ref.estado ?? ''}` : o.ref.estado === 'validado' ? 'conhecimento validado' : 'rascunho')}</span></div>`)
      .linkColor((l) => (l.tipo === 'link' ? 'rgba(205,189,255,.55)' : l.tipo === 'trabalho' ? 'rgba(143,143,153,.35)' : 'rgba(157,123,255,.3)'))
      .linkWidth((l) => (l.tipo === 'link' ? 0.8 : 0.3))
      .linkOpacity(0.45)
      .onNodeClick((o) => selecionar(o.id))
      .onNodeHover((o) => {
        G.hover = o?.id ?? null;
        area.style.cursor = o ? 'pointer' : 'grab';
      })
      .onBackgroundClick(() => selecionar(null));
    g.d3Force('charge').strength((o) => (o.ref?.tipo === 'equipe' ? -160 : -40));
    g.d3Force('link').distance((l) => DISTANCIA[l.tipo] ?? 90);
    G.g3 = g;
    encaixar3D();
    dados3D();
    setTimeout(() => G.vivo && G.g3 === g && g.zoomToFit(600, 50), 1200);
  };

  const encaixar3D = () => {
    const area = $('#cb-3d');
    if (G.g3 && area) G.g3.width(area.clientWidth).height(area.clientHeight);
  };

  const desmontar3D = () => {
    try {
      G.g3?.pauseAnimation();
      G.g3?._destructor?.();
    } catch {}
    G.g3 = null;
    const area = $('#cb-3d');
    if (area) area.innerHTML = '';
    $('#cb-rotulos')?.replaceChildren();
  };

  // A cada quadro no 3D: destaque (só quando muda), nota nova pulsando e nomes por cima dos pontos.
  const quadro3D = () => {
    const g = G.g3;
    if (!g) return;
    const est = estadoDestaque();
    G.estado3 = est;
    const assinatura = `${G.hover}|${G.sel}|${G.filtro}|${est.busca}`;
    if (assinatura !== G.assinatura3) {
      G.assinatura3 = assinatura;
      g.nodeColor(cor3D);
    }
    const agora = performance.now();
    const camada = $('#cb-rotulos');
    const els = camada ? new Map([...camada.children].map((el) => [el.dataset.id, el])) : new Map();
    const vistos = new Set();
    for (const o of G.n3.values()) {
      const n = o.ref;
      const nasceu = G.pos.get(n.id)?.nasceu;
      const idade = nasceu ? (agora - nasceu) / 1000 : 99;
      if (o.__threeObj) {
        const s = idade < 4 ? 1 + 0.35 * Math.max(0, Math.sin(idade * Math.PI * 1.5)) * (1 - idade / 4) : 1;
        o.__threeObj.scale.set(s, s, s);
      }
      if (!camada || !Number.isFinite(o.x)) continue;
      const rot = n.tipo === 'equipe' || n.id === est.foco || (est.perto?.has(n.id) && n.tipo !== 'tarefa') || (est.busca && est.casa(n));
      if (!rot || !est.aceso(n)) continue;
      const { x, y } = g.graph2ScreenCoords(o.x, o.y, o.z);
      let el = els.get(n.id);
      if (!el) {
        el = document.createElement('span');
        el.className = `cm-nome ${n.tipo === 'equipe' ? 'gestor' : 'ia'}`;
        el.dataset.id = n.id;
        el.textContent = n.titulo.length > 38 ? `${n.titulo.slice(0, 36)}…` : n.titulo;
        camada.appendChild(el);
      }
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      vistos.add(n.id);
    }
    for (const [id, el] of els) if (!vistos.has(id)) el.remove();
  };

  const DICA = {
    nucleo: 'Arraste para girar · botão direito ou Shift move · roda aproxima e entra · duplo clique entra na galáxia · Esc volta',
    '2d': 'Arraste para mover · role para aproximar · clique num ponto para abrir',
    '3d': 'Arraste para girar · role para aproximar · clique num ponto para abrir',
  };
  const trocarModo = async (modo) => {
    if (!MODOS.includes(modo)) modo = 'nucleo';
    if (modo === G.modo && (modo !== '3d' || G.g3) && (modo !== 'nucleo' || G.nc)) return;
    G.modo = modo;
    gravarModo('orq.cerebro.vista', modo);
    for (const b of document.querySelectorAll('[data-cb-modo]')) b.setAttribute('aria-checked', String(b.dataset.cbModo === modo));
    const tela_ = tela();
    if (tela_) tela_.hidden = modo !== '2d';
    const area = $('#cb-3d');
    if (area) area.hidden = modo !== '3d';
    const nc = $('#cb-nucleo');
    if (nc && modo !== 'nucleo') nc.hidden = true;
    const un = $('#cb-universo');
    if (un && modo !== 'nucleo') un.hidden = true;
    for (const el of document.querySelectorAll('[data-so-grafo]')) el.hidden = modo === 'nucleo';
    const dica = $('#cb-dica');
    if (dica) dica.textContent = DICA[modo];
    if (modo !== '3d') desmontar3D();
    if (modo !== 'nucleo') desmontarNucleo();
    if (modo === '3d') await montar3D();
    else if (modo === 'nucleo') montarNucleo();
    else {
      G.calor = Math.max(G.calor, 0.3);
      requestAnimationFrame(ajustar);
    }
    cabecalho();
  };

  // ---------------------------------------------------------------- modo núcleo

  // Um anel por equipe: as que mais sabem ficam mais perto do núcleo.
  const aneis = (comBusca = true) => {
    const chaves = new Map();
    for (const n of equipesNoGrafo()) chaves.set(n.equipe ?? n.area, n.titulo);
    for (const e of S.d.equipes) if (e.ativa !== false && !chaves.has(e.id)) chaves.set(e.id, e.nome);
    const busca = comBusca ? G.busca.trim().toLowerCase() : '';
    return [...chaves]
      .map(([chave, titulo]) => ({
        chave,
        titulo,
        cor: corDe(chave),
        notas: G.nos
          .filter((n) => n.tipo === 'conhecimento' && chaveEquipe(n) === chave && (!busca || `${n.titulo} ${n.id}`.toLowerCase().includes(busca)))
          .map((n) => ({ id: n.id, titulo: n.titulo, validado: n.estado === 'validado', camada: n.camada ?? 'conhecimento', nasceu: G.pos.get(n.id)?.nasceu ?? 0 })),
      }))
      .sort((a, b) => b.notas.length - a.notas.length || a.titulo.localeCompare(b.titulo));
  };
  // Conhecimento base (o buraco negro): o que não é de nenhuma equipe — leia-me, mapa das áreas, skills.
  const ehBase = (n) => n.tipo === 'outro' || (n.tipo === 'conhecimento' && !chaveEquipe(n));
  const dadosNucleo = () => {
    if (!G.nc) return;
    const base = G.nos.filter(ehBase).map((n) => ({ id: n.id, titulo: n.titulo, mapa: /(^|\/)(_mapa|README)\.md$/i.test(n.id) }));
    const ligacoes = G.ligacoes.filter((l) => l.tipo === 'link');
    G.nc.dados(aneis(!G.nc.galaxia), base, ligacoes);
    G.nc.busca?.(G.busca);
    atividadeNucleo();
    tarefasNucleo();
  };
  // Tarefas em andamento no universo: ligadas às galáxias das equipes do plano, a atual mais forte.
  const tarefasNucleo = () => {
    if (!G.nc?.tarefas) return;
    const lista = S.d.tarefas
      .filter((t) => ['executando', 'planejando', 'esperando', 'pausada'].includes(t.estado))
      .map((t) => ({ id: t.id, titulo: t.titulo, equipes: [...new Set((t.plano ?? []).map((p) => p.equipe))], atual: (t.plano ?? []).find((p) => p.estado === 'atual')?.equipe ?? null }));
    const ass = JSON.stringify(lista);
    if (ass === G.assTarefas) return;
    G.assTarefas = ass;
    G.nc.tarefas(lista);
  };
  // Onde um participante da conversa fica no universo: a galáxia da equipe dele, ou o buraco negro (null).
  const ondeNoUniverso = (id) => {
    if (!id) return null;
    if (ehAnel(id)) return id;
    if (id.startsWith('ia:')) {
      const de = G.A.fazendo(id)?.de ?? G.A.ultimaDe.get(id)?.de;
      return de && de !== id && ehAnel(de) ? de : null;
    }
    if (id.includes(':') && !id.startsWith('agente:')) return ehAnel(id.split(':')[0]) ? id.split(':')[0] : null;
    return null;
  };
  const ehAnel = (id) => S.d.equipes.some((e) => e.id === id) || G.nos.some((n) => n.tipo === 'equipe' && (n.equipe ?? n.area) === id);
  // Quanto cada equipe está trabalhando agora (ela mesma ou a IA que trabalha para ela).
  const atividadeNucleo = () => {
    if (!G.nc) return;
    const m = new Map();
    for (const id of G.A.trabalho.keys()) {
      if (id === 'voce') continue;
      const chave = id.startsWith('ia:') ? G.A.fazendo(id)?.de : id.includes(':') && !id.startsWith('agente:') ? id.split(':')[0] : id;
      if (chave && ehAnel(chave)) m.set(chave, 1);
    }
    G.nc.atividade(m);
  };
  const opNucleo = () => {
    const dica = $('#cb-flutua');
    return {
      aoClicar: (id) => selecionar(id),
      aoClicarEquipe: (chave, o) => {
        G.semVoo = o?.voar === false;
        filtrar(!chave || G.filtro === chave ? (o?.voar === false && chave ? chave : 'tudo') : chave);
        G.semVoo = false;
      },
      aoPassar: (p) => {
        if (!dica) return;
        dica.hidden = !p;
        if (!p) return;
        dica.textContent = p.base ? `${p.titulo} · conhecimento base` : p.titulo;
        dica.style.transform = `translate(${Math.round(p.x + 12)}px, ${Math.round(p.y - 34)}px)`;
      },
    };
  };
  // O universo (WebGL2, sem bibliotecas) é o padrão; sem WebGL2, cai no núcleo desenhado em 2D.
  const universo = (div) => {
    const gx = criarGalaxia(div, { ...opNucleo(), aoClicarBase: () => abrirBase() });
    return {
      galaxia: true,
      dados: (lista, base, ligacoes) => gx.dados({ galaxias: lista, base, links: ligacoes.map((l) => ({ de: l.de, para: l.para })) }),
      atividade: gx.atividade,
      foco: (chave, o) => gx.foco(chave, o?.voar !== false),
      selecionar: gx.selecionar,
      cometa: (para, cor, de) => gx.cometa(de, para, cor),
      usar: gx.usar,
      irPara: gx.irPara,
      busca: gx.busca,
      visaoGeral: gx.visaoGeral,
      aproximar: gx.aproximar,
      destruir: gx.destruir,
    };
  };
  const montarNucleo = () => {
    if (G.nc) return;
    const div = $('#cb-universo');
    const c = $('#cb-nucleo');
    if (!div || !c) return;
    let nc = null;
    if (suportaGalaxia()) {
      try {
        div.hidden = false;
        nc = universo(div);
        c.hidden = true;
      } catch (e) {
        console.warn('[cérebro] universo indisponível, usando o núcleo 2D:', e);
        div.hidden = true;
        div.replaceChildren();
      }
    }
    if (!nc) {
      div.hidden = true;
      c.hidden = false;
      nc = criarNucleo(c, opNucleo());
    }
    G.nc = nc;
    const ctl = $('#cb-controles');
    if (ctl) ctl.hidden = !nc.galaxia;
    G.nc.foco(G.filtro === 'tudo' ? null : G.filtro, { voar: false });
    dadosNucleo();
    G.nc.usar?.([...G.usos.keys()]);
  };
  const desmontarNucleo = () => {
    G.nc?.destruir();
    G.nc = null;
    const ctl = $('#cb-controles');
    if (ctl) ctl.hidden = true;
    G.assTarefas = '';
    const d = $('#cb-flutua');
    if (d) d.hidden = true;
  };

  // ---------------------------------------------------------------- ao vivo: tarefas, agentes e conversas

  const tempo = (iso) => (iso ? duracao(Date.now() - Date.parse(iso)) : '');
  const colunaTarefas = () => {
    const el = $('#cb-tarefas-vivo');
    if (!el) return;
    const tarefas = S.d.tarefas.filter((t) => t.estado in ORDEM_TAREFA).sort((a, b) => ORDEM_TAREFA[a.estado] - ORDEM_TAREFA[b.estado] || (a.criada < b.criada ? 1 : -1));
    const treinos = (S.d.treinos ?? []).filter((t) => ESTADOS_ATIVOS.treino.includes(t.estado));
    const n = $('#cb-n-tarefas');
    if (n) n.textContent = String(tarefas.length + treinos.length);
    const etapas = (t) =>
      (t.plano ?? []).length
        ? `<span class="cb-etapas" aria-label="${(t.plano ?? []).filter((p) => p.estado === 'ok').length} de ${t.plano.length} etapas">${t.plano.map((p) => `<i class="${p.estado === 'ok' ? 'ok' : p.estado === 'atual' ? 'atual' : ''}" style="--cor:${corDe(p.equipe)}" title="${esc(S.d.equipes.find((e) => e.id === p.equipe)?.nome ?? p.equipe)}"></i>`).join('')}</span>`
        : '';
    const agora = (t) => {
      const p = (t.plano ?? []).find((x) => x.estado === 'atual');
      if (p) return `<span class="cb-agora-linha"><span class="ponto" style="background:${corDe(p.equipe)}"></span><b>${esc(S.d.equipes.find((e) => e.id === p.equipe)?.nome ?? p.equipe)}</b> ${esc(curto(p.objetivo, 70))}</span>`;
      return t.fase ? `<span class="cb-agora-linha">${esc(curto(t.fase, 80))}</span>` : '';
    };
    el.innerHTML =
      tarefas
        .map(
          (t) => `<a class="cb-cartao ${t.estado}" href="#/tarefa/${esc(t.id)}">
            <span class="cb-cartao-topo"><span class="ponto ${['executando', 'planejando'].includes(t.estado) ? 'cm-pulso' : ''}" style="background:${t.estado === 'esperando' || t.estado === 'pausada' ? 'var(--espera)' : t.estado === 'revisao' ? 'var(--ok)' : 'var(--acento)'}"></span><span class="mono">${esc(t.id)}</span><span class="cresce"></span><span class="dica">${esc(ROTULO_TAREFA[t.estado] ?? t.estado)} · ${tempo(t.criada)}</span></span>
            <b class="cb-cartao-titulo">${esc(curto(t.titulo, 90))}</b>
            ${etapas(t)}${['executando', 'planejando', 'pausada'].includes(t.estado) ? agora(t) : ''}
          </a>`,
        )
        .join('') +
      treinos
        .map(
          (t) => `<a class="cb-cartao treino" href="#/treino/${esc(t.id)}">
            <span class="cb-cartao-topo"><span class="ponto cm-pulso" style="background:${COR.treinador}"></span><span class="mono">${esc(t.id)}</span><span class="cresce"></span><span class="dica">treino · ${tempo(t.criado)}</span></span>
            <b class="cb-cartao-titulo">${esc(t.equipeNome ?? '')}</b>
            <span class="cb-agora-linha">${esc(ROTULO_TREINO[t.estado] ?? t.estado)}</span>
          </a>`,
        )
        .join('') || '<p class="dica cb-vazio-col">Nenhuma tarefa andando agora. Quando você mandar uma solicitação, ela aparece aqui com as etapas.</p>';
  };

  const nomeAgente = (id) => G.A.nomeNo(id);
  const corAgente = (id) => (ehAnel(id) ? corDe(id) : COR[G.A.tipoNo(id)] ?? '#9d7bff');
  const colunaAgentes = () => {
    const el = $('#cb-agentes');
    if (!el) return;
    const ativos = [...G.A.trabalho.keys()].map((id) => ({ id, f: G.A.fazendo(id) })).filter((x) => x.f);
    const voce = [...(G.A.trabalho.get('voce')?.values() ?? [])].sort((x, y) => y.desde - x.desde).map((i) => ({ f: { ...i, texto: i.oque } }));
    // A IA aparece no cartão da equipe que a chamou ("usando Claude Code · Sonnet"), não num cartão próprio.
    const outros = ativos.filter((x) => x.id !== 'voce' && !x.id.startsWith('ia:')).sort((a, b) => a.f.desde - b.f.desde);
    const n = $('#cb-n-agentes');
    if (n) n.textContent = String(outros.length);
    const ocupados = new Set(outros.map((x) => x.id));
    const parados = S.d.equipes.filter((e) => e.ativa !== false && !ocupados.has(e.id));
    const maisVoce = voce.length > 2 ? `<a class="cb-parado" href="#/" style="align-self:flex-start">+${voce.length - 2} esperando você</a>` : '';
    el.innerHTML = `${voce
      .slice(0, 2)
      .map(
        ({ f }) => `<a class="cb-agente esperando" href="${f.chave.startsWith('T') && !f.chave.startsWith('TR-') ? `#/tarefa/${esc(f.chave)}` : '#/'}">
          <span class="ponto cm-pulso" style="background:#f2d16b"></span>
          <span class="empilha" style="gap:2px;min-width:0"><b>Esperando você</b><span class="cb-agente-txt">${esc(curto(f.texto, 90))}${f.chave !== 'geral' ? ` · ${esc(f.chave)}` : ''}</span></span></a>`,
      )
      .join('')}${maisVoce}${outros
      .map(
        ({ id, f }) => `<div class="cb-agente" style="--cor:${corAgente(id)}">
          <span class="ponto cm-pulso" style="background:${corAgente(id)}"></span>
          <span class="empilha" style="gap:2px;min-width:0">
            <span class="cb-agente-topo"><b>${esc(nomeAgente(id))}</b><span class="dica">${esc(NOME_PAPEL[G.A.tipoNo(id)] ?? '')}</span><span class="cresce"></span><span class="dica mono">${duracao(f.ha)}</span></span>
            <span class="cb-agente-txt">${esc(curto(f.texto, 110))}</span>
            <span class="dica" style="font-size:12px">${f.de ? `pedido de ${esc(nomeAgente(f.de))}` : ''}${f.chave !== 'geral' ? ` · ${esc(f.chave)}` : ''}</span>
          </span></div>`,
      )
      .join('')}${!voce.length && !outros.length ? '<p class="dica cb-vazio-col">Ninguém trabalhando agora. Quando uma equipe ou IA receber trabalho, ela aparece aqui pulsando até responder.</p>' : ''}
      ${parados.length ? `<span class="rotulo" style="margin-top:6px">Em espera</span><div class="cb-parados">${parados.map((e) => `<button type="button" class="cb-parado" data-cb="filtro" data-v="${esc(e.id)}"><span class="ponto" style="background:${corDe(e.id)}"></span>${esc(e.nome)}</button>`).join('')}</div>` : ''}`;
  };

  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const frase = (ev) => `<b>${esc(nomeAgente(ev.de))}</b> ${esc(VERBO[ev.tipo] ?? '→')} <b>${esc(nomeAgente(ev.para))}</b>`;
  const conversas = () => {
    const el = $('#cb-conversas');
    if (!el) return;
    const evs = G.eventos.slice(-12).reverse();
    el.innerHTML = evs.length
      ? evs
          .map(
            (ev, i) => `<a class="cb-msg ${i === 0 && Date.now() - Date.parse(ev.em) < 4000 ? 'nova' : ''}" href="#/comunicacao${ev.tarefaId || ev.treinoId ? `/${esc(ev.tarefaId || ev.treinoId)}` : ''}">
              <span class="ponto" style="background:${COR_TIPO[ev.tipo] ?? '#9d7bff'}"></span>
              <span class="empilha" style="gap:1px;min-width:0"><span class="cb-msg-frase">${frase(ev)}</span><span class="dica">${esc(curto(ev.resumo, 80))}</span></span>
              <span class="dica mono">${hora(ev.em)}</span></a>`,
          )
          .join('')
      : '<p class="dica cb-vazio-col">As mensagens entre o gestor, as equipes e as IAs aparecem aqui.</p>';
  };

  const legenda = (ev) => {
    const el = $('#cb-ticker');
    if (!el || !ev) return;
    el.innerHTML = `<span class="ponto" style="background:${COR_TIPO[ev.tipo] ?? '#9d7bff'}"></span>${frase(ev)}<span class="dica"> · ${esc(curto(ev.resumo, 70))}</span>`;
    el.classList.remove('entra');
    void el.offsetWidth;
    el.classList.add('entra');
  };

  const aoVivo = () => {
    G.A.conferir();
    atividadeNucleo();
    tarefasNucleo();
    colunaTarefas();
    colunaAgentes();
    colunaUso();
  };

  const carregarConversas = async () => {
    try {
      const evs = await api('GET', '/api/comunicacao');
      G.A.limpar();
      G.eventos = evs.slice(-300);
      for (const ev of G.eventos) G.A.aplicar(ev);
    } catch {}
    aoVivo();
    conversas();
  };

  // Mensagem nova entre os agentes (vinda do servidor).
  const comunicacao = (ev) => {
    if (!G.vivo) return;
    G.eventos.push(ev);
    if (G.eventos.length > 300) G.eventos.splice(0, G.eventos.length - 300);
    G.A.aplicar(ev);
    G.nc?.cometa(ondeNoUniverso(ev.para), COR_TIPO[ev.tipo], ondeNoUniverso(ev.de));
    aoVivo();
    conversas();
    legenda(ev);
  };
  // Notas que acabaram de ser usadas (no pedido de uma equipe, numa busca ou leitura de um agente).
  const usar = (notas, info = {}) => {
    const agora = Date.now();
    const validas = notas.filter((id) => G.nos.some((n) => n.id === id));
    if (!validas.length) return;
    for (const id of validas) G.usos.set(id, { em: agora, ...info });
    G.nc?.usar?.(validas);
    colunaUso();
  };
  const uso = (e) => {
    if (!G.vivo) return;
    usar(e.notas ?? [], { equipe: e.equipe ?? null, agente: e.agente ?? null, como: e.como, tarefaId: e.tarefaId ?? null });
  };
  const terminal = (equipe) => {
    G.A.terminal(equipe);
    // A IA abriu um arquivo do cérebro (ex.: "Read(…/20-areas/x/y.md)"): acende a nota também.
    const ultima = (S.d.terminais?.[equipe] ?? []).at(-1)?.texto ?? '';
    const achados = [...ultima.matchAll(/((?:10-tarefas|20-areas|40-skills)\/[^\s)'"`]+?\.md)/g)].map((m) => m[1]);
    if (achados.length) usar(achados, { equipe, como: 'leitura' });
  };
  const COMO = { pedido: 'no pedido', busca: 'buscou', leitura: 'leu' };
  const colunaUso = () => {
    const el = $('#cb-uso');
    if (!el) return;
    const agora = Date.now();
    for (const [id, u] of G.usos) if (agora - u.em > 4 * 60_000) G.usos.delete(id);
    const lista = [...G.usos].sort((a, b) => b[1].em - a[1].em).slice(0, 8);
    const n = $('#cb-n-uso');
    if (n) n.textContent = String(G.usos.size);
    el.innerHTML = lista.length
      ? lista
          .map(([id, u]) => {
            const nota = G.nos.find((x) => x.id === id);
            const k = nota ? chaveEquipe(nota) : null;
            const quem = u.equipe ? nomeAgente(u.equipe) : u.agente ?? '';
            return `<button type="button" class="cb-uso ${agora - u.em < 30_000 ? 'quente' : ''}" data-cb="ir" data-id="${esc(id)}">
              <span class="ponto ${agora - u.em < 30_000 ? 'cm-pulso' : ''}" style="background:${k ? corDe(k) : '#e6deff'}"></span>
              <span class="empilha" style="gap:1px;min-width:0"><span class="cb-uso-tit">${esc(nota?.titulo ?? id)}</span><span class="dica">${esc([quem, COMO[u.como] ?? u.como].filter(Boolean).join(' · '))} · ${quando(u.em)}</span></span></button>`;
          })
          .join('')
      : '<p class="dica cb-vazio-col">Quando uma equipe consultar o cérebro, a nota acende aqui e no universo.</p>';
  };
  // Clique no buraco negro: a gaveta mostra o conhecimento base.
  const abrirBase = () => {
    const caixa = $('#cb-lado');
    if (!caixa) return;
    const notas = G.nos.filter(ehBase);
    gaveta(true);
    caixa.innerHTML = `<div class="empilha" style="gap:12px">
      <button type="button" class="link" data-cb="fechar-gaveta" style="align-self:flex-start">← Visão geral</button>
      <h2 class="titulo" style="font-size:28px">Conhecimento base</h2>
      <p class="dica" style="font-size:14px;line-height:1.5">O centro do cérebro: o leia-me, o mapa das áreas e as skills, ou seja, como o cérebro funciona e como cada equipe busca e registra conhecimento. Toda equipe passa por aqui antes de trabalhar.</p>
      ${notas.map((x) => `<button type="button" class="link cb-item" data-cb="ir" data-id="${esc(x.id)}"><span class="ponto" style="background:#e6deff"></span><span class="cresce">${esc(x.titulo)}</span><span class="dica">${G.usos.has(x.id) ? 'em uso' : quando(x.atualizado)}</span></button>`).join('') || '<p class="dica">Vazio por enquanto.</p>'}
    </div>`;
  };
  const atualizar = () => {
    if (G.vivo) aoVivo();
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
    if (G.modo === 'nucleo') return;
    if (G.modo === '3d') {
      const f = doFiltro();
      return G.g3?.zoomToFit(600, 50, (o) => !f || f.has(o.id));
    }
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
    G.nc?.selecionar(id);
    const n = G.nos.find((x) => x.id === id);
    // Clicar numa equipe = filtrar por ela.
    if (n?.tipo === 'equipe') return filtrar(n.equipe ?? n.area);
    lateral();
    if (!n || n.tipo === 'equipe') return;
    const caixa = $('#cb-nota');
    if (!caixa) return;
    caixa.innerHTML = '<p class="dica">Abrindo a nota…</p>';
    try {
      const nota = await api('GET', `/api/cerebro/nota?caminho=${encodeURIComponent(n.id)}&tela=1`);
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
    G.nc?.foco(f === 'tudo' ? null : f, { voar: !G.semVoo });
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
    const atual = G.filtro !== 'tudo' ? equipesNoGrafo().find((n) => (n.equipe ?? n.area) === G.filtro) : null;
    const botao = $('#cb-area-btn');
    if (botao)
      botao.innerHTML = atual
        ? `<span class="ponto" style="background:${corDe(G.filtro)}"></span>${esc(atual.titulo)}<span class="cb-area-x" data-cb="filtro" data-v="tudo" role="button" aria-label="Ver todas as áreas">×</span>`
        : 'Selecionar área';
    caixa.innerHTML =
      `<button type="button" class="pill" data-cb="filtro" data-v="tudo" aria-pressed="${G.filtro === 'tudo'}">Tudo <span class="dica">${total.length}</span></button>` +
      equipesNoGrafo()
        .map((n) => {
          const k = n.equipe ?? n.area;
          return `<button type="button" class="pill" data-cb="filtro" data-v="${esc(k)}" data-nome="${esc(n.titulo.toLowerCase())}" aria-pressed="${G.filtro === k}"><span class="ponto" style="background:${corDe(k)}"></span>${esc(n.titulo)} <span class="dica">${n.notas}</span></button>`;
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

  // Com a gaveta aberta, o universo encolhe para a esquerda (a galáxia não fica escondida atrás dela).
  const gaveta = (aberta) => {
    const c = $('#cb-lado');
    if (c) c.hidden = !aberta;
    document.querySelector('.cb-tres')?.classList.toggle('com-gaveta', !!aberta);
  };
  // Painel da direita: a equipe filtrada (o que ela está formando) ou a nota escolhida.
  const lateral = () => {
    const caixa = $('#cb-lado');
    if (!caixa) return;
    gaveta(true);
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
      const notas = G.nos.filter((x) => x.tipo === 'conhecimento' && (x.camada ?? 'conhecimento') === 'conhecimento' && chaveEquipe(x) === k).sort((a, b) => b.atualizado - a.atualizado);
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
    // Visão geral: a gaveta fecha e o centro fica livre.
    gaveta(false);
    caixa.innerHTML = '';
  };

  // Coluna da esquerda, embaixo: o que o cérebro aprendeu por último.
  const recentes = () => {
    const el = $('#cb-recentes');
    if (!el) return;
    const lista = G.nos.filter((x) => x.tipo === 'conhecimento').sort((a, b) => b.atualizado - a.atualizado).slice(0, 8);
    el.innerHTML = lista.length
      ? lista.map((x) => `<button type="button" class="link cb-item" data-cb="ir" data-id="${esc(x.id)}"><span class="ponto ${x.estado === 'validado' ? '' : 'vazado'}" style="--cor:${corNo(x)};background:${x.estado === 'validado' ? corNo(x) : 'transparent'}"></span><span class="cresce">${esc(x.titulo)}</span><span class="dica">${quando(x.atualizado)}</span></button>`).join('')
      : '<p class="dica cb-vazio-col">Ainda nada aprendido.</p>';
  };

  // ---------------------------------------------------------------- tela

  // A tela ocupa exatamente o que sobra da janela abaixo do topo (que pode quebrar em duas linhas).
  const encaixar = () => {
    const el = document.querySelector('.cerebro');
    if (el) el.style.height = `${Math.max(520, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 8)}px`;
  };

  const montar = () => {
    $('#app').innerHTML = `<div class="cerebro cb-vivo">
      <div class="cb-topo">
        <div class="empilha" style="gap:4px">
          <h1 class="titulo" style="font-size:34px">Cérebro</h1>
          <span class="dica" id="cb-numeros"></span>
        </div>
        <div class="cresce"></div>
        <input class="campo" id="cb-busca" type="search" placeholder="Procurar nota…" aria-label="Procurar nota" style="width:220px;height:38px">
        <div class="cb-areas">
          <button type="button" class="btn contorno pequeno cb-area-btn" id="cb-area-btn" data-cb="areas" aria-haspopup="true" aria-expanded="false">Selecionar área</button>
          <div class="cb-areas-pop" id="cb-areas-pop" hidden>
            <input class="campo" id="cb-areas-busca" type="search" placeholder="Filtrar áreas…" aria-label="Filtrar áreas" style="height:34px">
            <div class="cb-filtros" id="cb-filtros" role="group" aria-label="Filtrar por área"></div>
          </div>
        </div>
        <label class="check" data-so-grafo ${G.modo === 'nucleo' ? 'hidden' : ''} data-dica="Mostra as tarefas e as equipes que trabalharam em cada uma."><input type="checkbox" id="cb-tarefas" ${G.tarefas ? 'checked' : ''}>Tarefas</label>
        ${botoesModo(G.modo, 'data-cb-modo', MODOS)}
        <button type="button" class="btn contorno pequeno cb-cheia" data-cb="cheia" aria-label="Tela cheia" data-dica="Tela cheia (F11). Esc sai.">⛶</button>
        <button type="button" class="btn contorno pequeno" data-cb="ajustar" data-so-grafo ${G.modo === 'nucleo' ? 'hidden' : ''}>Enquadrar</button>
      </div>
      <div class="cb-tres">
        <aside class="cb-col cb-esq" aria-label="Tarefas em andamento">
          <div class="cb-col-cab"><span class="rotulo">Tarefas em andamento</span><span class="cb-contador" id="cb-n-tarefas">0</span></div>
          <div id="cb-tarefas-vivo" class="cb-col-lista" aria-live="polite"></div>
          <div class="cb-col-cab"><span class="rotulo">Aprendido por último</span></div>
          <div id="cb-recentes" class="cb-col-lista cb-recentes"></div>
          <details class="cb-como">
            <summary class="dica">Como ler</summary>
            <ul class="cb-legenda">
              <li><span class="ponto" style="background:var(--acento)"></span>Nota validada: conhecimento que você aprovou.</li>
              <li><span class="ponto vazado" style="--cor:var(--acento)"></span>Rascunho: a equipe aprendeu, falta você aprovar.</li>
              <li><span class="ponto cm-pulso" style="background:var(--acento)"></span>Pulsando: trabalhando agora. Para quando responde.</li>
              <li><span class="ponto" style="background:#e6deff"></span>No universo, o buraco negro é o conhecimento base (como o cérebro funciona e como obter conhecimento). Cada galáxia é uma equipe: quanto mais ela aprende, mais formada fica.</li>
              <li><span class="ponto cm-pulso" style="background:#f4f0ff"></span>A galáxia de quem está trabalhando acende e gira mais rápido. As notas em uso ganham um anel pulsando e mandam um feixe de luz para o núcleo da galáxia. Cada mensagem voa como um cometa.</li>
              <li><span class="ponto" style="background:#cdbdff"></span>Chegue perto de uma galáxia para ver as ligações entre as notas, com pulsos correndo por elas.</li>
            </ul>
          </details>
        </aside>
        <div class="cb-area">
          <canvas id="cb-tela" aria-label="Grafo do cérebro: notas e equipes" role="img" ${G.modo === '2d' ? '' : 'hidden'}></canvas>
          <canvas id="cb-nucleo" class="cb-nucleo" aria-label="Núcleo do cérebro: o conhecimento de cada equipe girando em volta" role="img" hidden></canvas>
          <div id="cb-universo" class="cb-universo" role="img" aria-label="Universo do cérebro: o buraco negro do conhecimento base e uma galáxia por equipe" hidden></div>
          <div class="cb-controles" id="cb-controles" hidden>
            <button type="button" class="btn contorno pequeno" data-cb="geral" data-dica="Volta para ver o universo inteiro (Esc)">Visão geral</button>
            <button type="button" class="btn contorno pequeno" data-cb="perto" aria-label="Aproximar">+</button>
            <button type="button" class="btn contorno pequeno" data-cb="longe" aria-label="Afastar">−</button>
          </div>
          <div id="cb-3d" class="cm-area" role="img" aria-label="Grafo 3D do cérebro" ${G.modo === '3d' ? '' : 'hidden'}></div>
          <div id="cb-rotulos" class="cm-rotulos" aria-hidden="true"></div>
          <div id="cb-flutua" class="cb-flutua" hidden></div>
          <div id="cb-ticker" class="cb-ticker" aria-live="polite"></div>
          <div class="cm-dica dica" id="cb-dica">${DICA[G.modo]}</div>
          <div class="cb-vazio" id="cb-vazio" hidden>
            <h2 class="titulo" style="font-size:28px">O cérebro ainda está vazio</h2>
            <p class="dica" style="font-size:15px;line-height:1.55">Cada tarefa vira uma nota, e cada coisa que uma equipe aprende vira um ponto ligado a ela. Mande uma solicitação e volte aqui para ver o conhecimento se formar.</p>
          </div>
        </div>
        <aside class="cb-lado cb-gaveta" id="cb-lado" aria-live="polite" hidden></aside>
        <aside class="cb-col cb-dir" aria-label="Agentes em funcionamento">
          <div class="cb-col-cab"><span class="rotulo">Agentes trabalhando</span><span class="cb-contador" id="cb-n-agentes">0</span></div>
          <div id="cb-agentes" class="cb-col-lista" aria-live="polite"></div>
          <div class="cb-col-cab"><span class="rotulo">Conhecimento em uso</span><span class="cb-contador" id="cb-n-uso">0</span></div>
          <div id="cb-uso" class="cb-col-lista"></div>
          <div class="cb-col-cab"><span class="rotulo">Conversas</span><a class="dica" href="#/comunicacao" style="font-size:12px">ver tudo</a></div>
          <div id="cb-conversas" class="cb-col-lista cb-conversas"></div>
        </aside>
      </div>
    </div>`;
    // Tela imersiva: o universo ocupa a janela inteira e o resto flutua por cima.
    document.body.classList.add('cb-imersivo');
    document.addEventListener('pointerdown', foraDasAreas);
    document.addEventListener('keydown', teclaAreas);
    $('#cb-areas-busca').addEventListener('input', (ev) => filtrarAreas(ev.target.value));
    ligarEventos();
    encaixar();
    window.addEventListener('resize', encaixar);
    window.addEventListener('resize', encaixar3D);
    $('#cb-busca').addEventListener('input', (ev) => {
      G.busca = ev.target.value;
      dadosNucleo();
    });
    $('#cb-tarefas').addEventListener('change', (ev) => {
      G.tarefas = ev.target.checked;
      gravarLocal('orq.cerebro.tarefas', G.tarefas ? '1' : '0');
      G.calor = Math.max(G.calor, 0.4);
      dados3D();
    });
    $('#app').addEventListener('click', clique);
    G.vivo = true;
    G.vista = { x: tela().clientWidth / 2, y: tela().clientHeight / 2, z: 1 };
    cabecalho();
    lateral();
    for (const eq of Object.keys(S.d.terminais ?? {})) G.A.terminal(eq);
    carregar();
    laco();
    if (G.modo === '3d') montar3D();
    if (G.modo === 'nucleo') montarNucleo();
    recentes();
    carregarConversas();
    // Relógio do "ao vivo": tempo de cada trabalho e quem já parou.
    G.relogio = setInterval(aoVivo, 1000);
  };

  const clique = async (ev) => {
    const m = ev.target.closest('[data-cb-modo]');
    if (m) return trocarModo(m.dataset.cbModo);
    const b = ev.target.closest('[data-cb]');
    if (!b) return;
    const acao = b.dataset.cb;
    if (acao === 'areas') {
      ev.stopPropagation();
      return abrirAreas($('#cb-areas-pop').hidden);
    }
    if (acao === 'filtro') {
      ev.stopPropagation();
      abrirAreas(false);
      return filtrar(b.dataset.v);
    }
    if (acao === 'ajustar') return ajustar();
    if (acao === 'voltar') return selecionar(null);
    if (acao === 'ir') {
      G.nc?.irPara?.(b.dataset.id);
      return selecionar(b.dataset.id);
    }
    if (acao === 'fechar-gaveta') {
      gaveta(false);
      return G.nc?.visaoGeral?.();
    }
    if (acao === 'cheia') {
      // No app do computador o F11 também funciona; aqui vale no navegador e no app.
      if (document.fullscreenElement) return document.exitFullscreen?.();
      return document.documentElement.requestFullscreen?.().catch(() => toast('Use F11 para tela cheia.'));
    }
    if (acao === 'geral') return filtrar('tudo');
    if (acao === 'perto') return G.nc?.aproximar?.(0.7);
    if (acao === 'longe') return G.nc?.aproximar?.(1.4);
    if (acao === 'validar') {
      await api('POST', '/api/cerebro/validar', { caminho: b.dataset.id });
      toast('Nota validada.');
      return carregar();
    }
  };

  // "Selecionar área": as áreas (equipes) num painel com busca, no lugar da fileira fixa de filtros.
  const abrirAreas = (abrir) => {
    const pop = $('#cb-areas-pop');
    const btn = $('#cb-area-btn');
    if (!pop) return;
    pop.hidden = !abrir;
    btn?.setAttribute('aria-expanded', String(!!abrir));
    if (abrir) {
      const campo = $('#cb-areas-busca');
      campo.value = '';
      filtrarAreas('');
      campo.focus();
    }
  };
  const filtrarAreas = (t) => {
    const q = t.trim().toLowerCase();
    for (const b of document.querySelectorAll('#cb-filtros [data-nome]')) b.hidden = !!q && !b.dataset.nome.includes(q);
  };
  const foraDasAreas = (ev) => {
    if (!ev.target.closest?.('.cb-areas')) abrirAreas(false);
  };
  const teclaAreas = (ev) => {
    if (ev.key === 'Escape') abrirAreas(false);
  };

  const desmontar = () => {
    document.body.classList.remove('cb-imersivo');
    document.removeEventListener('pointerdown', foraDasAreas);
    document.removeEventListener('keydown', teclaAreas);
    window.removeEventListener('resize', encaixar);
    window.removeEventListener('resize', encaixar3D);
    desmontar3D();
    desmontarNucleo();
    clearInterval(G.relogio);
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

  return { montar, desmontar, atualizar, mudou, comunicacao, terminal, uso };
};
