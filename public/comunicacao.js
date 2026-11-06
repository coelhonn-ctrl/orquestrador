// Tela "Comunicação": um grafo ao vivo, em 2D ou 3D, de quem está falando com quem.
// Você → gestor → supervisores (equipes) → IAs, o avaliador conferindo, o treinador ensinando as cópias
// e os agentes da tela livre trocando mensagens. Cada mensagem é uma partícula que corre pela ligação.
// Quem recebeu um trabalho e ainda não respondeu fica pulsando de leve; ao responder, para.
import { carregar3D, lerModo, gravarModo, botoesModo } from '/lib3d.js';
import { criarGrafo2D } from '/grafo2d.js';
import { COR, COR_TIPO, NOME_TIPO, VERBO, NOME_PAPEL, criarAtividade, duracao, curto } from '/atividade.js';

export const criarTelaComunicacao = ({ S, $, esc, api, toast }) => {
  const C = {
    filtro: '',
    eventos: [],
    nos: new Map(),
    links: new Map(),
    grafo: null,
    g2: null,
    modo: lerModo('orq.cm.modo', '3d'),
    vivo: false,
    pausado: false,
    sel: null,
    hover: null,
    ativos: new Set(), // ligações com trabalho em andamento
  };

  const A = criarAtividade(S);
  const { tipoNo, nomeNo, trabalhando, fazendo } = A;
  const nomeCurto = (n) => (n.tipo === 'copia' ? (n.id.split(':')[1].startsWith('IA-') ? `prova ${nomeNo(`ia:${n.id.split(':')[1].slice(3)}`)}` : n.id.split(':')[1]) : n.nome);
  const tamanho = (t) => ({ voce: 5, gestor: 8, avaliador: 5, treinador: 5, equipe: 4, ia: 3, copia: 1.6, agente: 3 })[t] ?? 3;
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const passaFiltro = (ev) => !C.filtro || ev.tarefaId === C.filtro || ev.treinoId === C.filtro;

  // ------------------------------------------------------------ quem está trabalhando

  const esperandoVoce = (id) => id === 'voce' && trabalhando(id);
  const aplicarTrabalho = A.aplicar;
  const conferirTrabalho = () => {
    C.ativos = A.conferir();
    C.g2?.ativos(C.ativos);
    C.grafo?.linkDirectionalParticles(C.grafo.linkDirectionalParticles());
  };

  // ------------------------------------------------------------ dados do grafo

  // A IA não vira um ponto próprio: ela trabalha "dentro" de quem a chamou (a equipe, o avaliador, o treinador).
  // A conversa equipe ↔ IA aparece no rótulo da equipe ("usando Claude Code · Sonnet"), não como outra ligação.
  const ponta = (id, outro) => (id.startsWith('ia:') && !outro.startsWith('ia:') ? outro : id);
  const incluir = (ev) => {
    ev = { ...ev, de: ponta(ev.de, ev.para), para: ponta(ev.para, ev.de) };
    let novo = false;
    if (ev.de === ev.para) {
      if (!C.nos.has(ev.de)) {
        const tipo = tipoNo(ev.de);
        C.nos.set(ev.de, { id: ev.de, tipo, nome: nomeNo(ev.de), val: tamanho(tipo), cor: COR[tipo], msgs: 0 });
        novo = true;
      }
      return { l: null, novo };
    }
    for (const id of [ev.de, ev.para]) {
      if (C.nos.has(id)) continue;
      const tipo = tipoNo(id);
      C.nos.set(id, { id, tipo, nome: nomeNo(id), val: tamanho(tipo), cor: COR[tipo], msgs: 0 });
      novo = true;
    }
    C.nos.get(ev.de).msgs += 1;
    const chave = `${ev.de}>${ev.para}`;
    let l = C.links.get(chave);
    if (!l) {
      l = { id: chave, source: ev.de, target: ev.para, n: 0, tipo: ev.tipo };
      C.links.set(chave, l);
      novo = true;
    }
    l.n += 1;
    l.tipo = ev.tipo;
    return { l, novo };
  };

  const dados = () => ({ nodes: [...C.nos.values()], links: [...C.links.values()] });
  const apagado = (n) => !!C.sel && C.sel !== n.id;
  const pulso = (n) => (trabalhando(n.id) ? 1 + 0.16 * (0.5 - 0.5 * Math.cos((performance.now() / 1700) * Math.PI * 2)) : 1);
  const idDe = (x) => (x && typeof x === 'object' ? x.id : x);
  const distancia = (l) => (String(idDe(l.target)).includes(':') && !String(idDe(l.target)).startsWith('ia:') ? 45 : 80);

  // ------------------------------------------------------------ desenho (2D ou 3D)

  const montar3D = async (area) => {
    let ForceGraph3D;
    try {
      ForceGraph3D = await carregar3D();
    } catch (e) {
      area.innerHTML = `<p class="dica" style="padding:24px">Não foi possível abrir o grafo 3D (${esc(e.message)}). Use a visualização 2D.</p>`;
      return;
    }
    if (!C.vivo || C.modo !== '3d' || !$('#cm-area')) return;
    const g = ForceGraph3D({ controlType: 'orbit' })(area)
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeId('id')
      .nodeVal('val')
      .nodeColor((n) => (apagado(n) ? `${n.cor}55` : n.cor))
      .nodeOpacity(0.95)
      .nodeResolution(16)
      .nodeLabel(() => '')
      .linkColor((l) => `${COR_TIPO[l.tipo] ?? '#9d7bff'}${C.ativos.has(l.id) ? 'cc' : '66'}`)
      .linkWidth((l) => Math.min(3, 0.4 + Math.log2(1 + l.n) * 0.5) * (C.ativos.has(l.id) ? 1.6 : 1))
      .linkOpacity(0.5)
      .linkCurvature(0.18)
      .linkDirectionalArrowLength(3)
      .linkDirectionalArrowRelPos(0.92)
      .linkDirectionalArrowColor((l) => COR_TIPO[l.tipo] ?? '#9d7bff')
      .linkDirectionalParticles((l) => (C.ativos.has(l.id) ? 2 : 0))
      .linkDirectionalParticleWidth(2.6)
      .linkDirectionalParticleSpeed((l) => (C.ativos.has(l.id) ? 0.005 : 0.012))
      .linkDirectionalParticleColor((l) => COR_TIPO[l.tipo] ?? '#e07bff')
      .onNodeClick((n) => selecionar(n.id))
      .onNodeHover((n) => (C.hover = n?.id ?? null))
      .onBackgroundClick(() => selecionar(null))
      .graphData(dados());
    g.d3Force('charge').strength(-260);
    g.d3Force('link').distance(distancia);
    C.grafo = g;
    encaixar();
    setTimeout(() => C.vivo && C.grafo === g && g.zoomToFit(600, 60), 900);
  };

  const montar2D = (area) => {
    C.g2 = criarGrafo2D(area, {
      cor: (n) => n.cor,
      raio: (n) => 3 + Math.sqrt(n.val) * 2.6,
      forma: (n) => (n.tipo === 'ia' ? 'quadrado' : 'circulo'),
      apagado,
      escala: pulso,
      anel: (n) => (trabalhando(n.id) ? (esperandoVoce(n.id) ? '#f2d16b' : n.cor) : null),
      corLigacao: (l) => `${COR_TIPO[l.tipo] ?? '#9d7bff'}${C.ativos.has(l.id) ? 'aa' : '55'}`,
      corParticula: (l) => COR_TIPO[l.tipo] ?? '#e07bff',
      larguraLigacao: (l) => Math.min(3, 0.6 + Math.log2(1 + l.n) * 0.5),
      distancia: (l) => distancia(l) * 1.4,
      aoClicar: (n) => selecionar(n?.id ?? null),
      aoPassar: (n) => (C.hover = n?.id ?? null),
    });
    C.g2.dados(dados());
    C.g2.ativos(C.ativos);
    C.g2.assentar(160);
    C.g2.enquadrar();
  };

  const desmontarGrafo = () => {
    try {
      C.grafo?.pauseAnimation();
      C.grafo?._destructor?.();
    } catch {}
    C.grafo = null;
    C.g2?.destruir();
    C.g2 = null;
    const area = $('#cm-area');
    if (area) area.innerHTML = '';
    $('#cm-rotulos')?.replaceChildren();
  };

  const montarGrafo = async () => {
    desmontarGrafo();
    const area = $('#cm-area');
    if (!area) return;
    if (C.modo === '3d') await montar3D(area);
    else montar2D(area);
  };

  const refrescarDados = () => {
    C.grafo?.graphData(dados());
    C.g2?.dados(dados());
  };

  // Nomes (e o que cada um está fazendo) por cima dos pontos, nos dois modos.
  const rotulos = () => {
    if (!C.vivo) return;
    const camada = $('#cm-rotulos');
    if (camada && (C.grafo || C.g2)) {
      const els = new Map([...camada.children].map((el) => [el.dataset.id, el]));
      const vistos = new Set();
      for (const n of C.nos.values()) {
        if (!Number.isFinite(n.x)) continue;
        // Pulso no 3D: escala a esfera do próprio nó.
        if (C.grafo && n.__threeObj) {
          const s = pulso(n);
          n.__threeObj.scale.set(s, s, s);
        }
        const { x, y } = C.grafo ? C.grafo.graph2ScreenCoords(n.x, n.y, n.z ?? 0) : C.g2.paraTela(n);
        let el = els.get(n.id);
        if (!el) {
          el = document.createElement('span');
          el.className = `cm-nome ${n.tipo}`;
          el.dataset.id = n.id;
          el.innerHTML = `<span class="cm-n"></span><span class="cm-faz"></span>`;
          const tag = { ia: 'IA', equipe: 'equipe', agente: 'agente', copia: 'cópia' }[n.tipo];
          if (tag) el.firstChild.dataset.tag = tag;
          camada.appendChild(el);
        }
        const f = fazendo(n.id);
        const nome = nomeCurto(n);
        if (el.firstChild.textContent !== nome) el.firstChild.textContent = nome;
        const faz = f ? `${esperandoVoce(n.id) ? 'esperando você: ' : ''}${curto(f.texto, 58)} · ${duracao(f.ha)}` : '';
        if (el.lastChild.textContent !== faz) el.lastChild.textContent = faz;
        el.classList.toggle('trabalhando', !!f && !esperandoVoce(n.id));
        el.classList.toggle('esperando', esperandoVoce(n.id));
        el.classList.toggle('apagado', apagado(n));
        el.classList.toggle('foco', C.hover === n.id);
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        vistos.add(n.id);
      }
      for (const [id, el] of els) if (!vistos.has(id)) el.remove();
    }
    C.quadro = requestAnimationFrame(rotulos);
  };

  const encaixar = () => {
    const area = $('#cm-area');
    if (C.grafo && area) C.grafo.width(area.clientWidth).height(area.clientHeight);
  };

  // ------------------------------------------------------------ painéis

  const legenda = () =>
    `<ul class="cb-legenda">${[
      ['voce', 'Você'],
      ['gestor', 'Gestor'],
      ['equipe', 'Equipes: quem recebe a etapa e cuida dela'],
      ['avaliador', 'Avaliador'],
      ['treinador', 'Treinador'],
      ['copia', 'Cópias em treino'],
      ['agente', 'Agentes da tela livre'],
    ]
      .map(([t, n]) => `<li><span class="ponto" style="background:${COR[t]}${t === 'ia' ? ';border-radius:3px' : ''}"></span>${n}</li>`)
      .join('')}
      <li><span class="ponto cm-pulso" style="background:var(--acento)"></span>Pulsando: trabalhando agora (para quando responde). Embaixo do nome: a IA e o modelo que a equipe está usando.</li>
      <li><span class="ponto cm-pulso" style="background:#f2d16b"></span>Você pulsando: tem algo esperando você</li></ul>`;

  // "Agora": quem está trabalhando, no quê, há quanto tempo.
  const agora = () => {
    const el = $('#cm-agora');
    if (!el) return;
    const itens = [...A.trabalho.keys()]
      .filter((id) => C.nos.has(id))
      .map((id) => ({ id, f: fazendo(id) }))
      .filter((x) => x.f)
      .sort((a, b) => (a.id === 'voce' ? -1 : b.id === 'voce' ? 1 : a.f.desde - b.f.desde));
    el.innerHTML = itens.length
      ? itens
          .map(
            ({ id, f }) => `<button type="button" class="cm-agora-item ${id === 'voce' ? 'esperando' : ''}" data-cm="sel" data-id="${esc(id)}">
              <span class="ponto cm-pulso" style="background:${id === 'voce' ? '#f2d16b' : COR[tipoNo(id)]}"></span>
              <span class="empilha" style="gap:2px;min-width:0"><span><b>${esc(nomeNo(id))}</b>${tipoNo(id) === 'equipe' ? ' <span class="dica">· equipe</span>' : ''}</span><span class="dica">${id === 'voce' ? 'esperando você' : `trabalhando há ${duracao(f.ha)}${f.de ? ` · pedido de ${esc(nomeNo(f.de))}` : ''}`}${f.chave !== 'geral' ? ` · ${esc(f.chave)}` : ''}</span><span class="cm-agora-txt">${esc(curto(f.texto, 140))}</span></span>
            </button>`,
          )
          .join('')
      : '<p class="dica" style="margin:0">Ninguém trabalhando agora.</p>';
  };

  const linha = (ev) => `<button type="button" class="cm-ev" data-cm="ev" data-id="${ev.id}">
      <span class="cm-ev-topo"><span class="ponto" style="background:${COR_TIPO[ev.tipo] ?? '#9d7bff'}"></span><span class="cm-frase"><b>${esc(nomeNo(ev.de))}</b> ${esc(VERBO[ev.tipo] ?? '→')} <b>${esc(nomeNo(ev.para))}</b></span><span class="cresce"></span><span class="dica">${hora(ev.em)}</span></span>
      <span class="cm-ev-txt"><span class="cm-tipo">${esc(NOME_TIPO[ev.tipo] ?? ev.tipo)}${ev.ia ? ` · ${esc(ev.ia)}` : ''}${ev.tarefaId || ev.treinoId ? ` · ${esc(ev.tarefaId || ev.treinoId)}` : ''}</span> ${esc(ev.resumo)}</span>
    </button>`;

  const lista = () => {
    const el = $('#cm-lista');
    if (!el) return;
    const evs = C.eventos.filter((e) => !C.sel || e.de === C.sel || e.para === C.sel).slice(-150).reverse();
    el.innerHTML = evs.length ? evs.map(linha).join('') : `<p class="dica">${C.sel ? 'Nada deste participante ainda.' : 'Nenhuma mensagem ainda. Mande uma solicitação ou comece um treino: a conversa aparece aqui na hora.'}</p>`;
    const sel = $('#cm-sel');
    if (sel) sel.innerHTML = C.sel ? `Mostrando só <b>${esc(nomeNo(C.sel))}</b> <span class="dica">(${esc(NOME_PAPEL[tipoNo(C.sel)] ?? '')})</span> · <button type="button" class="btn texto pequeno" data-cm="limpar-sel">ver todos</button>` : '';
    const n = $('#cm-numeros');
    if (n) n.innerHTML = `<span><b>${C.eventos.length}</b> mensagens</span><span><b>${C.nos.size}</b> participantes</span><span><b>${[...A.trabalho.keys()].filter((id) => id !== 'voce').length}</b> trabalhando agora</span>`;
    const vazio = $('#cm-vazio');
    if (vazio) vazio.hidden = C.eventos.length > 0;
    agora();
  };

  const selecionar = (id) => {
    C.sel = id && C.sel !== id ? id : null;
    C.grafo?.nodeColor(C.grafo.nodeColor());
    lista();
  };

  const opcoesFiltro = () => {
    const tarefas = [...S.d.tarefas].sort((a, b) => (a.criada < b.criada ? 1 : -1)).slice(0, 30);
    const treinos = [...(S.d.treinos ?? [])].sort((a, b) => (a.criado < b.criado ? 1 : -1)).slice(0, 15);
    const op = (v, t) => `<option value="${esc(v)}" ${C.filtro === v ? 'selected' : ''}>${esc(t)}</option>`;
    return `${op('', 'Tudo, ao vivo')}${tarefas.length ? `<optgroup label="Solicitações">${tarefas.map((t) => op(t.id, `${t.id} · ${t.titulo}`.slice(0, 70))).join('')}</optgroup>` : ''}${treinos.length ? `<optgroup label="Treinos">${treinos.map((t) => op(t.id, `${t.id} · ${t.equipeNome}`)).join('')}</optgroup>` : ''}`;
  };

  const detalhe = (id) => {
    const ev = C.eventos.find((e) => String(e.id) === String(id));
    const el = $('#cm-detalhe');
    if (!ev || !el) return;
    el.hidden = false;
    el.innerHTML = `<div class="linha" style="gap:8px;align-items:center"><span class="rotulo">${esc(NOME_TIPO[ev.tipo] ?? ev.tipo)} · ${hora(ev.em)}</span><span class="cresce"></span><button type="button" class="btn texto pequeno" data-cm="fechar">Fechar</button></div>
      <p style="margin:6px 0"><b>${esc(nomeNo(ev.de))}</b> ${esc(VERBO[ev.tipo] ?? '→')} <b>${esc(nomeNo(ev.para))}</b>${ev.ia ? ` <span class="dica">(${esc(ev.ia)})</span>` : ''}</p>
      ${ev.tarefaId ? `<a class="dica" href="#/tarefa/${esc(ev.tarefaId)}">Abrir ${esc(ev.tarefaId)}</a>` : ''}${ev.treinoId ? `<a class="dica" href="#/treino/${esc(ev.treinoId)}">Abrir treino ${esc(ev.treinoId)}</a>` : ''}
      <pre class="cm-texto">${esc(ev.texto || ev.resumo)}</pre>`;
  };

  // ------------------------------------------------------------ dados do servidor

  const carregar = async () => {
    C.eventos = [];
    C.nos.clear();
    C.links.clear();
    A.limpar();
    $('#cm-rotulos')?.replaceChildren();
    try {
      const q = C.filtro ? (C.filtro.startsWith('TR-') ? `?treinoId=${encodeURIComponent(C.filtro)}` : `?tarefaId=${encodeURIComponent(C.filtro)}`) : '';
      const evs = await api('GET', `/api/comunicacao${q}`);
      for (const ev of evs) {
        C.eventos.push(ev);
        incluir(ev);
        aplicarTrabalho(ev);
      }
    } catch (e) {
      toast(`Não carregou a comunicação: ${e.message}`);
    }
    conferirTrabalho();
    refrescarDados();
    if (C.grafo) setTimeout(() => C.vivo && C.grafo?.zoomToFit(600, 60), 700);
    if (C.g2) {
      C.g2.assentar(200);
      C.g2.enquadrar();
    }
    lista();
  };

  // Evento novo vindo do servidor.
  const evento = (ev) => {
    if (!C.vivo || !passaFiltro(ev)) return;
    C.eventos.push(ev);
    if (C.eventos.length > 2000) C.eventos.splice(0, C.eventos.length - 2000);
    const { l, novo } = incluir(ev);
    aplicarTrabalho(ev);
    conferirTrabalho();
    if (C.pausado) return;
    if (novo) refrescarDados();
    // A partícula corre depois de o grafo assumir a ligação nova.
    setTimeout(() => {
      if (!C.vivo) return;
      if (!l) return;
      C.grafo?.emitParticle(l);
      C.g2?.emitir(l);
    }, novo && C.grafo ? 120 : 0);
    clearTimeout(C.espera);
    C.espera = setTimeout(lista, 150);
  };

  // Saída do terminal de uma equipe: vira o "fazendo agora" dela e da IA que está trabalhando para ela.
  const terminal = A.terminal;

  const clique = (e) => {
    const b = e.target.closest('[data-cm],[data-cm-modo]');
    if (!b) return;
    if (b.dataset.cmModo) return trocarModo(b.dataset.cmModo);
    const a = b.dataset.cm;
    if (a === 'ev') return detalhe(b.dataset.id);
    if (a === 'sel') return selecionar(b.dataset.id);
    if (a === 'fechar') return ($('#cm-detalhe').hidden = true);
    if (a === 'enquadrar') return C.grafo ? C.grafo.zoomToFit(600, 60) : C.g2?.enquadrar();
    if (a === 'limpar-sel') return selecionar(null);
    if (a === 'pausar') {
      C.pausado = !C.pausado;
      b.textContent = C.pausado ? 'Continuar' : 'Pausar';
      if (!C.pausado) {
        refrescarDados();
        lista();
      }
    }
  };

  const trocarModo = async (modo) => {
    if (modo === C.modo) return;
    C.modo = modo;
    gravarModo('orq.cm.modo', modo);
    for (const b of document.querySelectorAll('[data-cm-modo]')) b.setAttribute('aria-checked', String(b.dataset.cmModo === modo));
    const dica = $('#cm-dica');
    if (dica) dica.textContent = modo === '3d' ? 'Arraste para girar · role para aproximar · clique num ponto para ver só as mensagens dele' : 'Arraste para mover · role para aproximar · clique num ponto para ver só as mensagens dele';
    await montarGrafo();
  };

  const montar = (arg) => {
    C.filtro = arg ? decodeURIComponent(arg) : '';
    C.sel = null;
    C.pausado = false;
    C.vivo = true;
    $('#app').innerHTML = `<div class="cerebro">
      <div class="cb-topo">
        <div class="empilha" style="gap:4px">
          <h1 class="titulo" style="font-size:34px">Comunicação</h1>
          <span class="dica" id="cm-numeros"></span>
        </div>
        <div class="cresce"></div>
        <label class="empilha" style="gap:4px"><span class="dica" style="font-size:12px">Mostrar</span>
          <select class="campo" id="cm-filtro" style="height:38px;min-width:280px">${opcoesFiltro()}</select></label>
        ${botoesModo(C.modo, 'data-cm-modo')}
        <button type="button" class="btn contorno pequeno" data-cm="pausar">Pausar</button>
        <button type="button" class="btn contorno pequeno" data-cm="enquadrar">Enquadrar</button>
      </div>
      <div class="cb-corpo">
        <div class="cb-area">
          <div id="cm-area" class="cm-area" role="img" aria-label="Grafo da comunicação entre gestor, equipes e IAs"></div>
          <div id="cm-rotulos" class="cm-rotulos" aria-hidden="true"></div>
          <div class="cb-vazio" id="cm-vazio" hidden>
            <h2 class="titulo" style="font-size:28px">Ninguém conversou ainda</h2>
            <p class="dica" style="font-size:15px;line-height:1.55">Quando você manda uma solicitação, o gestor fala com as equipes, as equipes falam com as IAs e o avaliador confere tudo. Cada mensagem corre por aqui como um ponto de luz, e quem está trabalhando pulsa até responder.</p>
          </div>
          <div class="cm-dica dica" id="cm-dica">${C.modo === '3d' ? 'Arraste para girar' : 'Arraste para mover'} · role para aproximar · clique num ponto para ver só as mensagens dele</div>
        </div>
        <aside class="cb-lado empilha" style="gap:14px">
          <span id="cm-sel" class="dica"></span>
          <div id="cm-detalhe" class="cm-detalhe" hidden></div>
          <span class="rotulo">Agora</span>
          <div id="cm-agora" class="cm-agora" aria-live="polite"></div>
          <span class="rotulo">Mensagens</span>
          <div id="cm-lista" class="cm-lista"></div>
          <span class="rotulo">Quem é quem</span>
          ${legenda()}
        </aside>
      </div>
    </div>`;
    $('#cm-filtro').addEventListener('change', (e) => {
      location.hash = e.target.value ? `#/comunicacao/${encodeURIComponent(e.target.value)}` : '#/comunicacao';
    });
    $('#app').addEventListener('click', clique);
    window.addEventListener('resize', encaixar);
    for (const eq of Object.keys(S.d.terminais ?? {})) terminal(eq);
    lista();
    rotulos();
    // O painel "Agora" conta o tempo de cada trabalho.
    C.relogio = setInterval(() => {
      conferirTrabalho();
      agora();
    }, 1000);
    montarGrafo().then(carregar);
  };

  const desmontar = () => {
    C.vivo = false;
    cancelAnimationFrame(C.quadro);
    clearInterval(C.relogio);
    window.removeEventListener('resize', encaixar);
    $('#app').removeEventListener('click', clique);
    desmontarGrafo();
  };

  // Uma tarefa ou treino mudou de estado (ex.: terminou): confere quem ainda está trabalhando.
  const atualizar = () => {
    if (!C.vivo) return;
    conferirTrabalho();
    agora();
  };

  return { montar, desmontar, atualizar, evento, terminal };
};
