// Front leve: carrega o estado uma vez e depois só reage aos eventos do servidor.
import { criarTelaCanvas } from '/canvas.js';
import { criarTelaCerebro } from '/cerebro.js';
import { criarTelaComunicacao } from '/comunicacao.js';
import { criarTelasTreino } from '/treino.js';
import { abrirTerminal, avisarFim } from '/terminal-modal.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Indicativo "?" com uma explicação curta. Abre ao passar o mouse ou focar com Tab.
const ajuda = (texto) => `<span class="ajuda" tabindex="0" role="img" aria-label="Ajuda: ${esc(texto)}" data-dica="${esc(texto)}">?</span>`;
// Envolve um checkbox com o "?" do lado de fora do label, para o clique no "?" não marcar a caixa.
const comAjuda = (html, texto) => `<span class="com-ajuda">${html}${ajuda(texto)}</span>`;

const parametros = new URLSearchParams(location.search);
if (parametros.get('token')) {
  localStorage.setItem('orq.token', parametros.get('token'));
  history.replaceState(null, '', location.pathname + location.hash);
}
const token = () => localStorage.getItem('orq.token') ?? '';
const lerLocal = (k, padrao) => {
  try {
    return localStorage.getItem(k) ?? padrao;
  } catch {
    return padrao;
  }
};

const S = {
  d: { treinos: [], niveisTreino: {}, projetos: [], equipes: [], ias: [], tarefas: [], agentes: [], areas: [], terminais: {}, sistema: {}, headroom: {}, comecar: { feito: true }, planos: {}, maquinas: [], geral: {} },
  economia: '',
  proj: lerLocal('orq.proj', 'todos'),
  sel: null,
  modo: 'tarefa',
  term: 'gestor',
  draft: '',
  fotos: [],
  novoProj: false,
  abertos: new Set(),
  devolvendo: false,
  conectado: false,
  carregado: false,
};

// ------------------------------------------------------------------ ícones

const I = {
  foto: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
  mais: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cima: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  baixo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  terminal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>',
};

// ------------------------------------------------------------------ API

const toast = (mensagem, tipo = '') => {
  const caixa = $('#r-toast');
  caixa.innerHTML = `<div class="${tipo}">${esc(mensagem)}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (caixa.innerHTML = ''), 3800);
};

const api = async (metodo, url, corpo) => {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-orq-token': token() },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    toast(dados.erro ?? `Erro ${r.status}`, 'erro');
    throw new Error(dados.erro ?? r.status);
  }
  return dados;
};

const telaCanvas = criarTelaCanvas({ S, $, esc, api, toast, token, ajuda, comAjuda, lerLocal: (k, p) => lerLocal(k, p) });
const gravarLocal = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const treinoTelas = criarTelasTreino({ S, $, esc, api, toast, ajuda });
const telaComunicacao = criarTelaComunicacao({ S, $, esc, api, toast });
const telaCerebro = criarTelaCerebro({ S, $, esc, api, toast, markdown: (t) => markdown(t), lerLocal: (k, p) => lerLocal(k, p), gravarLocal });

const urlAnexo = (nome) => `/api/anexos/${encodeURIComponent(nome)}?token=${encodeURIComponent(token())}`;

// ------------------------------------------------------------------ dados derivados

const projetoNome = (id) => S.d.projetos.find((p) => p.id === id)?.nome ?? '';
const equipe = (id) => S.d.equipes.find((e) => e.id === id);
const ia = (id) => S.d.ias.find((i) => i.id === id);
const doProjeto = (t) => S.proj === 'todos' || t.projetoId === S.proj;
const tarefas = (...estados) => S.d.tarefas.filter((t) => estados.includes(t.estado) && doProjeto(t));
const naFila = () => tarefas('fila').sort((a, b) => a.posicao - b.posicao);
const emAndamento = () => tarefas('planejando', 'executando', 'esperando', 'pausada').sort((a, b) => (a.iniciada ?? '').localeCompare(b.iniciada ?? ''));
const ordemEquipes = () => {
  const ordem = ['gestor', 'pesquisa', 'redacao', 'revisao-texto', 'codigo', 'debug', 'limpo', 'seguranca', 'dados', 'marketing', 'planejamento', 'infra'];
  const peso = (e) => (e.id === 'avaliador' ? 999 : ordem.indexOf(e.id) < 0 ? 500 : ordem.indexOf(e.id));
  return [...S.d.equipes].sort((a, b) => peso(a) - peso(b));
};

const slugPasta = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// Caminho sugerido para um projeto: dentro da pasta padrão, ou ~/projetos na máquina remota.
const pastaSugerida = (nome, maquinaId) => {
  const s = slugPasta(nome);
  if (maquinaId) return `~/projetos/${s}`;
  const base = S.d.geral.pastaProjetos ?? '';
  const sep = S.d.geral.separador ?? '/';
  return s ? `${base}${base.endsWith(sep) ? '' : sep}${s}` : base;
};
const escolherPastaNativa = async (inicial) => (window.singularize?.escolherPasta ? window.singularize.escolherPasta(inicial) : null);

const rotuloModo = (m) => ({ automatico: 'Modo automático', aprovacao: 'Modo com aprovação', manual: 'Modo manual (tela livre)' })[m ?? 'automatico'] ?? '';

const decorrido = (iso) => {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};

const corFase = (t) => ({ esperando: 'espera', pausada: 'espera', revisao: t.avaliacao?.aprovado === false ? 'espera' : 'ok', falhou: 'erro', concluida: 'ok' })[t.estado] ?? '';
const rotuloPasso = { atual: 'Trabalhando agora', espera: 'Esperando você', falhou: 'Falhou' };
const equipeTrabalhando = (id) => S.d.tarefas.find((t) => t.plano?.some((p) => p.equipe === id && p.estado === 'atual'));

// ------------------------------------------------------------------ peças de HTML

const barras = (t) =>
  `<div class="barras" aria-hidden="true">${(t.plano?.length ? t.plano : [{ estado: t.estado === 'planejando' ? 'atual' : 'pend' }]).map((p) => `<span class="b-${p.estado}"></span>`).join('')}</div>`;

const htmlPassos = (t, { detalhado = false } = {}) => {
  if (!t.plano?.length) return `<p class="dica">${t.estado === 'fila' ? 'O gestor ainda não pegou esta tarefa.' : 'O gestor está montando o plano.'}</p>`;
  return `<ol class="passos">${t.plano
    .map((p, i, arr) => {
      const nova = p.equipe.startsWith('nova:');
      const eq = nova ? { nome: p.equipe.slice(5) } : equipe(p.equipe);
      const texto = p.estado === 'ok' && p.resumo ? p.resumo : p.objetivo;
      return `<li class="s-${p.estado}">
        <div class="trilho"><span class="bola"></span>${i < arr.length - 1 ? '<span class="fio"></span>' : ''}</div>
        <div class="corpo">
          <span class="eq">${esc(eq?.nome ?? p.equipe)} <span>${nova ? 'equipe nova, criada se você aprovar' : `com ${esc(p.ia ?? ia(eq?.principal)?.nome ?? '—')}`}${eq?.criadaPeloGestor ? ' · sob medida' : ''}${p.correcao ? ' · correção automática' : ''}</span></span>
          <span class="txt">${esc(texto)}</span>
          ${detalhado && p.estado === 'ok' && p.resumo ? `<span class="dica">Objetivo: ${esc(p.objetivo)}</span>` : ''}
          ${detalhado && p.arquivos?.length ? `<span class="arquivos">${p.arquivos.map(esc).join(' ')}</span>` : ''}
          ${rotuloPasso[p.estado] ? `<span class="est ${p.estado === 'atual' ? 'acento' : p.estado === 'falhou' ? 'erro' : 'espera'}">${rotuloPasso[p.estado]}</span>` : ''}
        </div>
      </li>`;
    })
    .join('')}</ol>`;
};

const htmlPergunta = (t, { mostrarTarefa = true } = {}) => {
  const p = t.pergunta;
  if (!p) return '';
  return `<div class="pergunta" role="group" aria-label="Pergunta de ${esc(p.equipe)}">
    <span class="ponto"></span>
    <span class="texto">${mostrarTarefa ? `<small>${esc(p.equipe)} · ${esc(t.titulo)}</small>` : ''}${esc(p.texto)}</span>
    ${(p.opcoes ?? []).map((o) => `<button type="button" class="btn-espera" data-acao="responder" data-id="${t.id}" data-resposta="${esc(o)}">${esc(o)}</button>`).join('')}
    ${
      p.tipo === 'aprovacao'
        ? ''
        : `<form class="resposta-livre" data-form="responder" data-id="${t.id}">
      <label class="sr" for="resp-${t.id}">Sua resposta</label>
      <input id="resp-${t.id}" name="resposta" placeholder="Ou escreva a resposta…" autocomplete="off">
      <button class="btn pequeno" type="submit">Responder</button>
    </form>`
    }
  </div>`;
};

const htmlLog = (equipeId) => {
  const linhas = S.d.terminais[equipeId] ?? [];
  if (!linhas.length) return '<span>Sem atividade. Contexto limpo.</span>';
  return linhas
    .slice(-200)
    .map((l) => `<span class="l-${l.tipo}">${esc(l.texto)}</span>`)
    .join('');
};

const rolarLog = (el) => el && (el.scrollTop = el.scrollHeight);

// ------------------------------------------------------------------ topo

// Treinos rodando ficam visíveis em qualquer tela, num painel pequeno no canto. Os que acabaram
// há pouco ficam até você fechar, com o resultado.
const TV_ATIVOS = ['gerando-casos', 'revisar', 'treinando', 'provando-ias'];
const treinosVivos = () => {
  const caixa = $('#r-treinos-vivo');
  if (!caixa) return;
  const fechados = new Set((lerLocal('orq.tv.fechados', '') || '').split(',').filter(Boolean));
  const recente = (t) => t.estado === 'concluido' && t.concluido && Date.now() - Date.parse(t.concluido) < 30 * 60_000;
  const lista = (S.d.treinos ?? []).filter((t) => (TV_ATIVOS.includes(t.estado) || recente(t) || t.estado === 'falhou' && Date.now() - Date.parse(t.atualizado ?? 0) < 30 * 60_000) && !fechados.has(`${t.id}:${t.estado}`));
  // Na própria tela do treino o painel some para não repetir.
  const naTela = rotaAtual().arg && location.hash.startsWith('#/treino/') ? rotaAtual().arg : null;
  const mostrar = lista.filter((t) => t.id !== naTela);
  caixa.hidden = !mostrar.length || !S.carregado || rotaAtual().nome === 'comecar';
  if (caixa.hidden) {
    document.body.style.paddingBottom = '';
    return;
  }
  const ativos = mostrar.filter((t) => TV_ATIVOS.includes(t.estado)).length;
  // Sem treino rodando, o painel fica recolhido (só o cabeçalho) até você abrir.
  const escolha = lerLocal('orq.tv.recolhido', '');
  const recolhido = escolha === '1' || (escolha === '' && !ativos);
  const linha = (t) => {
    const total = Math.max(1, t.rodadas * t.copias);
    const feitas = (t.historico ?? []).reduce((n, r) => n + r.copias.filter((c) => c.media !== undefined).length, 0);
    const atual = (t.historico ?? []).at(-1)?.copias.find((c) => c.progresso);
    const pct = t.estado === 'concluido' ? 100 : t.estado === 'provando-ias' ? 95 : t.estado === 'treinando' ? Math.min(92, Math.round((feitas / total) * 100) + 4) : t.estado === 'revisar' ? 3 : 1;
    const texto =
      t.estado === 'gerando-casos'
        ? 'O Treinador está criando os casos de teste.'
        : t.estado === 'revisar'
          ? 'Casos prontos: falta você revisar e começar.'
          : t.estado === 'provando-ias'
            ? 'Prova das IAs: a reserva responde aos casos.'
            : t.estado === 'treinando'
              ? `Rodada ${t.rodadaAtual ?? 1} de ${t.rodadas}${atual ? ` · cópia ${atual.id} respondendo ${atual.progresso}` : ''}`
              : t.estado === 'falhou'
                ? `Parou: ${t.erro ?? ''}`
                : `${t.atingiu ? 'Meta atingida' : 'Meta não atingida'}${t.provaIAs?.promovida ? ' · reserva promovida' : ''}${t.aplicado ? ' · aplicado' : ''}`;
    const nota = t.melhor?.media;
    return `<div class="tv-item ${t.estado}">
      <div class="tv-topo"><a href="#/treino/${esc(t.id)}" class="tv-nome">${esc(t.equipeNome)}</a>${nota !== undefined ? `<span class="tv-nota ${nota >= t.meta ? 'ok' : ''}" data-dica="Melhor nota até agora (meta ${t.meta}).">${nota}<small>/${t.meta}</small></span>` : ''}${TV_ATIVOS.includes(t.estado) ? '' : `<button type="button" class="icone-btn tv-x" aria-label="Fechar aviso do treino" data-acao="tv-fechar" data-id="${esc(t.id)}:${esc(t.estado)}">${I.x}</button>`}</div>
      <span class="tv-txt">${esc(texto)}</span>
      <span class="tv-barra"><span style="width:${pct}%"></span></span>
    </div>`;
  };
  const rodando = ativos;
  caixa.innerHTML = `<button type="button" class="tv-cab" data-acao="tv-recolher" aria-expanded="${!recolhido}"><span class="ponto ${rodando ? 'pulsa' : ''}"></span>${rodando ? `${rodando} ${rodando === 1 ? 'treino em andamento' : 'treinos em andamento'}` : `${mostrar.length} ${mostrar.length === 1 ? 'treino concluído' : 'treinos concluídos'}`}<span class="cresce"></span><span class="dica">${recolhido ? 'mostrar' : 'recolher'}</span></button>${recolhido ? '' : `<div class="tv-lista">${mostrar.map(linha).join('')}</div>`}`;
  // Espaço no fim da página para o painel não cobrir botões.
  document.body.style.paddingBottom = `${caixa.offsetHeight + 32}px`;
};

const atualizarTopo = () => {
  treinosVivos();
  const cotas = S.d.ias
    .filter((i) => i.ativa && i.tipo !== 'shell' && (i.status === 'pronto' || i.tipo === 'simulado') && (i.uso?.chamadas || i.limiteAte))
    .map((i) => {
      const limitada = i.limiteAte && Date.parse(i.limiteAte) > Date.now();
      const estado = limitada ? `sem cota até ${new Date(i.limiteAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : `${i.uso?.chamadas ?? 0} chamadas`;
      return `<span>${esc(i.nome.replace(/ (CLI|Code)$/, ''))} <b class="num ${limitada ? 'espera' : ''}">${esc(estado)}</b></span>`;
    });
  const hr = S.d.headroom ?? {};
  if (hr.usar) cotas.push(`<span>Headroom <b class="${hr.rodando ? 'ok' : 'espera'}">${hr.rodando ? 'comprimindo' : 'parado'}</b></span>`);
  $('#r-cotas').innerHTML = cotas.join('');
  const con = $('#r-conexao');
  // No app de desktop o servidor é interno: o indicador só aparece se a ligação cair.
  con.hidden = !!S.d.sistema.desktop && S.conectado;
  con.classList.toggle('on', S.conectado);
  con.innerHTML = `<span class="ponto"></span>${S.conectado ? 'conectado' : 'reconectando…'}`;
  const simulado = S.d.ias.find((i) => i.tipo === 'simulado');
  const algumaReal = S.d.ias.some((i) => !['simulado', 'shell'].includes(i.tipo) && i.ativa && i.status === 'pronto');
  const demonstracao = S.d.sistema.simular || simulado?.ativa;
  const naTelaComecar = rotaAtual().nome === 'comecar';
  $('#r-aviso').innerHTML =
    !S.carregado || naTelaComecar || (algumaReal && !S.d.sistema.simular)
      ? ''
      : demonstracao
        ? `<p class="aviso">Modo demonstração: as equipes respondem com exemplos, sem IA real. <a href="#/comecar">Escolha suas IAs</a> para elas trabalharem de verdade.</p>`
        : `<p class="aviso">Nenhuma IA em uso ainda. <a href="#/comecar">Escolha suas IAs</a> para as equipes e os agentes poderem trabalhar.</p>`;
  const rota = rotaAtual().nome;
  for (const a of document.querySelectorAll('.secoes a')) {
    if (a.dataset.rota === rota) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
};

// ------------------------------------------------------------------ tela: solicitações

const telaInicio = {
  montar() {
    $('#app').innerHTML = `
      <div id="r-passos"></div>
      <nav class="projetos" id="r-projetos" aria-label="Projetos"></nav>
      <div id="r-novoproj"></div>
      <div class="colunas">
        <aside class="col-esq" id="r-esq" aria-label="Solicitações em andamento"></aside>
        <main class="col-centro">
          <div class="segmentado" role="radiogroup" aria-label="Modo" id="r-modo"></div>
          <div id="r-composer"></div>
          <div class="perguntas" id="r-perguntas" aria-live="polite"></div>
        </main>
        <aside class="col-dir" id="r-dir" aria-label="Passo a passo da tarefa selecionada"></aside>
      </div>
      <section class="fila" aria-label="Próximas na fila">
        <div class="fila-cab"><h2>Próximas na fila</h2><span class="dica">Arraste para reordenar. O gestor sempre pega a primeira.</span></div>
        <div id="r-fila"></div>
      </section>`;
    this.modo();
    this.novoProjeto();
    this.atualizar();
  },

  atualizar() {
    this.passos();
    this.projetos();
    this.esquerda();
    this.direita();
    this.fila();
    this.destino();
    this.perguntas();
    if (S.modo === 'terminal') this.terminalPills();
  },

  // Perguntas em aberto. Só segura o redesenho enquanto você digita uma resposta para uma pergunta
  // que ainda está valendo; pergunta já respondida (ou trocada) sai da tela na hora.
  perguntas() {
    const caixa = $('#r-perguntas');
    if (!caixa) return;
    const abertas = tarefas('esperando').filter((t) => t.pergunta);
    const chave = abertas.map((t) => `${t.id}:${t.pergunta.texto}`).join('|');
    const ativo = document.activeElement;
    const digitando = caixa.contains(ativo) && ativo.matches('input, textarea') && ativo.value.trim();
    const daPergunta = digitando ? ativo.closest('[data-form="responder"]')?.dataset.id : null;
    if (digitando && abertas.some((t) => t.id === daPergunta) && caixa.dataset.chave === chave) return;
    caixa.dataset.chave = chave;
    caixa.innerHTML = abertas.map((t) => htmlPergunta(t)).join('');
  },

  terminal(equipeId) {
    if (S.modo === 'terminal' && equipeId === S.term) {
      const log = $('#r-termlog');
      if (log) {
        log.innerHTML = htmlLog(S.term);
        rolarLog(log);
      }
    }
  },

  // Guia do primeiro acesso: some quando os três passos estão feitos ou quando o usuário fecha.
  passos() {
    const caixa = $('#r-passos');
    const iaReal = S.d.ias.some((i) => i.ativa && i.status === 'pronto' && !['shell', 'simulado'].includes(i.tipo));
    const feitos = [iaReal, S.d.projetos.length > 0, S.d.tarefas.length > 0 || S.d.agentes.length > 0];
    if (lerLocal('orq.passos', '') === 'ok' || feitos.every(Boolean)) return (caixa.innerHTML = '');
    const passo = (n, feito, titulo, texto, botoes) => `<li class="${feito ? 'feito' : ''}">
        <span class="passo-num" aria-hidden="true">${feito ? '✓' : n}</span>
        <div class="empilha" style="gap:6px"><span class="serif" style="font-size:20px">${titulo}${feito ? '<span class="sr"> (feito)</span>' : ''}</span><span class="dica" style="font-size:14px">${texto}</span>
        ${feito ? '' : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${botoes}</div>`}</div>
      </li>`;
    caixa.innerHTML = `<section class="primeiros" aria-labelledby="pp-t">
      <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap"><h2 class="titulo" id="pp-t" style="font-size:28px">Primeiros passos</h2><span class="dica">Três passos e o sistema está trabalhando para você.</span><div class="cresce"></div>
        <a href="#/ajuda" style="font-size:14px">Ler o manual</a><button type="button" class="link mudo" data-acao="passos-fechar">Já sei usar</button></div>
      <ol class="passos-lista">
        ${passo(1, iaReal, 'Escolha suas IAs', 'Escolha entre Claude Code, Antigravity, Codex e Ollama. As que faltarem, o app instala quando você confirmar.', `<a class="btn pequeno" href="#/comecar">Escolher IAs</a>`)}
        ${passo(2, feitos[1], 'Crie um projeto', 'Um projeto é uma pasta de trabalho, normalmente um repositório. As equipes e os agentes abrem os terminais nela.', `<button type="button" class="btn pequeno" data-acao="novo-projeto">Criar projeto</button>`)}
        ${passo(3, feitos[2], 'Escolha como trabalhar', '<b style="font-weight:500;color:var(--texto)">Solicitação:</b> você descreve o resultado, o gestor divide e o avaliador confere. <b style="font-weight:500;color:var(--texto)">Tela livre:</b> você monta os agentes, liga quem conversa com quem e acompanha cada terminal.', `<button type="button" class="btn pequeno" data-acao="focar-pedido">Escrever uma solicitação</button><a class="btn contorno pequeno" href="#/livre">Abrir a tela livre</a>`)}
      </ol>
    </section>`;
  },

  projetos() {
    const todos = [{ id: 'todos', nome: 'Todos os projetos' }, ...S.d.projetos];
    $('#r-projetos').innerHTML =
      todos.map((p) => `<button type="button" class="pill" data-acao="projeto" data-id="${esc(p.id)}" aria-pressed="${S.proj === p.id}">${esc(p.nome)}</button>`).join('') +
      `<button type="button" class="pill tracejada" data-acao="novo-projeto">${I.mais}Criar projeto</button>` +
      (S.proj !== 'todos' ? `<span class="dica" style="margin-left:10px">${esc(rotuloModo(S.d.projetos.find((p) => p.id === S.proj)?.modo))}${(() => { const mq = S.d.maquinas.find((m) => m.id === S.d.projetos.find((p) => p.id === S.proj)?.maquinaId); return mq ? ` · em ${esc(mq.nome)}` : ''; })()}</span><button type="button" class="link" data-acao="editar-projeto" style="margin-left:8px">Configurar projeto</button>` : '');
  },

  novoProjeto() {
    const caixa = $('#r-novoproj');
    if (!S.novoProj) return (caixa.innerHTML = '');
    const editando = S.novoProj === 'editar' ? S.d.projetos.find((p) => p.id === S.proj) : null;
    const iasProntas = S.d.ias.filter((i) => !['simulado', 'shell'].includes(i.tipo) && (i.status === 'pronto' || editando?.ias?.includes(i.id)));
    const modoAtual = editando?.modo ?? 'automatico';
    const MODOS = [
      ['automatico', 'Automático', 'O gestor entende o pedido, escolhe as equipes certas e cria equipes sob medida quando faltar. Roda sem te perguntar.'],
      ['aprovacao', 'Com aprovação', 'O gestor monta o plano (e as equipes novas, se precisar) e espera você aprovar antes de começar.'],
      ['manual', 'Manual', 'Sem gestor. Você monta e orquestra os agentes na tela livre deste projeto.'],
    ];
    caixa.innerHTML = `<form class="painel" data-form="projeto" data-editar="${esc(editando?.id ?? '')}" aria-label="${editando ? 'Configurar projeto' : 'Criar projeto'}">
      <div class="grupo"><label for="pj-nome">Nome do projeto</label><input class="campo" id="pj-nome" name="nome" placeholder="Ex.: Portal de pagamentos" required value="${esc(editando?.nome ?? '')}"></div>
      <div class="grupo"><label for="pj-pasta">Pasta do projeto ${ajuda('Onde as equipes e os agentes trabalham. Vem dentro da sua pasta de projetos e segue o nome; troque se quiser outra. Se não existir, é criada.')}</label>
        <div style="display:flex;gap:8px"><input class="campo mono" id="pj-pasta" name="pasta" required value="${esc(editando?.pasta ?? pastaSugerida('', editando?.maquinaId))}" autocomplete="off">${window.singularize ? '<button type="button" class="btn contorno pequeno" data-acao="pj-escolher-pasta" style="height:42px">Escolher…</button>' : ''}</div>
        <span class="dica" id="pj-pasta-dica">${editando ? '' : 'Segue o nome do projeto. Edite para usar outra.'}</span></div>
      <div class="grupo"><label for="pj-maquina">Onde fica ${ajuda('Este computador ou uma máquina remota por SSH. Na remota, a pasta é o caminho de lá, e as IAs usadas são as instaladas lá.')}</label><select class="campo" id="pj-maquina" name="maquinaId"><option value="">Este computador</option>${S.d.maquinas.map((m) => `<option value="${esc(m.id)}" ${editando?.maquinaId === m.id ? 'selected' : ''}>${esc(m.nome)} (SSH)</option>`).join('')}</select>${S.d.maquinas.length ? '' : '<a href="#/maquinas" class="dica" style="color:var(--acento-texto)">Adicionar máquina remota</a>'}</div>
      <fieldset class="largo" style="border:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">
        <legend class="rotulo" style="margin-bottom:10px;color:var(--texto)">Como este projeto trabalha?</legend>
        <div class="modos">${MODOS.map(([v, t, d]) => `<label class="modo"><input type="radio" name="modo" value="${v}" ${v === modoAtual ? 'checked' : ''}><span class="empilha" style="gap:4px"><span style="font-weight:500">${t}</span><span class="dica">${d}</span></span></label>`).join('')}</div>
      </fieldset>
      <fieldset class="largo" style="border:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px">
        <legend class="rotulo" style="margin-bottom:12px;color:var(--texto)">Quais IAs este projeto pode usar? ${ajuda('Limita as IAs que o gestor pode escolher neste projeto. Sem marcar nenhuma, vale qualquer IA ligada. Se todas as marcadas forem desligadas, o projeto usa as outras IAs ligadas em vez de travar.')}</legend>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${iasProntas
          .map(
            (i) => `<label class="check" style="flex:1 1 200px;max-width:280px;padding:12px 14px;border-radius:10px;background:var(--campo);${i.status !== 'pronto' ? 'opacity:.5' : ''}">
            <input type="checkbox" name="ias" value="${esc(i.id)}" ${i.status !== 'pronto' ? 'disabled' : ''} ${editando?.ias?.includes(i.id) ? 'checked' : ''}>
            <span style="display:flex;flex-direction:column;gap:2px"><span style="font-weight:500">${esc(i.nome)}</span><span class="dica">${i.status !== 'pronto' ? 'Não encontrada' : !i.ativa ? 'Desligada em IAs: não será usada' : i.problema ? `Com problema: ${esc(i.problema.motivo)}` : 'Pronta para usar'}</span></span>
          </label>`,
          )
          .join('')}</div>
      </fieldset>
      <label class="check largo"><input type="checkbox" name="worktrees" ${editando?.worktrees ? 'checked' : ''}><span style="display:flex;flex-direction:column;gap:2px"><span>Cada tarefa num worktree separado</span><span class="dica">Só para repositórios git neste computador. A tarefa vira a branch orq/T-xxx e o merge fica com você.</span></span></label>
      <p class="dica largo">As equipes abrem os terminais nessa pasta e o vault ganha a nota de cada tarefa.</p>
      <button class="btn" type="submit">${editando ? 'Salvar' : 'Criar projeto'}</button>
      <button class="btn texto" type="button" data-acao="fechar-projeto">Cancelar</button>
    </form>`;
    $('#pj-nome').focus();
    this.pastaManual = !!editando;
  },

  modo() {
    $('#r-modo').innerHTML = `
      <button type="button" role="radio" aria-checked="${S.modo === 'tarefa'}" data-acao="modo" data-modo="tarefa" data-dica="Entra na fila. O gestor divide entre as equipes e o avaliador confere antes de chegar a você.">Nova tarefa</button>
      <button type="button" role="radio" aria-checked="${S.modo === 'terminal'}" data-acao="modo" data-modo="terminal" data-dica="Pergunta ou ajuste rápido direto para uma equipe, sem passar pela fila.">Falar com uma equipe</button>`;
    const caixa = $('#r-composer');
    const alvoManual = this.projetoAlvo()?.modo === 'manual' && S.proj !== 'todos' ? this.projetoAlvo() : null;
    if (S.modo === 'tarefa' && alvoManual) {
      caixa.innerHTML = `<div class="empilha" style="gap:16px;padding:24px;border-radius:14px;background:var(--sup-3)">
        <span class="serif" style="font-size:24px">${esc(alvoManual.nome)} é um projeto manual</span>
        <p class="dica" style="font-size:15px;margin:0">Aqui não há gestor: você monta os agentes, liga quem conversa com quem e acompanha cada terminal na tela livre deste projeto.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-acao="abrir-livre-projeto" data-id="${esc(alvoManual.id)}">Abrir a tela livre do projeto</button><button type="button" class="btn texto" data-acao="editar-projeto">Mudar o modo do projeto</button></div>
      </div>`;
      return this.destino();
    }
    if (S.modo === 'tarefa') {
      caixa.innerHTML = `<form class="empilha" style="gap:22px" data-form="tarefa">
        <label for="pedido" class="dica" style="font-size:14px" id="r-destino"></label>
        <textarea id="pedido" class="pedido" rows="5" placeholder="Descreva a tarefa como explicaria para alguém da equipe. Prints, documentos e arquivos ajudam: anexe, cole ou arraste para cá.">${esc(S.draft)}</textarea>
        <div class="fotos" id="r-fotos"></div>
        <div class="acoes-pedido">
          <label class="anexar" data-dica="Qualquer arquivo: PDF, Word, planilha, código, texto, imagens, zip. Até 20 por tarefa, 50 MB cada. Também dá para colar ou arrastar para o pedido.">${I.foto}Anexar arquivos<input type="file" multiple data-mudar="fotos"></label>
          <span class="dica">Ctrl + Enter envia</span>
          <div class="cresce"></div>
          <button class="btn" type="submit">Colocar na fila</button>
        </div>
      </form>`;
      this.fotos();
    } else {
      caixa.innerHTML = `<div class="empilha" style="gap:18px">
        <p class="dica" style="font-size:14px">A mensagem vai direto para a equipe escolhida, sem passar pela fila. Use para ajustes rápidos ou perguntas. Para terminais que você controla por completo, use a <a href="#/livre">Tela livre</a>.</p>
        <div class="terminais-escolha" role="radiogroup" aria-label="Terminal" id="r-termpills"></div>
        <div class="log" id="r-termlog" aria-live="polite"></div>
        <form class="acoes-pedido" style="align-items:flex-end" data-form="terminal">
          <label class="sr" for="msg-term">Mensagem para o terminal</label>
          <textarea id="msg-term" class="pedido menor" rows="2" style="flex:1 1 320px"></textarea>
          <button class="btn" type="submit" id="r-termbtn"></button>
        </form>
        <a href="#/terminais" style="font-size:14px;align-self:flex-start">Acompanhar todas as equipes</a>
      </div>`;
      this.terminalPills();
      this.terminal(S.term);
    }
    this.destino();
  },

  terminalPills() {
    const caixa = $('#r-termpills');
    if (!caixa) return;
    caixa.innerHTML = ordemEquipes()
      .filter((e) => e.ativa !== false)
      .map((e) => {
        const ocupado = equipeTrabalhando(e.id);
        return `<button type="button" role="radio" class="pill cheia" aria-checked="${S.term === e.id}" data-acao="term" data-id="${e.id}"><span class="ponto" style="background:${ocupado ? 'var(--acento)' : '#4a4a55'}"></span>${esc(e.nome)}</button>`;
      })
      .join('');
    const nome = equipe(S.term)?.nome ?? '';
    $('#r-termbtn').textContent = `Enviar para ${nome}`;
    $('#msg-term').placeholder = `Escreva para ${nome}…`;
  },

  destino() {
    const el = $('#r-destino');
    if (!el) return;
    const alvo = this.projetoAlvo();
    el.innerHTML = alvo
      ? `Vai para a fila de <span style="color:var(--texto)">${esc(alvo.nome)}</span>. O gestor divide entre as equipes. ${ajuda('Descreva o resultado que você quer, não os passos. O gestor escolhe as equipes, o avaliador confere e você aprova ou devolve no fim.')}`
      : 'Crie um projeto para começar. O gestor precisa saber em que pasta as equipes vão trabalhar.';
  },

  projetoAlvo() {
    return S.d.projetos.find((p) => p.id === S.proj) ?? S.d.projetos.find((p) => p.modo !== 'manual') ?? S.d.projetos[0];
  },

  fotos() {
    const caixa = $('#r-fotos');
    if (!caixa) return;
    caixa.innerHTML = S.fotos
      .map((f, i) =>
        /^image\//.test(f.tipo ?? '') || /^data:image\//.test(f.dados)
          ? `<div class="foto"><img src="${f.dados}" alt="${esc(f.nome)}"><button type="button" aria-label="Remover ${esc(f.nome)}" data-acao="remover-foto" data-i="${i}">${I.x}</button></div>`
          : `<div class="arquivo-chip"><span class="arquivo-ext">${esc((f.nome.split('.').pop() || 'arq').slice(0, 4).toUpperCase())}</span><span class="arquivo-nome"><b>${esc(f.nome)}</b><small>${tamanhoLegivel(f.tamanho)}</small></span><button type="button" class="icone-btn" aria-label="Remover ${esc(f.nome)}" data-acao="remover-foto" data-i="${i}">${I.x}</button></div>`,
      )
      .join('');
  },

  esquerda() {
    const ativas = emAndamento();
    const fila = naFila();
    const espera = ativas.filter((t) => t.estado === 'esperando').length;
    const revisar = tarefas('revisao');
    const falhas = tarefas('falhou');
    const historico = tarefas('concluida', 'cancelada').sort((a, b) => (b.concluida ?? b.atualizada ?? '').localeCompare(a.concluida ?? a.atualizada ?? ''));
    const todos = S.proj === 'todos';
    if (!ativas.some((t) => t.id === S.sel)) S.sel = ativas[0]?.id ?? revisar[0]?.id ?? null;
    const card = (t) => `<button type="button" class="req" data-acao="selecionar" data-id="${t.id}" aria-pressed="${S.sel === t.id}">
        <div class="linha1"><span class="tit">${esc(t.titulo)}</span><span class="tempo">${decorrido(t.iniciada)}</span></div>
        ${todos ? `<span class="proj">${esc(projetoNome(t.projetoId))}</span>` : ''}
        <span class="fase ${corFase(t)}">${esc(t.fase)}</span>
        ${barras(t)}
      </button>`;
    const link = (t) => `<a href="#/tarefa/${t.id}" class="req"><span class="tit">${esc(t.titulo)}</span>${todos ? `<span class="proj">${esc(projetoNome(t.projetoId))}</span>` : ''}<span class="fase ${corFase(t)}">${esc(t.fase)}</span></a>`;
    $('#r-esq').innerHTML = `
      <p class="resumo"><b>${ativas.length}</b> em andamento e <b>${fila.length}</b> na fila${espera ? `, com <b>${espera}</b> esperando você.` : '.'} <a href="#/historico" style="white-space:nowrap">Ver histórico</a></p>
      <h2 class="rotulo" style="margin-top:12px">Em andamento ${ajuda('Tarefas que o gestor já pegou. Clique numa para ver o passo a passo à direita. A barra mostra uma etapa por equipe.')}</h2>
      ${ativas.length ? `<div class="lista-req">${ativas.map(card).join('')}</div>` : `<p class="vazio">Nada rodando${todos ? '' : ' neste projeto'}. Descreva a próxima tarefa ao lado.</p>`}
      ${revisar.length ? `<h2 class="rotulo" style="margin-top:16px">Prontas para revisar ${ajuda('O avaliador já conferiu. Abra para aprovar a entrega ou devolver com o que precisa mudar.')}</h2><div class="lista-req">${revisar.map(link).join('')}</div>` : ''}
      ${historico.length ? `<h2 class="rotulo" style="margin-top:16px">Concluídas ${ajuda('As que você aprovou ou cancelou. Abra para ver as respostas, perguntar de novo às equipes ou reler a nota.')}</h2><div class="lista-req">${historico.slice(0, 5).map(link).join('')}</div><a href="#/historico" style="font-size:14px;align-self:flex-start">Ver todo o histórico (${historico.length})</a>` : ''}
      ${falhas.length ? `<h2 class="rotulo" style="margin-top:16px">Pararam com erro ${ajuda('Uma equipe não conseguiu concluir. Leia o motivo, ajuste (por exemplo, ligue uma IA em IAs) e clique em Tentar de novo.')}</h2><div class="lista-req">${falhas.map((t) => `<div class="empilha" style="gap:6px">${link(t)}<button type="button" class="link" data-acao="retomar" data-id="${t.id}" style="align-self:flex-start;padding-left:14px">Tentar de novo</button></div>`).join('')}</div>` : ''}`;
  },

  direita() {
    const t = S.d.tarefas.find((x) => x.id === S.sel);
    $('#r-dir').innerHTML = t
      ? `<div class="passo-titulo"><span class="dica" style="font-size:14px">${esc(t.id)} · ${esc(t.titulo)}</span><p${(t.fase ?? '').length > 90 ? ' style="font-size:19px;line-height:1.4"' : ''}>${esc(t.fase)}</p></div>
         ${htmlPassos(t)}
         <div style="display:flex;flex-wrap:wrap;gap:18px"><a href="#/tarefa/${t.id}" style="font-size:14px">Abrir a tarefa</a><a href="#/terminais" style="font-size:14px">Ver os terminais trabalhando</a></div>`
      : `<div class="passo-titulo"><span class="dica" style="font-size:14px">Passo a passo</span><p style="color:var(--suave)">Quando o gestor pegar uma tarefa, a divisão aparece aqui.</p></div>`;
  },

  fila() {
    const fila = naFila();
    const todos = S.proj === 'todos';
    $('#r-fila').innerHTML = fila.length
      ? `<ol>${fila
          .map((t, i) => {
            const nAnexos = Math.max(t.arquivos?.length ?? 0, t.fotos?.length ?? 0);
            const meta = [nAnexos ? `${nAnexos} ${nAnexos === 1 ? 'anexo' : 'anexos'}` : '', t.devolucoes ? 'devolvida' : '', t.origem ?? ''].filter(Boolean).join(', ');
            return `<li draggable="true" data-arrastar="${t.id}">
              <span class="pos">${i + 1}</span>
              <div class="tit"><span>${esc(t.titulo)}</span>${todos ? `<span class="meta">${esc(projetoNome(t.projetoId))}</span>` : ''}</div>
              <span class="meta">${esc(meta)}</span>
              <div style="display:flex;gap:2px">
                <button type="button" class="icone-btn" aria-label="Subir na fila" data-acao="mover" data-id="${t.id}" data-delta="-1">${I.cima}</button>
                <button type="button" class="icone-btn" aria-label="Descer na fila" data-acao="mover" data-id="${t.id}" data-delta="1">${I.baixo}</button>
                <button type="button" class="icone-btn" aria-label="Tirar da fila" data-acao="remover-tarefa" data-id="${t.id}">${I.x}</button>
              </div>
            </li>`;
          })
          .join('')}</ol>`
      : '<p class="dica" style="font-size:15px">Nenhuma tarefa esperando.</p>';
  },
};

// ------------------------------------------------------------------ tela: terminais

const telaTerminais = {
  montar() {
    const equipes = ordemEquipes();
    this.ids = equipes.map((e) => e.id).join();
    $('#app').innerHTML = `<div class="pagina">
      <div class="pagina-cab"><h1>Acompanhar equipes</h1><a href="#/livre" style="font-size:14px">Abrir terminais interativos na tela livre</a></div>
      <p class="intro">Cada equipe é um supervisor que roda numa IA de terminal e coordena os próprios agentes. As equipes não falam entre si: tudo passa pelo gestor e pela nota da tarefa no vault.</p>
      <div class="grade-term">${equipes
        .map(
          (e) => `<article class="term" aria-labelledby="th-${e.id}">
          <div class="term-cab"><span class="ponto" id="tp-${e.id}"></span><h2 id="th-${e.id}">${esc(e.nome)}</h2><span class="com" id="tc-${e.id}"></span><span class="st" id="ts-${e.id}"></span></div>
          <div class="log" id="log-${e.id}" aria-live="polite"></div>
          <form class="term-form" data-form="terminal-direto" data-id="${e.id}">
            <label class="sr" for="ti-${e.id}">Escrever no terminal ${esc(e.nome)}</label>
            <input id="ti-${e.id}" name="texto" placeholder="Escrever direto para ${esc(e.nome)}…" autocomplete="off">
            <button class="btn pequeno" type="submit">Enviar</button>
          </form>
        </article>`,
        )
        .join('')}</div></div>`;
    for (const e of equipes) this.terminal(e.id);
    this.atualizar();
  },
  atualizar() {
    if (ordemEquipes().map((e) => e.id).join() !== this.ids) return this.montar();
    for (const e of S.d.equipes) {
      const t = equipeTrabalhando(e.id);
      const passo = t?.plano.find((p) => p.equipe === e.id && p.estado === 'atual');
      $(`#tp-${e.id}`).style.background = t ? 'var(--acento)' : e.ativa === false ? 'var(--linha)' : '#4a4a55';
      $(`#tc-${e.id}`).textContent = `com ${passo?.ia ?? ia(e.principal)?.nome ?? '—'}`;
      $(`#ts-${e.id}`).innerHTML = t ? `<span class="acento">trabalhando em ${esc(t.id)}</span>` : e.ativa === false ? '<span class="dica">desativada</span>' : '<span class="dica">ociosa</span>';
    }
  },
  terminal(equipeId) {
    const log = $(`#log-${equipeId}`);
    if (!log) return;
    log.innerHTML = htmlLog(equipeId);
    rolarLog(log);
  },
};

// ------------------------------------------------------------------ tela: equipes

// Só as IAs que você escolheu usar. A atual aparece mesmo fora de uso, para você ver e trocar.
// Só segura a atualização da lista enquanto a pessoa digita ou escolhe numa lista;
// caixinhas e botões não seguram (senão a tela fica mostrando o estado antigo).
const digitandoEm = (caixa) => caixa.contains(document.activeElement) && document.activeElement.matches('textarea, select, input:not([type=checkbox]):not([type=radio])');

const opcoesIA = (selecionada, comNenhuma) =>
  (comNenhuma || !selecionada ? [`<option value="" ${!selecionada ? 'selected' : ''}>Nenhuma</option>`] : [])
    .concat(
      S.d.ias
        .filter((i) => i.tipo !== 'shell' && (i.ativa || i.id === selecionada))
        .map((i) => `<option value="${esc(i.id)}" ${i.id === selecionada ? 'selected' : ''}>${esc(i.nome)}${!i.ativa ? ' (fora de uso)' : i.tipo !== 'simulado' && i.status !== 'pronto' ? ' (não encontrada)' : ''}</option>`),
    )
    .join('');

// Proposta do gestor para a equipe nova: duplicidade, nome, caminho, DNA e recomendação de treino.
const desenharAnalise = () => {
  const caixa = $('#r-analise-equipe');
  if (!caixa) return;
  const a = S.analiseEquipe;
  if (!a) return (caixa.innerHTML = '');
  if (a.carregando) return (caixa.innerHTML = `<div class="analise-equipe"><p class="dica conversa-espera">O gestor está analisando: procurando equipes parecidas, refinando o nome e escrevendo o prompt de base…</p></div>`);
  const p = a.proposta;
  const NIVEL = { leve: 'Leve', medio: 'Médio', profundo: 'Profundo' };
  caixa.innerHTML = `<form class="analise-equipe empilha" data-form="proposta-equipe">
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><h3 class="titulo" style="font-size:24px;margin:0">Proposta do gestor</h3><span class="dica">${p.porIA ? `analisada por ${esc(p.porIA)}` : 'sem IA disponível: montada com o padrão do assunto'}</span></div>
    ${
      p.duplicada
        ? `<div class="aviso"><b>Já temos a equipe ${esc(p.duplicada.nome)} ativa.</b> Recomendo apenas ajustar o prompt base dela para esse novo objetivo, em vez de criar uma nova.${p.duplicada.motivo ? ` <span class="dica">${esc(p.duplicada.motivo)}</span>` : ''}
          <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn pequeno" data-acao="eq-ajustar-existente" data-id="${esc(p.duplicada.id)}">Ajustar ${esc(p.duplicada.nome)}</button><span class="dica" style="align-self:center">ou revise abaixo e crie mesmo assim</span></div></div>`
        : ''
    }
    <div class="tr-linha">
      <div class="grupo" style="flex:1 1 220px"><label for="pe-nome">Nome refinado</label><input class="campo" id="pe-nome" name="nome" value="${esc(p.nome)}"></div>
      <div class="grupo" style="flex:2 1 360px"><label for="pe-cam">Caminho na árvore do cérebro ${ajuda('Categoria > Subcategoria > Domínio > Especialidade. É onde o conhecimento desta equipe fica no mapa do cérebro.')}</label><input class="campo" id="pe-cam" name="caminho" value="${esc(p.caminho.join(' > '))}"></div>
    </div>
    <div class="grupo"><label for="pe-inst">Prompt comportamental de base ${ajuda('O DNA da equipe: padrão de referência, regras de trabalho e formato de entrega. Ajuste à vontade antes de criar.')}</label><textarea class="campo mono tr-auto" id="pe-inst" name="instrucoes" rows="${Math.min(24, Math.max(8, p.instrucoes.split('\n').length + 1))}" style="font-size:13px">${esc(p.instrucoes)}</textarea></div>
    <div class="aviso ${p.treino.recomendado ? '' : 'ok'}" style="${p.treino.recomendado ? '' : 'background:rgba(111,211,155,.08);color:var(--ok)'}"><b>${p.treino.recomendado ? `Recomendo iniciar um treino de nível ${NIVEL[p.treino.nivel] ?? p.treino.nivel} antes de usar.` : 'Pode pular o treino e começar direto.'}</b> ${esc(p.treino.motivo)}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <button class="btn" type="submit" data-acao="eq-criar-sem-treino">${p.treino.recomendado ? 'Criar sem treinar' : 'Criar equipe'}</button>
      <button class="btn ${p.treino.recomendado ? '' : 'contorno'}" type="submit" data-acao="eq-criar-e-treinar">Criar e treinar</button>
      <button type="button" class="btn texto" data-acao="eq-descartar-analise">Descartar</button>
    </div>
  </form>`;
  caixa.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const telaEquipes = {
  montar() {
    $('#app').innerHTML = `<div class="pagina">
      <div class="pagina-cab"><h1>Equipes</h1><a class="btn pequeno" href="#/objetivos" data-dica="Marque para que você usa o app e criamos as equipes desses objetivos.">Adicionar por objetivo</a><a class="btn contorno pequeno" href="#/skills" data-dica="Habilidades modulares (checklists, roteiros, jeitos de fazer) que as equipes herdam. Ficam no cérebro, em 40-skills.">Central de skills</a></div>
      <p class="intro">As equipes nascem dos seus objetivos ou do gestor, quando um pedido precisa. Cada uma tem uma IA principal e uma reserva, sempre entre as IAs que você escolheu. Se a principal ficar sem cota ou falhar no meio, o gestor remaneja a etapa para a reserva e, se preciso, para qualquer outra IA disponível que consiga fazer o trabalho.</p>
      <div class="linhas" id="r-equipes"></div>
      <h2 class="titulo" style="font-size:26px;margin-top:20px" id="nova-equipe">Nova equipe</h2>
      <form class="form-nova" data-form="equipe">
        <div class="grupo"><label for="ne-nome">Nome</label><input class="campo" id="ne-nome" name="nome" placeholder="Ex.: Documentação" required></div>
        <div class="grupo" style="flex:2 1 320px"><label for="ne-desc">O que faz</label><input class="campo" id="ne-desc" name="desc" placeholder="Escreve e mantém READMEs e guias." required></div>
        <div class="grupo"><label for="ne-p">IA principal</label><select class="campo" id="ne-p" name="principal">${opcoesIA(S.d.ias.find((i) => i.ativa && i.tipo !== 'shell')?.id ?? '')}</select></div>
        <div class="grupo"><label for="ne-r">Reserva</label><select class="campo" id="ne-r" name="reserva">${opcoesIA('', true)}</select></div>
        <div class="grupo"><label for="ne-f">Família (opcional) ${ajuda('Agrupa equipes do mesmo assunto. Ex.: Segurança → Segurança web, Segurança de eventos. Cada uma continua independente.')}</label><input class="campo" id="ne-f" name="familia" list="familias" placeholder="Ex.: Segurança"></div>
        <div class="grupo" style="flex:2 1 320px"><label for="ne-fo">Foco / especialidade ${ajuda('Em que ela é especialista. O gestor usa isso para escolher a equipe certa.')}</label><input class="campo" id="ne-fo" name="foco" placeholder="Ex.: segurança de eventos noturnos: acesso, lotação, evacuação"></div>
        <div class="grupo largo"><label for="ne-c">Contextos (separados por vírgula)</label><input class="campo" id="ne-c" name="contextos" placeholder="Ex.: balada, show, portaria"></div>
        <datalist id="familias">${[...new Set(S.d.equipes.map((e) => e.familia).filter(Boolean))].map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
        <div class="grupo largo"><label for="ne-i">Instruções da equipe (opcional)</label><textarea class="campo" id="ne-i" name="instrucoes" rows="3" placeholder="Regras que o supervisor sempre segue."></textarea></div>
        ${comAjuda('<label class="check"><input type="checkbox" name="requer" value="editar">Precisa editar arquivos</label>', 'Só IAs que alteram o projeto podem assumir esta equipe.')}
        ${comAjuda('<label class="check"><input type="checkbox" name="aprovacao">Pedir minha aprovação</label>', 'A tarefa para antes de cada etapa desta equipe até você liberar.')}
        <div class="cresce"></div>
        <button class="btn" type="submit" data-dica="O gestor confere se já existe uma equipe parecida, refina o nome, escreve o prompt comportamental de base e diz se vale treinar antes. Nada é criado sem você confirmar.">Analisar com o gestor</button>
      </form>
      <div id="r-analise-equipe" aria-live="polite"></div>
    </div>`;
    this.atualizar(true);
  },
  atualizar(forcar) {
    const caixa = $('#r-equipes');
    if (!forcar && digitandoEm(caixa)) return;
    const soFixas = S.d.equipes.every((e) => e.fixa);
    caixa.innerHTML = (soFixas
      ? `<div class="linha"><div class="nome"><span>Nenhuma equipe de trabalho ainda</span><small>No modo Automático o gestor cria as equipes que cada pedido precisar. Se preferir, <a href="#/objetivos" style="color:var(--acento-texto)">escolha seus objetivos</a> ou crie uma equipe abaixo.</small></div></div>`
      : '') + gruposDeEquipes()
      .map(([familia, lista]) => `<div class="eq-grupo"><div class="eq-grupo-cab"><h2 class="titulo">${esc(familia)}</h2><span class="dica">${lista.length} ${lista.length === 1 ? 'equipe' : 'equipes'}</span><div class="cresce"></div>${familia === 'Sistema' ? '' : `<button type="button" class="link" data-acao="eq-especializar" data-familia="${esc(familia === 'Sem família' ? '' : familia)}" data-dica="Cria uma equipe nova e independente nesta família, com um foco mais específico. Depois você pode treiná-la.">+ Nova especialização</button>`}</div>${lista.map((e) => linhaEquipe(e)).join('')}</div>`)
      .join('');
  },
};

// Nota de cada IA na última prova de treino desta equipe, e o placar real (avaliador aprovou / apontou problema).
const desempenhoEquipe = (e) => {
  const prova = Object.entries(e.desempenho ?? {});
  const real = Object.entries(e.desempenhoReal ?? {});
  if (!prova.length && !real.length) return '';
  const papel = (id) => (id === e.principal ? 'principal' : id === e.reserva ? 'reserva' : '');
  const exigido = (id) => (id === e.principal ? e.treino?.meta ?? 80 : e.treino?.metaReserva ?? 70);
  const itens = prova
    .sort((a, b) => b[1].media - a[1].media)
    .map(([id, d]) => `<span class="${papel(id) && d.media < exigido(id) ? 'baixa' : ''}" data-dica="Nota na prova do treino ${esc(d.treino)}${papel(id) ? ` como ${papel(id)} (mínimo ${exigido(id)})` : ''}.">${esc((d.nome ?? ia(id)?.nome ?? id).replace(/ (CLI|Code)$/, ''))} <b>${d.media}</b>${papel(id) ? ` · ${papel(id)}` : ''}</span>`);
  const reais = real.map(([id, d]) => `<span data-dica="Entregas desta equipe conferidas pelo avaliador.">${esc((d.nome ?? ia(id)?.nome ?? id).replace(/ (CLI|Code)$/, ''))}: <b>${d.aprovadas}</b> aprovadas${d.problemas ? `, <b>${d.problemas}</b> com problema` : ''}</span>`);
  return `<small class="eq-desemp">${itens.length ? `Desempenho: ${itens.join('')}` : ''}${reais.length ? `${itens.length ? ' · ' : ''}Tarefas: ${reais.join('')}` : ''}</small>`;
};

// Grupos: Sistema (gestor, avaliador, treinador), cada família e as equipes sem família.
const gruposDeEquipes = () => {
  const grupos = new Map();
  for (const e of ordemEquipes()) {
    const g = e.fixa ? 'Sistema' : e.familia || 'Sem família';
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(e);
  }
  const nomes = [...grupos.keys()].sort((a, b) => (a === 'Sistema' ? -1 : b === 'Sistema' ? 1 : a === 'Sem família' ? 1 : b === 'Sem família' ? -1 : a.localeCompare(b)));
  return nomes.map((n) => [n, grupos.get(n)]);
};

const linhaEquipe = (e) => {
        const aberto = S.abertos.has(`eq-${e.id}`);
        const treinos = S.d.treinos.filter((t) => t.equipeId === e.id).sort((a, b) => (a.criado < b.criado ? 1 : -1));
        const emTreino = treinos.find((t) => ['gerando-casos', 'revisar', 'treinando', 'pausado'].includes(t.estado));
        return `<div class="linha">
          <div class="nome"><span>${esc(e.nome)}${e.treino?.nota ? ` <span class="selo ok" data-dica="Nota no último treino aplicado (meta ${e.treino.meta}). Versão ${e.treino.versao}.">treinada · ${e.treino.nota}</span>` : ''}${emTreino ? ` <a class="selo acento" href="#/treino/${emTreino.id}">em treino</a>` : ''}${e.fixa ? ' <span class="dica">sempre ativa</span>' : ''}${!e.principal ? ' <span class="dica erro">sem IA: escolha uma</span>' : ''}${e.criadaPeloGestor ? ` <span class="dica">criada pelo gestor${e.projetoId ? ` para ${esc(projetoNome(e.projetoId))}` : ''}</span>` : ''}</span><small>${esc(e.desc)}</small>${e.foco || e.contextos?.length ? `<small class="eq-foco">${e.foco ? `Foco: ${esc(e.foco)}` : ''}${e.contextos?.length ? `${e.foco ? ' · ' : ''}Contextos: ${e.contextos.map(esc).join(', ')}` : ''}</small>` : ''}${desempenhoEquipe(e)}</div>
          <div class="grupo"><label for="p-${e.id}">IA principal ${ajuda('A IA que faz o trabalho desta equipe.')}</label><select class="campo" id="p-${e.id}" data-mudar="equipe" data-id="${e.id}" data-campo="principal">${opcoesIA(e.principal)}</select></div>
          <div class="grupo"><label for="r-${e.id}">Reserva ${ajuda('Assume se a principal falhar ou ficar sem cota. Se a reserva também falhar, o gestor tenta qualquer outra IA disponível.')}</label><select class="campo" id="r-${e.id}" data-mudar="equipe" data-id="${e.id}" data-campo="reserva">${opcoesIA(e.reserva, true)}</select></div>
          ${comAjuda(`<label class="check"><input type="checkbox" data-mudar="equipe" data-id="${e.id}" data-campo="aprovacao" ${e.aprovacao ? 'checked' : ''}>Pedir minha aprovação</label>`, 'Antes desta equipe começar uma etapa, a tarefa para e espera você liberar ou pular.')}
          ${comAjuda(`<label class="check"><input type="checkbox" data-mudar="equipe" data-id="${e.id}" data-campo="ativa" ${e.ativa !== false ? 'checked' : ''} ${e.fixa ? 'disabled' : ''}>Ativa</label>`, e.fixa ? 'Gestor e avaliador fazem parte de toda tarefa e não podem ser desligados.' : 'Desligada, o gestor não usa esta equipe nos próximos planos.')}
          ${['gestor', 'avaliador'].includes(e.id) ? '' : e.id === 'treinador' ? `<a class="btn contorno pequeno" href="#/treinar/treinador" data-dica="Forma o Treinador como um professor: outra IA aplica uma prova de ensino e o melhor método passa a guiar todos os treinos.">Treinar o Treinador</a>` : `<a class="btn contorno pequeno" href="#/treinar/${esc(e.id)}" data-dica="Treina esta equipe num foco: o Treinador cria casos de teste, cópias da equipe competem e a melhor vira a versão oficial.">Treinar</a>`}
          <button type="button" class="link" data-acao="abrir" data-chave="eq-${e.id}" aria-expanded="${aberto}">${aberto ? 'Fechar' : 'Detalhes'}</button>
          ${
            aberto
              ? `<div class="detalhes">
            <div class="grupo"><label for="d-${e.id}">O que faz</label><input class="campo" id="d-${e.id}" value="${esc(e.desc)}" data-mudar="equipe" data-id="${e.id}" data-campo="desc"></div>
            <div class="grupo"><label for="a-${e.id}">Agentes internos ${ajuda('Os papéis que o supervisor desta equipe pode coordenar dentro da própria IA. Só descreve, não cria terminais.')}</label><input class="campo" id="a-${e.id}" value="${esc(e.agentes)}" data-mudar="equipe" data-id="${e.id}" data-campo="agentes"></div>
            ${e.fixa ? '' : `<div class="grupo"><label for="f-${e.id}">Família ${ajuda('Agrupa equipes do mesmo assunto (ex.: Segurança). Cada uma continua independente.')}</label><input class="campo" id="f-${e.id}" list="familias" value="${esc(e.familia ?? '')}" data-mudar="equipe" data-id="${e.id}" data-campo="familia" placeholder="Ex.: Segurança"></div>
            <div class="grupo" style="flex:2 1 320px"><label for="fo-${e.id}">Foco / especialidade ${ajuda('O gestor usa isso para escolher a equipe mais específica para cada pedido.')}</label><input class="campo" id="fo-${e.id}" value="${esc(e.foco ?? '')}" data-mudar="equipe" data-id="${e.id}" data-campo="foco" placeholder="Ex.: segurança de eventos noturnos"></div>
            <div class="grupo" style="flex-basis:100%"><label for="c-${e.id}">Contextos (separados por vírgula) ${ajuda('Palavras de quando usar esta equipe. Ex.: balada, show, portaria, lotação.')}</label><input class="campo" id="c-${e.id}" value="${esc((e.contextos ?? []).join(', '))}" data-mudar="equipe" data-id="${e.id}" data-campo="contextos"></div>`}
            <div class="grupo" style="flex-basis:100%"><label for="i-${e.id}">Instruções da equipe${e.treino?.nota ? ` <span class="dica">(vieram do treino ${esc(e.treino.id)})</span>` : ''}</label><textarea class="campo" id="i-${e.id}" rows="10" data-mudar="equipe" data-id="${e.id}" data-campo="instrucoes" placeholder="Regras que o supervisor sempre segue.">${esc(e.instrucoes)}</textarea></div>
            <div class="grupo" style="flex-basis:100%"><label for="cm-${e.id}">Caminho na árvore do cérebro ${ajuda('Categoria > Subcategoria > Domínio > Especialidade. Organiza o mapa do cérebro (20-areas/_mapa.md) e diz à equipe por onde começar a procurar.')}</label><input class="campo" id="cm-${e.id}" data-mudar="equipe" data-id="${e.id}" data-campo="caminho" value="${esc((e.caminho ?? []).join(' > '))}" placeholder="Ex.: Desenvolvimento > Interno > Qualidade > Código limpo"></div>
            ${(() => {
              const herdadas = (S.d.skills ?? []).filter((k) => k.todas || k.equipes.includes(e.id));
              return `<div class="grupo" style="flex-basis:100%"><span class="dica">Skills: ${herdadas.length ? herdadas.map((k) => `<a href="#/skills/${esc(k.id)}">${esc(k.nome)}</a>`).join(', ') : 'nenhuma'} · <a href="#/skills">Central de skills</a></span></div>`;
            })()}
            ${comAjuda(`<label class="check"><input type="checkbox" data-mudar="equipe" data-id="${e.id}" data-campo="requer" ${e.requer === 'editar' ? 'checked' : ''}>Precisa editar arquivos</label>`, 'Marcado, esta equipe só recebe IAs que conseguem alterar o projeto. O Ollama, por exemplo, só conversa e fica de fora.')}
            <span class="dica">Área no vault: <span class="mono acento">20-areas/${esc(e.area)}</span></span>
            ${treinos.length ? `<div class="empilha" style="flex-basis:100%;gap:4px"><span class="rotulo">Treinos</span>${treinos.slice(0, 6).map((t) => `<a href="#/treino/${t.id}" class="dica" style="color:var(--acento-texto)">${esc(t.id)} · ${esc(t.estado)}${t.melhor ? ` · melhor ${t.melhor.media}/100` : ''}${t.aplicado ? ' · aplicado' : ''}</a>`).join('')}</div>` : ''}
            ${e.versoes?.length ? `<button type="button" class="link" data-acao="tr-desfazer" data-equipe="${e.id}">Desfazer último treino aplicado</button>` : ''}
            ${e.fixa ? '' : `<button type="button" class="link mudo" data-acao="remover-equipe" data-id="${e.id}">Remover equipe</button>`}
          </div>`
              : ''
          }
        </div>`;
};

// ------------------------------------------------------------------ tela: IAs

const telaIAs = {
  montar() {
    const tipos = S.d.sistema.tipos ?? {};
    $('#app').innerHTML = `<div class="pagina">
      <div class="pagina-cab"><h1>IAs</h1><a class="btn pequeno" href="#/comecar">Escolher IAs</a><button type="button" class="btn contorno pequeno" data-acao="detectar">Procurar de novo neste computador</button><button type="button" class="btn texto pequeno" data-acao="diagnostico" data-dica="Gera um arquivo .txt com tudo o que este computador está vendo (versões, onde cada IA está, teste de cada uma e os registros). Sem senhas nem chaves.">Gerar diagnóstico</button></div>
      <p class="intro">Qualquer IA que rode no terminal entra aqui. O sistema usa as assinaturas e logins que você já tem em cada ferramenta: nenhuma API paga é chamada à parte. Chaves e variáveis ficam só no servidor e nunca voltam para a tela.</p>
      <section class="empilha" style="gap:16px;padding:22px;border-radius:14px;background:var(--sup-3)" aria-label="Headroom">
        <div id="r-headroom"></div>
        <details><summary class="link" style="cursor:pointer">Log do Headroom</summary><div class="log" id="log-headroom" style="margin-top:10px" aria-live="polite"></div></details>
        <pre class="nota" id="r-economia" style="display:none"></pre>
      </section>
      <section class="empilha" style="gap:12px;padding:22px;border-radius:14px;background:var(--sup-3)" aria-label="Modelo por dificuldade">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px 24px">
          <div class="nome" style="display:flex;flex-direction:column;gap:4px;flex:1 1 320px">
            <span class="serif" style="font-size:22px">Modelo por dificuldade</span>
            <small style="font-size:14px;color:var(--suave);line-height:1.45">O gestor diz se cada etapa é simples, média ou difícil, e a etapa roda no modelo rápido, padrão ou forte da IA. Equipe treinada ou com conhecimento validado desce um nível; equipe que vem errando sobe. Se o avaliador reprovar, as etapas são refeitas uma vez no forte. Treinos usam o forte para consolidar o conhecimento.</small>
          </div>
          <label class="check"><input type="checkbox" data-mudar="niveis-auto" ${S.d.niveisModelo?.automatico !== false ? 'checked' : ''}>Escolher o modelo pela dificuldade</label>
          <a class="btn contorno pequeno" href="#/consumo">Ver consumo</a>
        </div>
        <span class="dica">Os modelos de cada nível ficam em Configurar, em cada IA. Pedido trivial (uma pergunta rápida) vai direto no modelo rápido, sem avaliador.</span>
      </section>
      <section class="empilha" style="gap:12px;padding:22px;border-radius:14px;background:var(--sup-3)" aria-label="Comandos liberados">
        <div class="nome" style="display:flex;flex-direction:column;gap:4px">
          <span class="serif" style="font-size:22px">Comandos que as IAs podem rodar</span>
          <small style="font-size:14px;color:var(--suave);line-height:1.45">As IAs trabalham sem tela, então não conseguem pedir a sua aprovação: o comando que não estiver nesta lista é recusado na hora. Vale para o Claude Code. Um por linha ou separados por vírgula (ex.: npm, npx, tsc, git status). Deixe vazio para não liberar nenhum.</small>
        </div>
        <textarea class="campo" id="r-comandos" rows="3" style="font-family:var(--mono);font-size:13px">${esc((S.d.comandosLiberados ?? []).join(', '))}</textarea>
        <div><button type="button" class="btn pequeno" data-acao="salvar-comandos">Salvar comandos</button></div>
      </section>
      <div class="linhas" id="r-ias"></div>
      <h2 class="titulo" style="font-size:26px;margin-top:20px">Cadastrar IA</h2>
      <form class="form-nova" data-form="ia">
        <div class="grupo"><label for="ni-tipo">Tipo</label><select class="campo" id="ni-tipo" name="tipo" data-mudar="tipo-nova">${Object.entries(tipos)
          .filter(([k]) => k !== 'simulado')
          .map(([k, v]) => `<option value="${k}">${esc(v.rotulo)}</option>`)
          .join('')}</select></div>
        <div class="grupo"><label for="ni-nome">Nome</label><input class="campo" id="ni-nome" name="nome" placeholder="Ex.: Claude da conta do trabalho"></div>
        <div class="grupo"><label for="ni-cmd">Comando</label><input class="campo mono" id="ni-cmd" name="comando" placeholder="padrão do tipo"></div>
        <div class="grupo"><label for="ni-modelo">Modelo (se houver)</label><input class="campo mono" id="ni-modelo" name="modelo"></div>
        <div class="grupo largo"><label for="ni-args">Argumentos</label><input class="campo mono" id="ni-args" name="args" placeholder="${esc((tipos.claude?.args ?? []).join(' '))}"><span class="dica">Use {prompt} onde entra a instrução e {modelo} para o modelo. Em branco, usa o padrão do tipo.</span></div>
        <div class="grupo largo"><label for="ni-env">Variáveis de ambiente, uma por linha</label><textarea class="campo mono" id="ni-env" name="env" rows="2" placeholder="OPENAI_API_KEY=..."></textarea><span class="dica">Útil para outra pasta de configuração, ex.: CLAUDE_CONFIG_DIR=~/.claude-trabalho. Para outra conta do Claude, use "Adicionar conta" em Contas do Claude.</span></div>
        <label class="check"><input type="checkbox" name="arquivos" checked>Lê arquivos do disco</label>
        <label class="check"><input type="checkbox" name="editar" checked>Edita o projeto</label>
        <div class="cresce"></div>
        <button class="btn" type="submit">${I.mais}Cadastrar</button>
      </form>
    </div>`;
    this.atualizar(true);
    this.terminal('headroom');
  },
  terminal(eq) {
    if (eq !== 'headroom') return;
    const log = $('#log-headroom');
    if (!log) return;
    log.innerHTML = htmlLog('headroom');
    rolarLog(log);
  },
  headroom() {
    const caixa = $('#r-headroom');
    if (!caixa || caixa.contains(document.activeElement) && document.activeElement.matches('input[type=number]')) return;
    const h = S.d.headroom ?? {};
    const comp = S.d.ias.filter((i) => (h.compativeis ?? []).includes(i.tipo));
    const status = h.instalando ? ['var(--acento)', 'instalando…'] : !h.instalado ? ['#4a4a55', 'não instalado'] : h.usar ? (h.rodando ? ['var(--ok)', `proxy no ar em 127.0.0.1:${h.porta}`] : ['var(--espera)', 'ligado, mas o proxy não está no ar']) : ['#4a4a55', 'instalado, desligado'];
    caixa.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px 24px">
        <span class="ponto" style="background:${status[0]}"></span>
        <div class="nome" style="display:flex;flex-direction:column;gap:4px;flex:1 1 320px">
          <span class="serif" style="font-size:22px">Headroom</span>
          <small style="font-size:14px;color:var(--suave);line-height:1.45">Comprime o contexto (saídas de ferramentas, arquivos lidos, histórico) antes de ir para o provedor. Gasta menos da cota da sua assinatura. Roda local, sem custo.</small>
        </div>
        <span class="selo" style="color:${status[0]}">${esc(status[1])}</span>
        ${h.instalado ? '' : `<label class="check"><input type="checkbox" id="hr-completo" ${h.instalando ? 'disabled' : ''}>Versão completa</label><button type="button" class="btn pequeno" data-acao="hr-instalar" ${h.instalando ? 'disabled' : ''}>${h.instalando ? 'Instalando…' : 'Instalar Headroom'}</button>`}
      </div>
      ${S.hrRecusado && !h.instalado ? `<p class="dica erro" style="margin-top:10px">Sem o ${esc(S.hrRecusado)} não é possível usar o Headroom. Quando quiser, clique em Instalar Headroom de novo e permita a instalação.</p>` : h.erro ? `<p class="dica erro" style="margin-top:10px">${esc(h.erro)}</p>` : ''}
      ${
        h.instalado
          ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px 28px;margin-top:16px">
        <label class="check"><input type="checkbox" data-mudar="hr-usar" ${h.usar ? 'checked' : ''}><span style="display:flex;flex-direction:column;gap:2px"><span>Usar Headroom ${ajuda('Liga um proxy local que comprime o que é enviado à IA. Menos tokens por pedido, mais tarefas na mesma cota.')}</span><span class="dica">Sobe o proxy junto com o app.</span></span></label>
        <div class="grupo" style="flex:0 0 120px"><label for="hr-porta">Porta</label><input class="campo mono" id="hr-porta" type="number" min="1024" max="65535" value="${esc(h.porta)}" data-mudar="hr-porta"></div>
        <fieldset style="border:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center">
          <legend class="dica" style="margin-bottom:8px">Passar pelo Headroom</legend>
          ${comp.map((i) => `<label class="check"><input type="checkbox" data-mudar="hr-ia" value="${esc(i.id)}" ${(h.ias ?? []).includes(i.id) ? 'checked' : ''} ${h.usar ? '' : 'disabled'}>${esc(i.nome)}</label>`).join('') || '<span class="dica">Nenhuma IA compatível cadastrada.</span>'}
        </fieldset>
        <div class="cresce"></div>
        <button type="button" class="link" data-acao="hr-economia">Ver economia</button>
      </div>
      <p class="dica" style="margin-top:10px">Compatível com Claude Code, Codex e CLIs que aceitem ANTHROPIC_BASE_URL ou OPENAI_BASE_URL. Antigravity e Ollama seguem direto.</p>`
          : `<p class="dica" style="margin-top:10px">Precisa do Python. Se não houver, perguntamos antes e instalamos só para o seu usuário. A versão padrão traz o proxy; a completa inclui o modelo de compressão de texto e baixa vários GB (PyTorch).</p>`
      }`;
  },
  atualizar(forcar) {
    this.headroom();
    const caixa = $('#r-ias');
    if (!forcar && digitandoEm(caixa)) return;
    const tipos = S.d.sistema.tipos ?? {};
    caixa.innerHTML = S.d.ias
      .map((i) => {
        const aberto = S.abertos.has(`ia-${i.id}`);
        const limitada = i.limiteAte && Date.parse(i.limiteAte) > Date.now();
        const pronto = i.tipo === 'simulado' || i.status === 'pronto';
        const [cor, status] = i.problema && i.ativa ? ['var(--erro)', 'com problema'] : limitada ? ['var(--espera)', 'sem cota'] : pronto ? ['var(--ok)', i.ativa ? 'pronta' : 'desligada'] : ['#4a4a55', 'não encontrada'];
        const usadas = ['gestor', ...S.d.equipes.map((e) => e.id)].filter((id, k, a) => a.indexOf(id) === k).map(equipe).filter((e) => e && (e.principal === i.id || e.reserva === i.id));
        return `<div class="linha">
          <span class="ponto" style="background:${cor}"></span>
          <div class="nome"><span>${esc(i.nome)}</span><small>${esc(tipos[i.tipo]?.rotulo ?? i.tipo)} · ${i.tipo === 'simulado' ? 'respostas de demonstração' : esc(i.caminho ?? `comando "${i.comando || tipos[i.tipo]?.comando || i.tipo}" não encontrado`)}${usadas.length ? ` · usada por ${usadas.map((e) => esc(e.nome)).join(', ')}` : ''}</small>${i.problema && i.ativa ? `<small class="erro">Com problema: ${esc(i.problema.motivo)}. O gestor não usa até ela passar no Testar.</small>` : ''}</div>
          <span class="selo" style="color:${cor}">${status}${i.uso ? ` · ${i.uso.chamadas} chamadas, ${i.uso.falhas} falhas` : ''}</span>
          ${comAjuda(`<label class="check"><input type="checkbox" data-mudar="ia" data-id="${i.id}" data-campo="ativa" ${i.ativa ? 'checked' : ''}>Usar</label>`, 'Desmarcada, o gestor não manda trabalho para esta IA. Agentes da tela livre que já usam ela continuam funcionando.')}
          ${limitada ? `<button type="button" class="link" data-acao="liberar-cota" data-id="${i.id}">Liberar agora</button>` : ''}
          ${S.d.planos[i.tipo] && !pronto ? `<button type="button" class="btn pequeno" data-acao="ia-instalar" data-id="${i.id}" data-dica="Mostra o comando e, se você confirmar, instala num terminal aqui dentro.">Instalar</button>` : ''}
          ${S.d.planos[i.tipo] && pronto ? `<button type="button" class="link" data-acao="ia-entrar" data-id="${i.id}" data-dica="${esc(S.d.planos[i.tipo].entrar.dica)}">${esc(S.d.planos[i.tipo].entrar.rotulo)}</button>` : ''}
          <button type="button" class="link" data-acao="testar-ia" data-id="${i.id}" data-dica="Manda um pedido curto para conferir se a IA responde e se o login está ok.">Testar</button>
          <button type="button" class="link" data-acao="abrir" data-chave="ia-${i.id}" aria-expanded="${aberto}">${aberto ? 'Fechar' : 'Configurar'}</button>
          ${
            aberto
              ? `<form class="detalhes" data-form="editar-ia" data-id="${i.id}">
            <div class="grupo"><label for="in-${i.id}">Nome</label><input class="campo" id="in-${i.id}" name="nome" value="${esc(i.nome)}"></div>
            <div class="grupo"><label for="ic-${i.id}">Comando</label><input class="campo mono" id="ic-${i.id}" name="comando" value="${esc(i.comando)}" placeholder="padrão do tipo"></div>
            <div class="grupo"><label for="im-${i.id}">Modelo</label><input class="campo mono" id="im-${i.id}" name="modelo" value="${esc(i.modelo)}"></div>
            ${
              tipos[i.tipo]?.niveis
                ? `<fieldset class="niveis-ia" style="flex-basis:100%;border:none;margin:0;padding:0;display:flex;gap:12px;flex-wrap:wrap"><legend class="dica" style="margin-bottom:6px">Modelo de cada nível ${ajuda('Nome do modelo que a ferramenta aceita (ex.: haiku, sonnet, opus no Claude Code). Vazio usa o padrão da própria ferramenta. Se a sua conta não tiver um modelo, o app usa o padrão e avisa.')}</legend>${['rapido', 'padrao', 'forte']
                    .map((n) => `<div class="grupo" style="flex:1 1 150px"><label for="iv-${n}-${i.id}">${NOME_NIVEL[n][0].toUpperCase() + NOME_NIVEL[n].slice(1)}</label><input class="campo mono" id="iv-${n}-${i.id}" name="nivel-${n}" value="${esc(i.niveis?.[n] ?? tipos[i.tipo].niveis[n] ?? '')}" placeholder="padrão da ferramenta"></div>`)
                    .join('')}</fieldset>`
                : ''
            }
            <div class="grupo" style="flex-basis:100%"><label for="ia-${i.id}">Argumentos para o gestor (sem interação)</label><input class="campo mono" id="ia-${i.id}" name="args" value="${esc((i.args ?? []).join(' '))}" placeholder="${esc((tipos[i.tipo]?.args ?? []).join(' '))}"></div>
            <div class="grupo" style="flex-basis:100%"><label for="ii-${i.id}">Argumentos no terminal interativo (tela livre)</label><input class="campo mono" id="ii-${i.id}" name="argsInterativo" value="${esc((i.argsInterativo ?? []).join(' '))}" placeholder="${esc((tipos[i.tipo]?.interativo ?? []).join(' ') || 'nenhum')}"></div>
            <div class="grupo" style="flex-basis:100%"><label for="ie-${i.id}">Variáveis de ambiente</label><textarea class="campo mono" id="ie-${i.id}" name="env" rows="2" placeholder="CHAVE=valor">${esc((i.env ?? []).map((k) => `${k}=${i.envVisivel?.[k] ?? '••••'}`).join('\n'))}</textarea><span class="dica">Chaves e senhas salvas aparecem como ••••. Deixe assim para manter.</span></div>
            <label class="check"><input type="checkbox" name="arquivos" ${i.capacidades?.arquivos ? 'checked' : ''}>Lê arquivos do disco</label>
            <label class="check"><input type="checkbox" name="editar" ${i.capacidades?.editar ? 'checked' : ''}>Edita o projeto</label>
            <div class="cresce"></div>
            ${i.tipo === 'simulado' ? '' : `<button type="button" class="link mudo" data-acao="remover-ia" data-id="${i.id}">Remover</button>`}
            <button class="btn pequeno" type="submit">Salvar</button>
          </form>${htmlContas(i)}`
              : ''
          }
        </div>`;
      })
      .join('');
  },
};

// Pool de contas da IA: quando uma bate o limite, a próxima assume na hora.
const htmlContas = (i) => {
  if (['shell', 'simulado', 'custom'].includes(i.tipo)) return '';
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const situacao = (c) =>
    c.problema ? `<span class="erro">com problema: ${esc(c.problema.motivo ?? '')}</span>` : c.limiteAte && Date.parse(c.limiteAte) > Date.now() ? `<span style="color:var(--espera)">sem cota até ${hora(c.limiteAte)}</span>` : c.desligada ? '<span class="dica">desligada</span>' : '<span style="color:var(--ok)">livre</span>';
  const principal = { id: 'principal', nome: 'Conta principal', ...(i.contaPrincipal ?? {}), descricao: 'o login padrão desta ferramenta' };
  const podeEntrar = !!S.d.planos[i.tipo];
  const linha = (c) => `<div class="conta-linha">
      <span class="conta-nome"><b>${esc(c.nome)}</b><small>${c.id === 'principal' ? esc(c.descricao) : c.perfil ? `perfil separado${c.pasta ? ` · ${esc(c.pasta)}` : ''}` : `chave: ${esc((c.env ?? []).join(', '))}`}</small></span>
      <span class="conta-sit">${situacao(c)}</span>
      ${c.id !== 'principal' && c.perfil && podeEntrar ? `<button type="button" class="link" data-acao="conta-entrar" data-id="${i.id}" data-conta="${esc(c.id)}">Entrar nesta conta</button>` : ''}
      <button type="button" class="link" data-acao="conta-testar" data-id="${i.id}" data-conta="${esc(c.id)}">Testar</button>
      ${(c.limiteAte && Date.parse(c.limiteAte) > Date.now()) || c.problema ? `<button type="button" class="link" data-acao="conta-liberar" data-id="${i.id}" data-conta="${esc(c.id)}">Liberar</button>` : ''}
      ${c.id !== 'principal' ? `<button type="button" class="link mudo" data-acao="conta-remover" data-id="${i.id}" data-conta="${esc(c.id)}">Remover</button>` : ''}
    </div>`;
  const exemploChave = { claude: 'ANTHROPIC_API_KEY=sk-ant-...', codex: 'OPENAI_API_KEY=sk-...', antigravity: 'GEMINI_API_KEY=sua-chave' }[i.tipo] ?? 'CHAVE=valor';
  return `<div class="contas-ia">
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span class="rotulo">Contas desta IA</span>${ajuda('Quando uma conta bate o limite de uso, o app troca na hora para a próxima conta livre da lista, sem parar a tarefa. O contexto não se perde: está no cérebro. Só quando todas batem o limite a tarefa passa para a IA reserva.')}<span class="dica">${(i.contas?.length ?? 0) + 1} ${(i.contas?.length ?? 0) ? 'contas em rodízio' : 'conta'}</span></div>
    ${[principal, ...(i.contas ?? [])].map(linha).join('')}
    <form class="conta-nova" data-form="conta-nova" data-id="${i.id}">
      <div class="grupo" style="flex:1 1 180px"><label for="cn-n-${i.id}">Nova conta</label><input class="campo" id="cn-n-${i.id}" name="nome" placeholder="Ex.: Google do trabalho"></div>
      <div class="grupo" style="flex:2 1 280px"><label for="cn-e-${i.id}">Chave da conta (opcional se usar perfil)</label><input class="campo mono" id="cn-e-${i.id}" name="env" placeholder="${esc(exemploChave)}"></div>
      ${PERFIL_TIPOS.includes(i.tipo) ? comAjuda(`<label class="check"><input type="checkbox" name="perfil" checked>Perfil separado</label>`, 'Cria uma pasta só desta conta, onde a ferramenta guarda o login. Depois clique em "Entrar nesta conta" e faça o login com a outra conta Google.') : ''}
      <button class="btn contorno pequeno" type="submit">Adicionar conta</button>
    </form>
  </div>`;
};
const PERFIL_TIPOS = ['claude', 'codex', 'antigravity'];

// ------------------------------------------------------------------ tela: central de skills

const telaSkills = {
  montar(arg) {
    this.editando = arg ? decodeURIComponent(arg) : null;
    $('#app').innerHTML = `<div class="pagina" id="r-skills"></div>`;
    this.carregar();
  },
  atualizar() {},
  async carregar() {
    try {
      this.lista = await api('GET', '/api/skills');
    } catch {
      this.lista = [];
    }
    this.desenhar();
  },
  desenhar() {
    const caixa = $('#r-skills');
    if (!caixa) return;
    const sk = this.lista.find((k) => k.id === this.editando) ?? null;
    const equipesTrabalho = S.d.equipes.filter((e) => e.id !== 'gestor');
    caixa.innerHTML = `
      <div class="pagina-cab"><h1>Central de skills</h1><a class="btn texto pequeno" href="#/equipes">← Equipes</a></div>
      <p class="intro">Uma skill é uma habilidade modular: um checklist, um roteiro, um jeito de fazer que você quer que as equipes sigam. Ela fica no cérebro (40-skills) e vai junto nas instruções das equipes que a herdam, em toda tarefa.</p>
      <div class="skills-grade">
        <div class="empilha" style="gap:8px">
          <button type="button" class="btn ${sk ? 'contorno' : ''} pequeno" data-acao="skill-nova" style="align-self:flex-start">${I.mais}Nova skill</button>
          ${
            this.lista.length
              ? this.lista
                  .map(
                    (k) => `<a class="skill-item ${k.id === this.editando ? 'sel' : ''}" href="#/skills/${esc(k.id)}"><b>${esc(k.nome)}</b><small>${esc(k.descricao || 'sem descrição')}</small><small class="dica">${k.todas ? 'todas as equipes' : k.equipes.length ? k.equipes.map((id) => esc(S.d.equipes.find((e) => e.id === id)?.nome ?? id)).join(', ') : 'nenhuma equipe'}</small></a>`,
                  )
                  .join('')
              : '<p class="dica">Nenhuma skill ainda. Crie a primeira ao lado.</p>'
          }
        </div>
        <form class="empilha skill-form" data-form="skill" data-id="${esc(sk?.id ?? '')}" style="gap:16px">
          <h2 class="titulo" style="font-size:24px;margin:0">${sk ? `Editar: ${esc(sk.nome)}` : 'Nova skill'}</h2>
          <div class="grupo"><label for="sk-nome">Nome</label><input class="campo" id="sk-nome" name="nome" required value="${esc(sk?.nome ?? '')}" placeholder="Ex.: Revisão de PR"></div>
          <div class="grupo"><label for="sk-desc">Quando usar ${ajuda('Uma frase dizendo em que situação a equipe deve aplicar esta skill.')}</label><input class="campo" id="sk-desc" name="descricao" value="${esc(sk?.descricao ?? '')}" placeholder="Ex.: sempre que a etapa alterar código existente"></div>
          <div class="grupo"><label for="sk-cont">Conteúdo ${ajuda('O que a skill ensina: passos, checklist, regras, modelos de resposta, comandos. Em markdown.')}</label><textarea class="campo mono" id="sk-cont" name="conteudo" rows="14" required style="font-size:13px" placeholder="1. Leia o diff inteiro antes de comentar.&#10;2. Confira nomes, tamanho das funções e testes.&#10;3. Aponte cada problema com arquivo, linha e a correção.">${esc(sk?.conteudo ?? '')}</textarea></div>
          <fieldset style="border:none;margin:0;padding:0" class="empilha">
            <legend class="rotulo" style="margin-bottom:8px">Quem herda</legend>
            <label class="check"><input type="checkbox" name="todas" ${sk?.todas ? 'checked' : ''}>Todas as equipes</label>
            <div class="skills-equipes">${equipesTrabalho.map((e) => `<label class="check"><input type="checkbox" name="equipes" value="${esc(e.id)}" ${sk?.equipes.includes(e.id) ? 'checked' : ''}>${esc(e.nome)}</label>`).join('')}</div>
          </fieldset>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <button class="btn" type="submit">Salvar skill</button>
            ${sk ? `<button type="button" class="btn texto" data-acao="skill-remover" data-id="${esc(sk.id)}">Remover</button><span class="dica mono" style="font-size:12px">${esc(sk.caminho)}</span>` : ''}
          </div>
        </form>
      </div>`;
  },
};

// ------------------------------------------------------------------ tela: histórico de solicitações

const ROTULO_ESTADO = { fila: 'na fila', planejando: 'planejando', executando: 'em andamento', esperando: 'esperando você', revisao: 'para revisar', concluida: 'concluída', cancelada: 'cancelada', falhou: 'parou com erro' };
const telaHistorico = {
  montar() {
    this.busca = this.busca ?? '';
    this.estado = this.estado ?? 'todas';
    $('#app').innerHTML = `<div class="pagina">
      <div class="pagina-cab"><h1>Histórico</h1></div>
      <p class="intro">Todas as solicitações${S.proj === 'todos' ? '' : ` de ${esc(projetoNome(S.proj))}`}, da mais nova para a mais antiga. Abra uma para ver o que as equipes responderam, perguntar de novo ou reler a nota no cérebro.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        <input class="campo" id="hs-busca" type="search" placeholder="Procurar no pedido ou nas respostas…" value="${esc(this.busca)}" style="flex:1 1 320px;height:40px" aria-label="Procurar">
        <select class="campo" id="hs-estado" style="height:40px;width:auto" aria-label="Filtrar por situação">${[
          ['todas', 'Todas'],
          ['concluida', 'Concluídas'],
          ['revisao', 'Para revisar'],
          ['andamento', 'Em andamento e na fila'],
          ['falhou', 'Com erro'],
          ['cancelada', 'Canceladas'],
        ]
          .map(([v, r]) => `<option value="${v}" ${v === this.estado ? 'selected' : ''}>${r}</option>`)
          .join('')}</select>
      </div>
      <div id="hs-lista" class="hs-lista"></div>
    </div>`;
    $('#hs-busca').addEventListener('input', (e) => {
      this.busca = e.target.value;
      this.atualizar();
    });
    $('#hs-estado').addEventListener('change', (e) => {
      this.estado = e.target.value;
      this.atualizar();
    });
    this.atualizar();
  },
  atualizar() {
    const caixa = $('#hs-lista');
    if (!caixa) return;
    const termo = this.busca.trim().toLowerCase();
    const grupo = { andamento: ['fila', 'planejando', 'executando', 'esperando'] };
    const lista = S.d.tarefas
      .filter(doProjeto)
      .filter((t) => this.estado === 'todas' || (grupo[this.estado] ?? [this.estado]).includes(t.estado))
      .filter((t) => !termo || [t.texto, t.titulo, t.id, ...(t.plano ?? []).flatMap((p) => [p.resumo, p.resposta]), ...(t.conversa ?? []).flatMap((c) => [c.pergunta, c.resposta])].some((x) => String(x ?? '').toLowerCase().includes(termo)))
      .sort((a, b) => (b.criada ?? '').localeCompare(a.criada ?? ''));
    const data = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
    caixa.innerHTML = lista.length
      ? lista
          .map((t) => {
            const equipes = [...new Set((t.plano ?? []).map((p) => equipe(p.equipe)?.nome ?? p.equipe))].filter((n) => n && n !== 'Avaliador');
            return `<a class="hs-item" href="#/tarefa/${esc(t.id)}">
              <div class="hs-topo"><span class="dica">${esc(t.id)} · ${esc(projetoNome(t.projetoId))} · ${data(t.criada)}</span><span class="cresce"></span><span class="selo ${corFase(t)}">${esc(ROTULO_ESTADO[t.estado] ?? t.estado)}</span></div>
              <span class="hs-tit">${esc(t.titulo)}</span>
              ${equipes.length || t.conversa?.length ? `<span class="dica">${equipes.length ? `Equipes: ${equipes.map(esc).join(', ')}` : ''}${t.conversa?.length ? `${equipes.length ? ' · ' : ''}${t.conversa.length} ${t.conversa.length === 1 ? 'pergunta' : 'perguntas'} depois da entrega` : ''}</span>` : ''}
            </a>`;
          })
          .join('')
      : `<p class="vazio">${termo || this.estado !== 'todas' ? 'Nada encontrado com esse filtro.' : 'Nenhuma solicitação ainda.'}</p>`;
  },
};

// ------------------------------------------------------------------ tela: consumo

const telaConsumo = {
  montar() {
    this.dias = this.dias ?? 7;
    $('#app').innerHTML = `<div class="pagina" id="r-consumo"><p class="dica">Carregando…</p></div>`;
    this.carregar();
  },
  atualizar() {},
  async carregar() {
    const c = await api('GET', `/api/consumo?dias=${this.dias}`);
    const caixa = $('#r-consumo');
    if (!caixa) return;
    const mil = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} mi` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n));
    const tabela = (titulo, linhas, nome = (x) => x.chave) =>
      linhas.length
        ? `<section class="empilha"><h2 class="rotulo">${titulo}</h2><table class="consumo-tabela"><thead><tr><th>Nome</th><th class="num">Chamadas</th><th class="num">Tokens enviados</th><th class="num">Tokens recebidos</th><th class="num">Tempo</th></tr></thead><tbody>${linhas
            .map((x) => `<tr><td>${nome(x)}</td><td class="num">${x.chamadas}</td><td class="num">${mil(x.entrada)}</td><td class="num">${mil(x.saida)}</td><td class="num">${x.ms < 60000 ? `${Math.round(x.ms / 1000)} s` : `${Math.round(x.ms / 60000)} min`}</td></tr>`)
            .join('')}</tbody></table></section>`
        : '';
    const nomeTarefa = (x) => {
      const t = S.d.tarefas.find((y) => y.id === x.chave);
      if (t) return `<a href="#/tarefa/${esc(t.id)}">${esc(t.id)} · ${esc(t.titulo.slice(0, 60))}</a>`;
      const tr = S.d.treinos?.find((y) => y.id === x.chave);
      return tr ? `<a href="#/treino/${esc(tr.id)}">${esc(tr.id)} · treino de ${esc(tr.equipeNome)}</a>` : esc(x.chave);
    };
    caixa.innerHTML = `
      <div class="pagina-cab"><h1>Consumo</h1>
        <select class="campo" id="cs-dias" style="height:38px;width:auto">${[1, 7, 30, 90].map((d) => `<option value="${d}" ${d === this.dias ? 'selected' : ''}>Últimos ${d === 1 ? 'um dia' : `${d} dias`}</option>`).join('')}</select>
        <a class="btn texto pequeno" href="#/ias">Ajustar modelos</a></div>
      <p class="intro">Quanto cada equipe, IA e nível de modelo gastou. Tokens são estimados (cerca de 4 caracteres por token) a partir do que foi enviado e recebido; o que a IA lê sozinha do disco não entra.${S.d.niveisModelo?.automatico === false ? ' <b>A escolha de modelo por dificuldade está desligada</b> em IAs.' : ''}</p>
      <div class="consumo-grade">
        <div><b>${c.chamadas}</b><span>chamadas às IAs${c.simuladas ? ` (${c.simuladas} de demonstração)` : ''}</span></div>
        <div><b>~${mil(c.entrada + c.saida)}</b><span>tokens (${mil(c.entrada)} enviados, ${mil(c.saida)} recebidos)</span></div>
        <div><b>${c.economia}%</b><span>mais barato que usar sempre o modelo forte ${ajuda('Compara com o mesmo volume rodando todo no modelo forte, usando a proporção típica de preço entre os níveis (rápido 1, padrão 3, forte 15).')}</span></div>
      </div>
      ${tabela('Por nível de modelo', c.porNivel, (x) => `<span class="selo-nivel ${esc(x.chave)}">${esc(NOME_NIVEL[x.chave] ?? x.chave)}</span>`)}
      ${tabela('Por equipe', c.porEquipe, (x) => esc(equipe(x.chave)?.nome ?? x.chave))}
      ${tabela('Por IA', c.porIA, (x) => esc(x.chave))}
      ${tabela('Tarefas e treinos que mais gastaram', c.porTarefa, nomeTarefa)}
      ${c.chamadas ? '' : '<p class="vazio">Nenhuma chamada no período. Mande uma solicitação e volte aqui.</p>'}`;
    $('#cs-dias').addEventListener('change', (e) => {
      this.dias = Number(e.target.value);
      this.carregar();
    });
  },
};

// ------------------------------------------------------------------ tela: tarefa / entrega

// "Inicializar teste": o ambiente que a equipe preparou, com link, credenciais, roteiro, arquivos e log.
const ROTULO_TESTE = { preparando: 'Preparando', subindo: 'Subindo', corrigindo: 'Corrigindo', 'no-ar': 'No ar', pronto: 'Pronto', falhou: 'Não subiu', parado: 'Parado' };
const htmlTeste = (t) => {
  const x = t.teste;
  if (!x) return '';
  const vivo = ['preparando', 'subindo', 'corrigindo'].includes(x.estado);
  const arquivo = (a) => {
    const url = `/teste/${encodeURIComponent(t.id)}/${a.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
    return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(a)
      ? `<a class="teste-img" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a)}" loading="lazy"><span>${esc(a)}</span></a>`
      : `<a class="arquivo-chip" href="${url}" target="_blank" rel="noopener"><span class="arquivo-ext">${esc((a.split('.').pop() || 'arq').slice(0, 4).toUpperCase())}</span><span class="arquivo-nome"><b>${esc(a)}</b></span></a>`;
  };
  return `<section class="teste-caixa ${esc(x.estado)}" aria-live="polite">
    <div class="teste-topo">
      <span class="ponto ${vivo ? 'cm-pulso' : ''}"></span>
      <b>Teste · ${esc(ROTULO_TESTE[x.estado] ?? x.estado)}</b>
      <span class="dica">${esc(x.fase ?? '')}</span>
      <span class="cresce"></span>
      ${['no-ar', 'subindo', 'preparando'].includes(x.estado) ? `<button type="button" class="btn texto pequeno" data-acao="parar-teste" data-id="${t.id}">Parar</button>` : ''}
      ${['falhou', 'parado', 'pronto', 'no-ar'].includes(x.estado) ? `<button type="button" class="btn texto pequeno" data-acao="testar" data-id="${t.id}">Preparar de novo</button>` : ''}
    </div>
    ${x.fluxo?.passos?.length ? `<ol class="teste-fluxo" aria-label="Fluxo de correção ${x.fluxo.ciclo}">${x.fluxo.passos.map((p) => `<li class="${esc(p.estado)}"><span class="teste-fluxo-marca">${p.estado === 'ok' ? '✓' : p.estado === 'falhou' ? '✗' : p.estado === 'atual' ? '' : ''}</span><span class="empilha" style="gap:1px;min-width:0"><b>${esc(p.nome)}</b><span class="dica">${esc(p.equipe)}${p.resumo ? ` · ${esc(p.resumo)}` : ''}</span></span></li>`).join('')}</ol>` : ''}
    ${x.url && x.estado === 'no-ar' ? `<a class="btn teste-abrir" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir ${esc(x.url.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : ''}
    ${x.resumo ? `<p class="dica" style="margin:0">${esc(x.resumo)}</p>` : ''}
    ${x.credenciais?.length ? `<div class="teste-cred">${x.credenciais.map((c) => `<span class="rotulo">${esc(c.rotulo)}</span><code>${esc(c.valor)}</code><button type="button" class="btn texto pequeno" data-acao="copiar" data-valor="${esc(c.valor)}">Copiar</button>`).join('')}</div>` : ''}
    ${x.passos?.length ? `<div><span class="rotulo">O que testar</span><ol class="teste-passos">${x.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol></div>` : ''}
    ${x.tipo === 'arquivos' || x.tipo === 'estatico' ? `<div class="fotos teste-arquivos">${(x.arquivos ?? []).map(arquivo).join('')}</div>` : ''}
    ${x.estado === 'falhou' ? `<div class="linha" style="gap:10px;flex-wrap:wrap"><button type="button" class="btn contorno pequeno" data-acao="teste-corrigir" data-id="${t.id}">Pedir para a equipe corrigir</button><span class="dica">Gestor faz a triagem, a equipe e a Debug diagnosticam juntas, a equipe corrige, Código limpo revisa e o avaliador confere.</span></div>` : ''}
    ${x.historico?.length ? `<details><summary class="dica">Correções feitas para o teste subir (${x.historico.length})</summary><ul class="teste-passos">${x.historico.map((h) => `<li><b>${esc(h.motivo)}</b><br>${esc(h.correcao)}</li>`).join('')}</ul></details>` : ''}
    <details ${x.estado === 'falhou' || vivo ? 'open' : ''}><summary class="dica">Log do teste</summary><div class="log" id="r-teste-log" style="max-height:260px">${htmlLog(`teste:${t.id}`)}</div></details>
  </section>`;
};

const telaTarefa = {
  terminal(eq) {
    if (eq !== `teste:${this.id}`) return;
    const el = $('#r-teste-log');
    if (!el) return;
    const fim = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    el.innerHTML = htmlLog(eq);
    if (fim) rolarLog(el);
  },
  montar(id) {
    this.id = id;
    this.nota = '';
    S.devolvendo = false;
    $('#app').innerHTML = `<div class="pagina" id="r-tarefa"></div>`;
    this.atualizar(true);
    this.carregarNota();
  },
  async carregarNota() {
    try {
      const { nota } = await api('GET', `/api/tarefas/${this.id}/nota`);
      this.nota = nota;
      const el = $('#r-nota');
      if (el) el.textContent = nota || 'A nota é criada quando o gestor pega a tarefa.';
    } catch {}
  },
  atualizar(forcar) {
    const caixa = $('#r-tarefa');
    if (!caixa) return;
    if (!forcar && caixa.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    const t = S.d.tarefas.find((x) => x.id === this.id);
    if (!t) {
      caixa.innerHTML = `<p class="vazio">Tarefa não encontrada.</p><a href="#/">Voltar às solicitações</a>`;
      return;
    }
    const acoes = [];
    if (t.estado === 'revisao') {
      acoes.push(`<button type="button" class="btn" data-acao="aprovar" data-id="${t.id}">Aprovar entrega</button>`);
      acoes.push(`<p class="dica">Aprovar conclui a tarefa e valida no cérebro o que as equipes aprenderam. ${t.branch ? `O merge da branch ${esc(t.branch)} fica com você.` : ''}</p>`);
      if (t.avaliacao?.aprovado === false) acoes.push(`<button type="button" class="btn contorno" data-acao="corrigir" data-id="${t.id}" data-dica="A equipe recebe o que o avaliador apontou, corrige (ou contesta com evidência) e o avaliador confere de novo. Volta para você só no fim.">Mandar a equipe corrigir</button>`);
      if (!S.devolvendo) acoes.push(`<button type="button" class="btn texto" data-acao="abrir-devolver">Devolver para as equipes</button>`);
    }
    if (['revisao', 'concluida'].includes(t.estado) && !['preparando', 'subindo', 'corrigindo'].includes(t.teste?.estado)) acoes.unshift(`<button type="button" class="btn" data-acao="testar" data-id="${t.id}" data-dica="A equipe que fez prepara tudo (dependências, build, dados e usuário de teste) e o app sobe aqui: você recebe o link, as credenciais e o roteiro para testar antes de aprovar.">${t.teste ? 'Preparar o teste de novo' : 'Inicializar teste'}</button>`);
    acoes.push(`<a class="btn contorno" href="#/comunicacao/${esc(t.id)}" data-dica="Grafo ao vivo (2D ou 3D) do que o gestor, as equipes, as IAs e o avaliador estão mandando entre si nesta tarefa.">Ver comunicação</a>`);
    if (t.estado === 'pausada') acoes.push(`<button type="button" class="btn" data-acao="retomar" data-id="${t.id}" data-dica="Tenta agora, sem esperar a cota renovar (por exemplo, depois de entrar em outra conta).">Tentar agora</button>`);
    if (['executando', 'planejando', 'esperando', 'pausada'].includes(t.estado)) acoes.push(`<button type="button" class="btn contorno" data-acao="cancelar" data-id="${t.id}">Cancelar tarefa</button>`);
    if (['falhou', 'cancelada'].includes(t.estado)) acoes.push(`<button type="button" class="btn" data-acao="retomar" data-id="${t.id}">Tentar de novo de onde parou</button>`);
    if (['fila', 'falhou', 'cancelada', 'concluida'].includes(t.estado)) acoes.push(`<button type="button" class="btn texto" data-acao="remover-tarefa" data-id="${t.id}" data-voltar="1">Remover</button>`);

    caixa.innerHTML = `
      <div class="empilha" style="max-width:900px">
        <span class="dica" style="font-size:14px">${esc(projetoNome(t.projetoId))} · ${esc(t.id)}${t.planejadaPor ? ` · plano de ${esc(t.planejadaPor)}` : ''}</span>
        <h1 class="titulo" style="font-size:40px;letter-spacing:-.4px">${esc(t.titulo)}</h1>
        <p class="frase ${corFase(t)}">${esc(t.fase)}</p>
        ${htmlTeste(t)}
        ${t.estado === 'pausada' ? `<div class="linha" style="gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn" data-acao="retomar" data-id="${t.id}">Tentar agora</button><span class="dica">Se a cota já voltou, ou você entrou em outra conta, continua de onde parou. Se uma IA ainda estiver sem cota, o app tenta outro modelo e outra conta antes de pausar de novo.</span></div>` : ''}
      </div>
      ${t.pergunta ? `<div class="perguntas" style="margin-top:0">${htmlPergunta(t, { mostrarTarefa: false })}</div>` : ''}
      <div class="entrega">
        <div class="principal">
          <section class="empilha"><h2 class="rotulo">Pedido</h2><p style="margin:0;font-family:var(--serif);font-size:19px;line-height:1.5;white-space:pre-wrap">${esc(t.texto)}</p>
            ${t.fotos?.length ? `<div class="fotos">${t.fotos.map((f) => `<a class="foto" href="${urlAnexo(f)}" target="_blank" rel="noopener"><img src="${urlAnexo(f)}" alt="Anexo ${esc(f)}"></a>`).join('')}</div>` : ''}
            ${(t.arquivos ?? []).filter((a) => !/^image\//.test(a.tipo)).length ? `<div class="fotos">${t.arquivos.filter((a) => !/^image\//.test(a.tipo)).map((a) => `<a class="arquivo-chip" href="${urlAnexo(a.arquivo)}" target="_blank" rel="noopener" download="${esc(a.nome)}"><span class="arquivo-ext">${esc((a.nome.split('.').pop() || 'arq').slice(0, 4).toUpperCase())}</span><span class="arquivo-nome"><b>${esc(a.nome)}</b><small>${tamanhoLegivel(a.tamanho)}</small></span></a>`).join('')}</div>` : ''}
          </section>
          ${htmlRespostas(t)}
          ${htmlConversa(t)}
          <section class="empilha"><h2 class="rotulo">Como o gestor dividiu</h2>${htmlPassos(t, { detalhado: true })}</section>
          <section class="empilha"><h2 class="rotulo">Nota no vault <span class="mono" style="font-weight:400">10-tarefas/${esc(t.id)}.md</span></h2><pre class="nota" id="r-nota">${esc(this.nota || '…')}</pre></section>
        </div>
        <aside class="lateral">
          ${
            t.avaliacao
              ? `<div class="empilha"><h2 class="rotulo">O avaliador conferiu ${ajuda('Critérios que o gestor tirou do seu pedido. O avaliador confere cada um antes de a entrega chegar a você.')}</h2><ul class="checks">${(t.avaliacao.criterios.length ? t.avaliacao.criterios : [{ texto: t.avaliacao.resumo, ok: t.avaliacao.aprovado }])
                  .map((c) => `<li><span class="${c.ok ? 'ok' : 'erro'}" aria-hidden="true">${c.ok ? '✓' : '✗'}</span><span>${esc(c.texto)}${c.obs ? `<small class="dica" style="display:block">${esc(c.obs)}</small>` : ''}</span></li>`)
                  .join('')}</ul></div>`
              : t.criterios?.length
                ? `<div class="empilha"><h2 class="rotulo">O avaliador vai conferir</h2><ul class="checks">${t.criterios.map((c) => `<li><span class="dica" aria-hidden="true">○</span><span>${esc(c)}</span></li>`).join('')}</ul></div>`
                : ''
          }
          ${t.avaliacao?.resumo && t.avaliacao.criterios.length ? `<p class="dica" style="margin:-18px 0 0">${esc(t.avaliacao.resumo)}</p>` : ''}
          <div class="empilha" id="r-consumo-tarefa"></div>
          ${t.branch ? `<div class="empilha"><h2 class="rotulo">Worktree</h2><span class="mono acento">${esc(t.branch)}</span><span class="dica">${esc(t.cwd)}</span></div>` : ''}
          <div class="empilha">${acoes.join('')}
            ${
              S.devolvendo
                ? `<form class="empilha" data-form="devolver" data-id="${t.id}">
              <label for="motivo" class="dica" style="font-size:14px">O que precisa mudar?</label>
              <textarea id="motivo" name="motivo" rows="3" class="pedido menor" placeholder="O gestor recebe isso junto com a nota e refaz o plano."></textarea>
              <button class="btn alerta" type="submit">Devolver para a fila</button>
              <button class="btn texto" type="button" data-acao="abrir-devolver">Cancelar</button>
            </form>`
                : ''
            }
          </div>
          ${
            t.aprendizados?.length
              ? `<div class="empilha"><h2 class="rotulo">Vai para o vault</h2>${t.aprendizados.map((a) => `<span class="mono" style="font-size:12px;color:var(--suave);word-break:break-all">${esc(a)}</span>`).join('')}
            <span class="dica">${t.estado === 'concluida' ? 'Promovido para validado.' : 'Fica como rascunho até você aprovar.'}</span></div>`
              : ''
          }
          <a href="#/" style="font-size:14px">Voltar às solicitações</a>
        </aside>
      </div>`;
    const focar = $('#motivo');
    if (focar && forcar) focar.focus();
    this.carregarConsumo(t);
  },
  // Quanto esta tarefa gastou, por modelo (estimado). Só busca de novo quando a tarefa mudou.
  async carregarConsumo(t) {
    const chave = `${t.id}:${t.atualizada}`;
    const el = $('#r-consumo-tarefa');
    if (!el) return;
    if (this.consumoChave === chave && this.consumoHtml) {
      el.innerHTML = this.consumoHtml;
      return;
    }
    this.consumoChave = chave;
    try {
      const c = await api('GET', `/api/consumo?tarefaId=${encodeURIComponent(t.id)}&dias=90`);
      if (!c.chamadas) return;
      const mil = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n));
      this.consumoHtml = `<h2 class="rotulo">Consumo desta tarefa ${ajuda('Tokens estimados (cerca de 4 caracteres por token) do que foi enviado e recebido. O que a IA lê sozinha do disco não entra.')}</h2>
        <span style="font-size:14px">${c.chamadas} chamadas · ~${mil(c.entrada + c.saida)} tokens</span>
        <span class="dica">${c.porNivel.map((n) => `${esc(NOME_NIVEL[n.chave] ?? n.chave)}: ${n.chamadas}`).join(' · ')}${c.economia ? ` · ${c.economia}% mais barato que usar só o modelo forte` : ''}</span>`;
      const atual = $('#r-consumo-tarefa');
      if (atual) atual.innerHTML = this.consumoHtml;
    } catch {}
  },
};

// Busca o estado atual de uma tarefa no servidor e redesenha (quando a tela ficou para trás).
const recarregarTarefa = async (id) => {
  try {
    const d = await api('GET', '/api/estado');
    const t = d.tarefas.find((x) => x.id === id);
    if (t) upsert(S.d.tarefas, t);
    atualizar();
  } catch {}
};

const NOME_NIVEL = { rapido: 'rápido', padrao: 'padrão', forte: 'forte', 'sem nível': 'sem nível' };
const seloNivel = (p) => (p.nivel ? `<span class="selo-nivel ${p.nivel}" data-dica="${esc(`Modelo ${NOME_NIVEL[p.nivel]}${p.modelo ? ` (${p.modelo})` : ''}. ${p.nivelMotivo || ''}`)}">${NOME_NIVEL[p.nivel]}</span>` : '');

// O que cada equipe respondeu, na íntegra, para você revisar sem abrir a nota.
const htmlRespostas = (t) => {
  const todos = (t.plano ?? []).filter((p) => p.equipe !== 'avaliador' && (p.resumo || p.resposta));
  // Depois de uma correção, a última entrega da equipe é a que vale; as anteriores ficam recolhidas embaixo dela.
  const passos = todos.filter((p, i) => !todos.slice(i + 1).some((q) => q.equipe === p.equipe && q.correcao));
  const antes = (p) => todos.filter((q) => q.equipe === p.equipe && q !== p && todos.indexOf(q) < todos.indexOf(p));
  if (!passos.length) return '';
  return `<section class="empilha"><h2 class="rotulo">O que as equipes responderam</h2>${passos
    .map(
      (p) => `<article class="resposta-equipe">
        <header><b>${esc(equipe(p.equipe)?.nome ?? p.equipe)}</b><span class="dica">${esc(p.ia ?? '')}</span>${seloNivel(p)}<span class="cresce"></span><button type="button" class="btn texto pequeno" data-acao="questionar-equipe" data-equipe="${esc(p.equipe)}">Questionar</button></header>
        ${p.resumo ? `<p class="resposta-resumo">${esc(p.resumo)}</p>` : ''}
        ${p.resposta ? `<div class="manual resposta-corpo">${markdown(p.resposta).html}</div>` : ''}
        ${p.arquivos?.length ? `<p class="dica">Arquivos: ${p.arquivos.map((a) => `<code>${esc(a)}</code>`).join(', ')}</p>` : ''}
        ${p.correcao ? `<p class="dica">Versão corrigida depois do avaliador${antes(p).length ? ` · ${antes(p).length} ${antes(p).length === 1 ? 'versão anterior' : 'versões anteriores'} abaixo` : ''}.</p>` : ''}
        ${antes(p).map((q, k) => `<details><summary class="dica">Versão ${k + 1}, reprovada pelo avaliador</summary><p class="dica">${esc(q.resumo ?? '')}</p>${q.resposta ? `<div class="manual resposta-corpo">${markdown(q.resposta).html}</div>` : ''}</details>`).join('')}
        ${p.anterior ? `<details><summary class="dica">Primeira versão (modelo ${esc(NOME_NIVEL[p.anterior.nivel] ?? '')}), reprovada pelo avaliador</summary><p class="dica">${esc(p.anterior.resumo ?? '')}</p>${p.anterior.resposta ? `<div class="manual resposta-corpo">${markdown(p.anterior.resposta).html}</div>` : ''}</details>` : ''}
      </article>`,
    )
    .join('')}</section>`;
};

// Perguntas que você reencaminhou depois da entrega, com as respostas, e a caixa para mandar outra.
const htmlConversa = (t) => {
  if (!t.plano?.length || ['fila', 'planejando'].includes(t.estado)) return '';
  const destinos = [...new Set(t.plano.map((p) => p.equipe).filter((id) => !id.startsWith('nova:')))];
  const para = S.questionarPara && (destinos.includes(S.questionarPara) || S.questionarPara === 'gestor') ? S.questionarPara : destinos.find((d) => d !== 'avaliador') ?? 'gestor';
  const itens = (t.conversa ?? [])
    .map(
      (c) => `<div class="conversa-item">
        <p class="conversa-pergunta"><span class="dica">Você → ${esc(c.paraNome ?? c.para)}</span>${esc(c.pergunta)}</p>
        ${
          c.estado === 'respondendo'
            ? `<p class="dica conversa-espera">${esc(c.paraNome ?? c.para)} está respondendo…</p>`
            : c.estado === 'falhou'
              ? `<p class="dica erro">Não respondeu: ${esc(c.erro ?? '')}</p>`
              : `<div class="conversa-resposta"><span class="dica">${esc(c.paraNome ?? c.para)}${c.ia ? ` · ${esc(c.ia)}` : ''}</span>${seloNivel(c)}<div class="manual resposta-corpo">${markdown(c.resposta ?? '').html}</div>${c.arquivos?.length ? `<p class="dica">Alterou: ${c.arquivos.map((a) => `<code>${esc(a)}</code>`).join(', ')}</p>` : ''}</div>`
        }
      </div>`,
    )
    .join('');
  return `<section class="empilha" id="r-conversa"><h2 class="rotulo">Perguntar ou questionar ${ajuda('Mande uma dúvida ou um questionamento sobre a entrega para uma equipe (ou para o gestor). A resposta aparece aqui, sem a tarefa voltar para a fila. Se a equipe concordar que errou, ela corrige.')}</h2>
    ${itens}
    <form class="empilha conversa-form" data-form="questionar" data-id="${t.id}">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label for="q-para" class="dica" style="font-size:14px">Para</label>
        <select class="campo" id="q-para" name="para" style="height:38px;width:auto;min-width:200px">${[...destinos.filter((d) => d !== 'avaliador'), 'avaliador', 'gestor']
          .filter((d, i, a) => a.indexOf(d) === i && (d === 'gestor' || destinos.includes(d)))
          .map((d) => `<option value="${esc(d)}" ${d === para ? 'selected' : ''}>${esc(d === 'gestor' ? 'Gestor (visão geral da tarefa)' : equipe(d)?.nome ?? d)}</option>`)
          .join('')}</select></div>
      <textarea id="q-texto" name="texto" rows="3" class="pedido menor" placeholder="Ex.: De onde veio esse número? Ou: o item 2 está errado, a lei mudou em 2025." required></textarea>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn" type="submit">Enviar pergunta</button>${t.estado === 'revisao' ? '<span class="dica">Se for preciso refazer tudo, use Devolver para as equipes.</span>' : ''}</div>
    </form></section>`;
};

// ------------------------------------------------------------------ tela: máquinas (SSH)

const NOMES_COMANDO = { claude: 'Claude Code', agy: 'Antigravity CLI', codex: 'Codex CLI', ollama: 'Ollama', node: 'Node.js', git: 'git' };

const telaMaquinas = {
  montar() {
    $('#app').innerHTML = `<div class="pagina">
      <div class="pagina-cab"><h1>Máquinas</h1></div>
      <p class="intro">Como o Remote-SSH do VS Code: um projeto pode morar noutro computador ou servidor. O gestor, as equipes e os agentes rodam lá, com as IAs de lá, e você comanda daqui. Usa o SSH do sistema, então vale o que já está no seu <span class="mono">~/.ssh/config</span>.</p>
      <div class="linhas" id="r-maquinas"></div>
      <h2 class="titulo" style="font-size:26px;margin-top:20px">Adicionar máquina</h2>
      <form class="form-nova" data-form="maquina">
        <div class="grupo"><label for="mq-nome">Nome</label><input class="campo" id="mq-nome" name="nome" placeholder="Ex.: Servidor de casa"></div>
        <div class="grupo" style="flex:2 1 280px"><label for="mq-destino">Destino ${ajuda('usuario@endereco (ex.: coelho@192.168.0.20) ou o nome de um Host do seu ~/.ssh/config.')}</label><input class="campo mono" id="mq-destino" name="destino" placeholder="usuario@servidor" required autocomplete="off"></div>
        <div class="grupo" style="flex:0 1 110px"><label for="mq-porta">Porta</label><input class="campo mono" id="mq-porta" name="porta" type="number" min="1" max="65535" placeholder="22"></div>
        <div class="grupo"><label for="mq-chave">Chave (opcional) ${ajuda('Caminho da chave privada, se não for a padrão. Ex.: ~/.ssh/id_ed25519')}</label><input class="campo mono" id="mq-chave" name="chave" placeholder="~/.ssh/id_ed25519" autocomplete="off"></div>
        <div class="cresce"></div>
        <button class="btn" type="submit">${I.mais}Adicionar</button>
      </form>
      <p class="dica">Depois de adicionar: <b>Testar conexão</b>. Se pedir senha, use <b>Acesso sem senha</b> uma vez; o gestor e as equipes precisam entrar sem digitar senha.</p>
    </div>`;
    this.atualizar(true);
  },
  atualizar(forcar) {
    const caixa = $('#r-maquinas');
    if (!caixa || (!forcar && caixa.contains(document.activeElement) && document.activeElement.matches('input'))) return;
    const local = `<div class="linha"><span class="ponto" style="background:var(--ok)"></span><div class="nome"><span>Este computador</span><small>Projetos sem máquina definida rodam aqui.</small><small>Pasta padrão dos projetos: <span class="mono">${esc(S.d.geral.pastaProjetos ?? '')}</span></small></div>
      <button type="button" class="link" data-acao="trocar-pasta-padrao">Trocar pasta padrão</button></div>`;
    caixa.innerHTML =
      local +
      S.d.maquinas
        .map((m) => {
          const [cor, rotulo] = m.estado === 'ok' ? ['var(--ok)', 'conectada'] : m.estado === 'erro' ? ['var(--erro)', 'falhou'] : m.estado === 'testando' ? ['var(--acento)', 'testando…'] : ['#4a4a55', 'não testada'];
          const usado = S.d.projetos.filter((p) => p.maquinaId === m.id).map((p) => p.nome);
          const ias = (m.comandos ?? []).filter((c) => ['claude', 'agy', 'codex', 'ollama'].includes(c));
          const faltam = ['claude', 'agy', 'codex', 'ollama'].filter((c) => m.estado === 'ok' && !ias.includes(c));
          return `<div class="linha">
            <span class="ponto" style="background:${cor}"></span>
            <div class="nome"><span>${esc(m.nome)}</span><small><span class="mono">${esc(m.destino)}${m.porta ? `:${m.porta}` : ''}</span>${m.so ? ` · ${esc(m.so)}` : ''}${usado.length ? ` · projetos: ${usado.map(esc).join(', ')}` : ''}</small>
              ${m.estado === 'ok' ? `<small>IAs lá: ${ias.length ? ias.map((c) => esc(NOMES_COMANDO[c])).join(', ') : 'nenhuma'}${m.orq ? '' : ' · sem Node.js lá: os agentes de lá não terão o comando orq'}</small>` : ''}
              ${m.estado === 'erro' ? `<small class="erro">${esc(m.erro)}</small>` : ''}
            </div>
            <span class="selo" style="color:${cor}">${rotulo}</span>
            <button type="button" class="btn pequeno" data-acao="mq-testar" data-id="${esc(m.id)}" ${m.estado === 'testando' ? 'disabled' : ''}>Testar conexão</button>
            <button type="button" class="link" data-acao="mq-chave" data-id="${esc(m.id)}" data-dica="Autoriza a chave SSH deste computador lá. Você digita a senha uma única vez.">Acesso sem senha</button>
            <button type="button" class="link" data-acao="mq-terminal" data-id="${esc(m.id)}" data-dica="Abre um terminal na máquina, aqui dentro do app.">Abrir terminal</button>
            ${faltam.length ? `<label class="sr" for="mq-ia-${esc(m.id)}">Instalar IA lá</label><select class="campo" id="mq-ia-${esc(m.id)}" style="width:auto;height:36px" data-mudar="mq-instalar" data-id="${esc(m.id)}"><option value="">Instalar IA lá…</option>${faltam.map((c) => `<option value="${c}">${esc(NOMES_COMANDO[c])}</option>`).join('')}</select>` : ''}
            <button type="button" class="link mudo" data-acao="mq-remover" data-id="${esc(m.id)}">Remover</button>
          </div>`;
        })
        .join('');
  },
};

// Gera o arquivo de diagnóstico (tudo o que este PC está vendo) e mostra onde ficou.
const gerarDiagnostico = async () => {
  const caixa = document.createElement('div');
  caixa.className = 'cv-modal';
  caixa.setAttribute('role', 'dialog');
  caixa.setAttribute('aria-modal', 'true');
  caixa.innerHTML = `<div class="cv-modal-caixa" style="max-width:640px">
    <h2 class="titulo" style="font-size:28px">Gerando o diagnóstico…</h2>
    <p class="dica" style="font-size:15px;line-height:1.5;margin:0">Juntando versões, pastas, onde cada IA foi encontrada e testando cada IA ligada. Pode levar até um minuto por IA.</p>
  </div>`;
  document.body.appendChild(caixa);
  try {
    const { arquivo, texto } = await api('POST', '/api/diagnostico', {});
    caixa.querySelector('.cv-modal-caixa').innerHTML = `
      <h2 class="titulo" style="font-size:28px">Diagnóstico pronto</h2>
      <p style="font-size:15px;line-height:1.5;margin:0">Envie este arquivo para quem está te ajudando. Ele não tem senhas, tokens nem chaves.</p>
      <code class="mono" style="font-size:12.5px;word-break:break-all;color:var(--acento-texto)">${esc(arquivo)}</code>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
        <button type="button" class="btn texto" data-d="copiar">Copiar o texto</button>
        ${window.singularize?.mostrarArquivo ? '<button type="button" class="btn contorno" data-d="pasta">Mostrar na pasta</button>' : ''}
        <button type="button" class="btn" data-d="fechar">Fechar</button>
      </div>`;
    caixa.addEventListener('click', async (ev) => {
      const d = ev.target.closest('[data-d]')?.dataset.d;
      if (d === 'fechar' || (!d && ev.target === caixa)) return caixa.remove();
      if (d === 'copiar') {
        await navigator.clipboard.writeText(texto).catch(() => {});
        toast('Texto do diagnóstico copiado.');
      }
      if (d === 'pasta') window.singularize.mostrarArquivo(arquivo);
    });
    caixa.querySelector('[data-d="fechar"]').focus();
  } catch (e) {
    caixa.remove();
    toast(`Não deu para gerar o diagnóstico: ${e.message}`, 'erro');
  }
};

// O teste de uma IA falhou: mostra tudo (comando, código, saída) e oferece repetir num terminal visível.
const mostrarFalhaTeste = (ia, r) => {
  const texto = [`IA: ${ia?.nome ?? '?'}`, `Motivo: ${r.motivo}`, `Código de saída: ${r.codigo}${r.tempoEsgotado ? ' (tempo esgotado)' : ''}`, `Comando: ${r.comando}`, `Pasta: ${r.pasta}`, `--- saída ---`, r.saida || '(vazia)', `--- erros ---`, r.erro || '(vazio)'].join('\n');
  const caixa = document.createElement('div');
  caixa.className = 'cv-modal';
  caixa.setAttribute('role', 'dialog');
  caixa.setAttribute('aria-modal', 'true');
  caixa.innerHTML = `<div class="cv-modal-caixa" style="max-width:820px;width:min(820px,94vw)">
    <h2 class="titulo" style="font-size:28px">${esc(ia?.nome ?? 'IA')} não respondeu ao teste</h2>
    <p style="font-size:15px;line-height:1.5;margin:0">${esc(r.motivo || 'Falhou sem explicar o motivo.')}</p>
    <pre class="nota" style="max-height:340px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;margin:0">${esc(texto)}</pre>
    <p class="dica" style="margin:0">Para ver ao vivo o que a IA responde, use <b>Testar no terminal</b>: roda exatamente o mesmo comando numa janela aqui dentro.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button type="button" class="btn texto" data-f="diagnostico">Gerar diagnóstico completo</button>
      <button type="button" class="btn texto" data-f="copiar">Copiar detalhes</button>
      <button type="button" class="btn contorno" data-f="terminal">Testar no terminal</button>
      <button type="button" class="btn" data-f="fechar">Fechar</button>
    </div>
  </div>`;
  const fechar = () => caixa.remove();
  caixa.addEventListener('click', async (ev) => {
    const f = ev.target.closest('[data-f]')?.dataset.f;
    if (!f && ev.target === caixa) return fechar();
    if (f === 'fechar') return fechar();
    if (f === 'copiar') {
      await navigator.clipboard.writeText(texto).catch(() => {});
      return toast('Detalhes copiados.');
    }
    if (f === 'diagnostico') {
      fechar();
      return gerarDiagnostico();
    }
    if (f === 'terminal') {
      fechar();
      const { sessao, comando } = await api('POST', `/api/ias/${ia.id}/testar-terminal`);
      abrirTerminal({ titulo: `Teste: ${ia.nome}`, descricao: 'O mesmo pedido curto do botão Testar. O que aparecer aqui é exatamente o que a IA responde ao app.', comando, sessao, token, esc });
    }
  });
  document.body.appendChild(caixa);
  caixa.querySelector('[data-f="terminal"]').focus();
};

// Pergunta com sim / não, dentro do app (sem janela do sistema). Devolve true se a pessoa aceitar.
const perguntar = ({ titulo, texto, detalhe = '', sim = 'Sim', nao = 'Agora não' }) =>
  new Promise((resolve) => {
    const caixa = document.createElement('div');
    caixa.className = 'cv-modal';
    caixa.setAttribute('role', 'alertdialog');
    caixa.setAttribute('aria-modal', 'true');
    caixa.setAttribute('aria-label', titulo);
    caixa.innerHTML = `<div class="cv-modal-caixa" style="max-width:560px">
      <h2 class="titulo" style="font-size:28px">${esc(titulo)}</h2>
      <p class="dica" style="font-size:15px;line-height:1.55;color:var(--texto)">${esc(texto)}</p>
      ${detalhe ? `<code class="mono" style="font-size:12px;color:var(--suave);word-break:break-all">${esc(detalhe)}</code>` : ''}
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
        <button type="button" class="btn texto" data-r="nao">${esc(nao)}</button>
        <button type="button" class="btn" data-r="sim">${esc(sim)}</button>
      </div>
    </div>`;
    const fim = (r) => {
      caixa.remove();
      document.removeEventListener('keydown', tecla);
      resolve(r);
    };
    const tecla = (ev) => ev.key === 'Escape' && fim(false);
    caixa.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-r]');
      if (b) fim(b.dataset.r === 'sim');
      else if (ev.target === caixa) fim(false);
    });
    document.addEventListener('keydown', tecla);
    document.body.appendChild(caixa);
    caixa.querySelector('[data-r="sim"]').focus();
  });

const terminalMaquina = async (url, titulo, descricao) => {
  const { sessao, comando } = await api('POST', url);
  return abrirTerminal({ titulo, descricao, comando, sessao, token, esc });
};

// ------------------------------------------------------------------ tela: começar (escolha das IAs)

const SOBRE_IA = {
  claude: 'Da Anthropic. Funciona com a assinatura Pro ou Max. Forte em código, segurança e planejamento.',
  antigravity: 'Do Google, com a sua conta Google (tem plano gratuito). Bom para pesquisa e código.',
  codex: 'Da OpenAI. Usa a sua conta do ChatGPT. Bom para implementar código.',
  ollama: 'Roda modelos no seu computador, sem internet e sem cota. Pede uma máquina boa; o modelo ocupa vários GB.',
  simulado: 'Respostas de exemplo, sem nenhuma IA real. Só para conhecer o app.',
};

// Instala uma IA num terminal visível e, se der certo, oferece o login.
const instalarIA = async (ia) => {
  const plano = S.d.planos[ia.tipo];
  const { sessao, comando } = await api('POST', `/api/ias/${ia.id}/instalar`);
  return abrirTerminal({ titulo: `Instalando ${ia.nome}`, descricao: `${plano?.descricao ?? ''} Se pedir senha ou confirmação, responda aqui.`, comando, sessao, token, esc });
};
const entrarIA = async (ia) => {
  const plano = S.d.planos[ia.tipo];
  const { sessao, comando } = await api('POST', `/api/ias/${ia.id}/entrar`);
  return abrirTerminal({ titulo: `${plano?.entrar?.rotulo ?? 'Entrar na conta'}: ${ia.nome}`, descricao: plano?.entrar?.dica ?? '', comando, sessao, token, esc });
};

const telaComecar = {
  montar(arg) {
    // "objetivos" sozinho: escolher para que usar o app (equipes), sem passar pelas IAs de novo.
    this.soObjetivos = arg === 'objetivos';
    this.fase = this.soObjetivos ? 'objetivos' : S.d.comecar.feito ? 'escolher' : 'pasta';
    this.escolhidas = new Set(S.d.ias.filter((i) => i.ativa && i.tipo !== 'shell').map((i) => i.id));
    this.objetivos = new Set(S.d.comecar.objetivos ?? []);
    this.render();
  },
  atualizar() {
    if (this.fase !== 'instalar' || $('#app').contains(document.activeElement)) return;
    this.render();
  },
  opcoes() {
    const ordem = ['claude', 'antigravity', 'codex', 'ollama', 'simulado'];
    return S.d.ias.filter((i) => i.tipo !== 'shell' && i.tipo !== 'custom').sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo));
  },
  instalada: (i) => i.tipo === 'simulado' || i.status === 'pronto',
  render() {
    const caixa = $('#app');
    const escolhidas = this.opcoes().filter((i) => this.escolhidas.has(i.id));
    const faltam = escolhidas.filter((i) => !this.instalada(i));
    const cab = (titulo, texto) => `<div class="empilha" style="gap:14px"><h1 class="titulo" style="font-size:46px;line-height:1.1;letter-spacing:-.6px">${titulo}</h1><p class="intro" style="font-size:16px">${texto}</p></div>`;

    if (this.fase === 'pasta') {
      const pasta = this.pasta ?? S.d.geral.pastaProjetos ?? '';
      caixa.innerHTML = `<div class="pagina comecar">
        <span class="dica">Passo 1 de 3</span>
        ${cab('Onde ficam seus projetos?', 'Cada projeto novo ganha uma pasta aqui dentro, com o nome dele. Você pode trocar essa pasta quando quiser e escolher outra em qualquer projeto.')}
        <div class="empilha" style="gap:10px;padding:22px;border-radius:14px;background:var(--sup-2);box-shadow:0 0 0 1px var(--linha)">
          <label for="cm-pasta" class="dica" style="font-size:14px">Pasta dos projetos</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <input id="cm-pasta" class="campo mono" style="flex:1 1 360px;font-size:14px" value="${esc(pasta)}" ${window.singularize ? 'readonly' : ''}>
            ${window.singularize ? '<button type="button" class="btn contorno pequeno" data-acao="comecar-escolher-pasta">Escolher outra pasta</button>' : ''}
          </div>
          <span class="dica">${window.singularize ? 'Já deixamos uma pasta sugerida. Se preferir outra, clique em Escolher outra pasta.' : 'Já deixamos um caminho sugerido. Edite se preferir outro.'}</span>
        </div>
        <div style="display:flex;justify-content:flex-end"><button type="button" class="btn" data-acao="comecar-pasta-ok">Continuar</button></div>
      </div>`;
      return;
    }

    if (this.fase === 'objetivos') {
      const marcados = S.d.objetivos.filter((o) => this.objetivos.has(o.id));
      const ja = new Set(S.d.equipes.map((e) => e.nome));
      caixa.innerHTML = `<div class="pagina comecar">
        ${this.soObjetivos ? '' : '<span class="dica">Passo 2 de 3</span>'}
        ${cab('Para que você vai usar o Singularize?', 'Marque seus objetivos e já deixamos as equipes certas prontas para eles. Nada além disso: se um pedido precisar de outra coisa, o gestor monta a equipe na hora.')}
        <div class="comecar-grade" role="group" aria-label="Objetivos">${S.d.objetivos
          .map((o) => {
            const on = this.objetivos.has(o.id);
            return `<button type="button" class="comecar-ia" data-acao="comecar-objetivo" data-id="${esc(o.id)}" aria-pressed="${on}">
              <span class="caixinha" aria-hidden="true">${on ? '✓' : ''}</span>
              <span class="empilha" style="gap:6px;text-align:left">
                <span class="serif" style="font-size:22px">${esc(o.nome)}</span>
                <span class="dica" style="font-size:14px">${esc(o.desc)}</span>
                <span class="selo espera">${o.equipes.map((n) => (ja.has(n) ? `${esc(n)} ✓` : esc(n))).join(' · ')}</span>
              </span>
            </button>`;
          })
          .join('')}</div>
        <p class="dica">Gestor e avaliador já fazem parte de todo projeto. Você muda isso quando quiser em <b>Equipes</b>.</p>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <span class="dica" style="font-size:14px">${marcados.length ? `${marcados.length} ${marcados.length === 1 ? 'objetivo' : 'objetivos'} · equipes: ${[...new Set(marcados.flatMap((o) => o.equipes))].map(esc).join(', ')}` : 'Nenhum marcado: o gestor cria as equipes conforme os pedidos.'}</span>
          <div class="cresce"></div>
          <button type="button" class="btn texto" data-acao="comecar-objetivos-pular" data-dica="Sem equipes prontas. No modo Automático o gestor cria as equipes que cada pedido precisar; no Com aprovação ele propõe e você aprova.">Pular esta etapa</button>
          <button type="button" class="btn" data-acao="comecar-objetivos-ok" ${marcados.length ? '' : 'disabled'}>${this.soObjetivos ? 'Criar equipes' : 'Continuar'}</button>
        </div>
      </div>`;
      return;
    }

    if (this.fase === 'escolher') {
      caixa.innerHTML = `<div class="pagina comecar">
        ${S.d.comecar.feito ? '' : '<span class="dica">Passo 3 de 3</span>'}
        ${cab('Quais IAs você quer usar?', 'O Singularize usa as IAs de terminal com a <b>sua</b> conta, sem custo à parte. Marque as que quer usar. As que não estiverem instaladas, nós instalamos depois que você confirmar, e você acompanha cada passo.')}
        <div class="comecar-grade" role="group" aria-label="IAs">${this.opcoes()
          .map((i) => {
            const on = this.escolhidas.has(i.id);
            const pronta = this.instalada(i);
            return `<button type="button" class="comecar-ia" data-acao="comecar-marcar" data-id="${esc(i.id)}" aria-pressed="${on}">
              <span class="caixinha" aria-hidden="true">${on ? '✓' : ''}</span>
              <span class="empilha" style="gap:6px;text-align:left">
                <span class="serif" style="font-size:22px">${esc(i.tipo === 'simulado' ? 'Modo demonstração' : i.nome)}</span>
                <span class="dica" style="font-size:14px">${esc(SOBRE_IA[i.tipo] ?? '')}</span>
                <span class="selo ${pronta ? 'ok' : 'espera'}">${i.tipo === 'simulado' ? 'Sempre disponível' : pronta ? 'Instalada neste computador' : 'Não instalada · instalamos ao confirmar'}</span>
              </span>
            </button>`;
          })
          .join('')}</div>
        <p class="dica">O terminal comum (shell) fica sempre disponível na tela livre. Você muda essa escolha quando quiser em <b>IAs</b>.</p>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <span class="dica" style="font-size:14px">${escolhidas.length ? `${escolhidas.length} ${escolhidas.length === 1 ? 'IA escolhida' : 'IAs escolhidas'}${faltam.length ? `, ${faltam.length} para instalar` : ''}` : 'Marque ao menos uma.'}</span>
          <div class="cresce"></div>
          ${S.d.comecar.feito ? '<a class="btn texto" href="#/">Cancelar</a>' : ''}
          <button type="button" class="btn" data-acao="comecar-continuar" ${escolhidas.length ? '' : 'disabled'}>Continuar</button>
        </div>
      </div>`;
      return;
    }

    if (this.fase === 'confirmar') {
      caixa.innerHTML = `<div class="pagina comecar">
        ${cab('Antes de instalar', `Vamos instalar ${faltam.length === 1 ? 'esta IA' : `estas ${faltam.length} IAs`} no seu computador. Cada instalação abre num terminal aqui dentro: se pedir senha ou confirmação, responda nele.`)}
        <ul class="comecar-plano">${faltam
          .map((i) => {
            const plano = S.d.planos[i.tipo];
            return `<li><span class="serif" style="font-size:20px">${esc(i.nome)}</span><span class="dica" style="font-size:14px">${esc(plano?.descricao ?? 'Sem instalação automática: instale pelo site da ferramenta.')}</span>${plano ? `<code class="mono" style="font-size:12px;color:var(--suave);word-break:break-all">${esc(plano.comando)}</code>` : ''}</li>`;
          })
          .join('')}</ul>
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button type="button" class="btn texto" data-acao="comecar-voltar">Voltar</button>
          <button type="button" class="btn" data-acao="comecar-instalar">Instalar e continuar</button>
        </div>
      </div>`;
      return;
    }

    // fase instalar: acompanha cada IA escolhida
    const linhas = escolhidas
      .map((i) => {
        const pronta = this.instalada(i);
        const plano = S.d.planos[i.tipo];
        const rodando = this.atual === i.id;
        const estado = rodando ? ['acento', 'instalando…'] : pronta ? ['ok', 'pronta'] : this.falhas?.has(i.id) ? ['erro', 'não instalou'] : ['espera', 'na fila para instalar'];
        return `<li>
          <span class="ponto" style="background:var(--${estado[0] === 'acento' ? 'acento' : estado[0]})"></span>
          <span class="serif" style="font-size:20px;flex:1 1 200px">${esc(i.tipo === 'simulado' ? 'Modo demonstração' : i.nome)}</span>
          <span class="selo ${estado[0]}">${estado[1]}</span>
          ${!pronta && !rodando && plano ? `<button type="button" class="link" data-acao="comecar-reinstalar" data-id="${esc(i.id)}">Tentar de novo</button>` : ''}
          ${pronta && plano ? `<button type="button" class="btn contorno pequeno" data-acao="ia-entrar" data-id="${esc(i.id)}">${esc(plano.entrar.rotulo)}</button>` : ''}
        </li>`;
      })
      .join('');
    caixa.innerHTML = `<div class="pagina comecar">
      ${cab(this.atual ? 'Instalando suas IAs' : 'Suas IAs', 'Depois de instalar, entre na conta de cada uma uma vez. É o login normal da ferramenta: o app só usa a conta que você já tem.')}
      <ul class="comecar-lista">${linhas}</ul>
      <div style="display:flex;justify-content:flex-end"><button type="button" class="btn" data-acao="comecar-fim" ${this.atual ? 'disabled' : ''}>Ir para o app</button></div>
    </div>`;
  },
  async confirmar() {
    await api('POST', '/api/comecar', { ias: [...this.escolhidas], ...(this.objetivosEscolhidos ? { objetivos: this.objetivosEscolhidos } : {}) });
    this.objetivosEscolhidos = null;
    this.fase = 'instalar';
    this.falhas = new Set();
    for (const i of this.opcoes().filter((x) => this.escolhidas.has(x.id) && !this.instalada(x) && S.d.planos[x.tipo])) await this.instalar(i);
    this.render();
  },
  async concluirObjetivos(lista) {
    // Primeira vez: os objetivos vão junto com as IAs (as equipes já nascem com as IAs certas).
    if (!S.d.comecar.feito) {
      this.objetivosEscolhidos = lista;
      this.fase = 'escolher';
      return this.render();
    }
    const r = await api('POST', '/api/comecar', { objetivos: lista });
    const n = r.equipes?.criadas?.length ?? 0;
    toast(lista.length ? (n ? `${n} ${n === 1 ? 'equipe criada' : 'equipes criadas'}.` : 'As equipes desses objetivos já existiam.') : 'Sem equipes prontas: o gestor cria conforme os pedidos.');
    location.hash = this.soObjetivos ? '#/equipes' : '#/';
  },
  async instalar(i) {
    this.atual = i.id;
    this.render();
    const fim = await instalarIA(i).catch(() => null);
    this.atual = null;
    if (!fim || fim.codigo !== 0) this.falhas.add(i.id);
    else this.falhas.delete(i.id);
    this.render();
    // Instalou: já abre o login, sem precisar procurar o botão.
    if (fim?.codigo === 0 && S.d.planos[i.tipo]?.entrar) await entrarIA(i).catch(() => {});
  },
};

// ------------------------------------------------------------------ tela: backup e atualização

const NOMES_COLECAO = { equipes: 'equipes', treinos: 'treinos', agentes: 'agentes', canvas: 'espaços da tela livre', mensagens: 'mensagens', projetos: 'projetos', tarefas: 'tarefas', ias: 'IAs', maquinas: 'máquinas', ajustes: 'ajustes' };
const tamanho = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const contagemTexto = (c) => Object.entries(c ?? {}).filter(([, n]) => n).map(([k, n]) => `${n} ${NOMES_COLECAO[k] ?? k}`).join(' · ');

const telaBackup = {
  async montar() {
    const info = await api('GET', '/api/backup');
    this.info = info;
    this.importado = null;
    $('#app').innerHTML = `<div class="pagina backup">
      <div class="empilha" style="gap:10px"><h1 class="titulo" style="font-size:44px">Backup e atualização</h1>
      <p class="intro">Para atualizar, basta rodar o instalador da versão nova. Ele troca só o programa: suas equipes, treinos, agentes, projetos e o cérebro ficam onde estão. E, toda vez que uma versão nova abre, o app guarda sozinho um backup de antes.</p></div>

      <section class="bk-cartao">
        <h2 class="titulo" style="font-size:26px">Onde ficam seus dados</h2>
        <div class="bk-linha"><span class="rotulo">Equipes, agentes, projetos, IAs</span><code class="mono">${esc(S.d.sistema.dados ?? '')}</code></div>
        <div class="bk-linha"><span class="rotulo">Cérebro (notas)</span><code class="mono">${esc(S.d.sistema.vault ?? '')}</code></div>
        <div class="bk-linha"><span class="rotulo">Backups que você exporta</span><code class="mono">${esc(info.pasta)}</code></div>
        <p class="dica" style="margin:0">Desinstalar o app também não apaga essas pastas.</p>
      </section>

      <section class="bk-cartao">
        <h2 class="titulo" style="font-size:26px">Exportar</h2>
        <p class="dica" style="margin:0">Um arquivo com o que você marcar. Serve para guardar, levar para outro computador ou voltar atrás.</p>
        <div class="bk-opcoes">${Object.entries(info.partes).map(([k, p]) => `<label class="check"><input type="checkbox" name="bk-parte" value="${k}" checked>${esc(p.nome)}</label>`).join('')}
          <label class="check"><input type="checkbox" id="bk-cerebro" checked>Cérebro (todas as notas)</label></div>
        ${comAjuda('<label class="check"><input type="checkbox" id="bk-segredos">Incluir chaves e senhas das IAs</label>', 'Só marque se for usar o arquivo no seu próprio computador. Com isso marcado, não compartilhe o arquivo.')}
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="button" class="btn" data-acao="bk-exportar">Exportar</button><span class="dica" id="bk-exportado" aria-live="polite"></span></div>
      </section>

      <section class="bk-cartao">
        <h2 class="titulo" style="font-size:26px">Importar</h2>
        <p class="dica" style="margin:0">Escolha um arquivo de backup do Singularize. Antes de importar, o app guarda o estado atual, então dá para voltar.</p>
        <label class="btn contorno pequeno" style="align-self:flex-start;cursor:pointer">Escolher arquivo…<input type="file" id="bk-arquivo" accept=".json,application/json" hidden></label>
        <div id="bk-previa"></div>
      </section>

      <section class="bk-cartao">
        <h2 class="titulo" style="font-size:26px">Backups automáticos</h2>
        <p class="dica" style="margin:0">Feitos ao abrir uma versão nova e antes de cada importação. Ficam os 8 mais recentes. Restaurar volta tudo (menos o cérebro, que não muda nas atualizações) para aquele momento.</p>
        <div class="linhas">${
          info.automaticos.length
            ? info.automaticos
                .map(
                  (a) => `<div class="linha"><div class="nome"><span>${new Date(a.criado).toLocaleString('pt-BR')}</span><small class="mono">${esc(a.nome)} · ${tamanho(a.tamanho)}</small></div>
              ${window.singularize?.mostrarArquivo ? `<button type="button" class="link" data-acao="bk-mostrar" data-arquivo="${esc(a.arquivo)}">Mostrar na pasta</button>` : ''}
              <button type="button" class="link" data-acao="bk-restaurar" data-nome="${esc(a.nome)}">Restaurar</button></div>`,
                )
                .join('')
            : '<p class="vazio">Nenhum ainda. O primeiro é feito na próxima atualização.</p>'
        }</div>
      </section>
    </div>`;
    $('#bk-arquivo').addEventListener('change', (ev) => this.escolher(ev.target.files?.[0]));
  },
  async escolher(arquivo) {
    if (!arquivo) return;
    const caixa = $('#bk-previa');
    caixa.innerHTML = '<p class="dica">Lendo o arquivo…</p>';
    try {
      const conteudo = await arquivo.text();
      const r = await api('POST', '/api/backup/previa', { conteudo });
      this.importado = conteudo;
      caixa.innerHTML = `<div class="empilha" style="gap:12px">
        <p style="margin:0"><b>${esc(arquivo.name)}</b> · versão ${esc(r.versaoApp ?? '?')} · ${new Date(r.criado).toLocaleString('pt-BR')}</p>
        <p class="dica" style="margin:0">${esc(contagemTexto(r.contagem)) || 'sem dados'}${r.notasCerebro ? ` · ${r.notasCerebro} arquivos do cérebro` : ''}</p>
        <div class="modos">
          <label class="modo"><input type="radio" name="bk-modo" value="juntar" checked><span class="empilha" style="gap:4px"><span style="font-weight:500">Juntar (recomendado)</span><span class="dica">Acrescenta o que falta e atualiza o que tem o mesmo nome. Nada daqui é apagado. Notas do cérebro que já existem ficam como estão.</span></span></label>
          <label class="modo"><input type="radio" name="bk-modo" value="substituir"><span class="empilha" style="gap:4px"><span style="font-weight:500">Substituir</span><span class="dica">O que veio no arquivo fica exatamente como no backup; o que não está nele é removido.</span></span></label>
        </div>
        <button type="button" class="btn" data-acao="bk-importar" style="align-self:flex-start">Importar</button>
      </div>`;
    } catch (e) {
      caixa.innerHTML = `<p class="dica erro">${esc(e.message)}</p>`;
    }
  },
};

// ------------------------------------------------------------------ tela: ajuda (manual)

// Markdown simples do manual: títulos, listas, código, citações, tabelas, negrito e links.
const markdown = (texto) => {
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, rotulo, url) => `<a href="${/^(https?:|#)/.test(url) ? url : '#'}"${url.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${rotulo}</a>`);
  const linhas = texto.replace(/\r/g, '').split('\n');
  const html = [];
  const indice = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.startsWith('```')) {
      const bloco = [];
      for (i++; i < linhas.length && !linhas[i].startsWith('```'); i++) bloco.push(linhas[i]);
      html.push(`<pre class="nota">${esc(bloco.join('\n'))}</pre>`);
    } else if (/^#{1,3} /.test(l)) {
      const nivel = l.match(/^#+/)[0].length;
      const t = l.slice(nivel + 1).trim();
      const id = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (nivel === 2) indice.push({ id, t });
      html.push(`<h${nivel} id="m-${id}">${inline(t)}</h${nivel}>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordenada = /^\d+\./.test(l.trim());
      const itens = [];
      for (; i < linhas.length && /^\s*([-*]|\d+\.) /.test(linhas[i]); i++) {
        const texto = inline(linhas[i].replace(/^\s*([-*]|\d+\.) /, ''));
        // Um nível de sub-lista: linha recuada vira item dentro do item anterior.
        if (/^\s{2,}/.test(linhas[i]) && itens.length) itens.at(-1).sub.push(`<li>${texto}</li>`);
        else itens.push({ texto, sub: [] });
      }
      i--;
      const corpo = itens.map((it) => `<li>${it.texto}${it.sub.length ? `<ul>${it.sub.join('')}</ul>` : ''}</li>`).join('');
      // Lista numerada que continua depois de uma tabela (ex.: 4., 5.) mantém a numeração.
      const inicio = Number(l.trim().match(/^(\d+)\./)?.[1] ?? 1);
      html.push(ordenada ? `<ol${inicio > 1 ? ` start="${inicio}"` : ''}>${corpo}</ol>` : `<ul>${corpo}</ul>`);
    } else if (l.startsWith('> ')) {
      const partes = [];
      for (; i < linhas.length && linhas[i].startsWith('> '); i++) partes.push(linhas[i].slice(2));
      i--;
      html.push(`<blockquote>${inline(partes.join(' '))}</blockquote>`);
    } else if (l.startsWith('|')) {
      const linhasTabela = [];
      for (; i < linhas.length && linhas[i].startsWith('|'); i++) if (!/^\|[\s:|-]+\|$/.test(linhas[i])) linhasTabela.push(linhas[i].split('|').slice(1, -1).map((c) => c.trim()));
      i--;
      const [cab, ...corpo] = linhasTabela;
      html.push(`<div class="tabela"><table><thead><tr>${cab.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${corpo.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (l.trim()) {
      const partes = [l];
      for (i++; i < linhas.length && linhas[i].trim() && !/^(#|```|\s*([-*]|\d+\.) |> |\|)/.test(linhas[i]); i++) partes.push(linhas[i]);
      i--;
      html.push(`<p>${inline(partes.join(' '))}</p>`);
    }
  }
  return { html: html.join('\n'), indice };
};

const telaAjuda = {
  async montar(ancora) {
    $('#app').innerHTML = `<div class="pagina"><p class="dica">Carregando o manual…</p></div>`;
    const r = await fetch('/manual.md');
    const { html, indice } = markdown(await r.text());
    $('#app').innerHTML = `<div class="pagina manual-pagina">
      <nav class="manual-indice" aria-label="Seções do manual"><span class="dica">Versão ${esc(S.d.sistema?.versao ?? '')}</span><button type="button" class="btn contorno pequeno" data-acao="diagnostico" style="align-self:flex-start" data-dica="Arquivo .txt com tudo o que este computador está vendo, para enviar a quem está te ajudando.">Gerar diagnóstico</button><a class="btn contorno pequeno" href="#/backup" style="align-self:flex-start" data-dica="Exportar e importar suas equipes, agentes e cérebro; backups automáticos de cada atualização.">Backup e atualização</a><span class="rotulo">Neste manual</span>${indice.map((s) => `<a href="#/ajuda/${s.id}">${esc(s.t)}</a>`).join('')}</nav>
      <article class="manual">${html}</article>
    </div>`;
    if (ancora) document.getElementById(`m-${ancora}`)?.scrollIntoView();
  },
};

// ------------------------------------------------------------------ roteamento

const rotaAtual = () => {
  const [, nome = '', arg] = location.hash.split('/');
  if (nome === 'tarefa' && arg) return { nome: 'tarefa', arg, tela: telaTarefa };
  if (nome === 'terminais') return { nome, tela: telaTerminais };
  if (nome === 'livre') return { nome, tela: telaCanvas };
  if (nome === 'cerebro') return { nome, tela: telaCerebro };
  if (nome === 'comunicacao') return { nome, arg, tela: telaComunicacao };
  if (nome === 'backup') return { nome: 'ajuda', tela: telaBackup };
  if (nome === 'treinar' && arg) return { nome: 'equipes', arg, tela: treinoTelas.telaTreinar };
  if (nome === 'treino' && arg) return { nome: 'equipes', arg, tela: treinoTelas.telaTreino };
  if (nome === 'ajuda') return { nome, arg, tela: telaAjuda };
  if (nome === 'comecar') return { nome, tela: telaComecar };
  if (nome === 'objetivos') return { nome, arg: 'objetivos', tela: telaComecar };
  if (nome === 'maquinas') return { nome, tela: telaMaquinas };
  if (nome === 'equipes') return { nome, tela: telaEquipes };
  if (nome === 'ias') return { nome, tela: telaIAs };
  if (nome === 'consumo') return { nome: 'ias', tela: telaConsumo };
  if (nome === 'historico') return { nome: 'inicio', tela: telaHistorico };
  if (nome === 'skills') return { nome: 'equipes', arg, tela: telaSkills };
  return { nome: 'inicio', tela: telaInicio };
};

let montada = null;
const montar = () => {
  if (!S.carregado) return;
  const r = rotaAtual();
  montada?.desmontar?.();
  r.tela.montar(r.arg);
  montada = r.tela;
  atualizarTopo();
  window.scrollTo(0, 0);
};

let pendente = null;
const atualizar = () => {
  if (pendente) return;
  pendente = requestAnimationFrame(() => {
    pendente = null;
    if (montada && montada === rotaAtual().tela) montada.atualizar?.();
    atualizarTopo();
  });
};

window.addEventListener('hashchange', montar);

// ------------------------------------------------------------------ eventos do servidor

const upsert = (lista, item) => {
  const i = lista.findIndex((x) => x.id === item.id);
  if (i < 0) lista.push(item);
  else lista[i] = item;
};
const remover = (lista, id) => {
  const i = lista.findIndex((x) => x.id === id);
  if (i >= 0) lista.splice(i, 1);
};

const aplicar = (e) => {
  const d = S.d;
  switch (e.tipo) {
    case 'tarefa':
      upsert(d.tarefas, e.tarefa);
      if (rotaAtual().nome === 'tarefa' && rotaAtual().arg === e.tarefa.id) telaTarefa.carregarNota();
      return atualizar();
    case 'tarefa.removida':
      remover(d.tarefas, e.id);
      return atualizar();
    case 'projeto':
      upsert(d.projetos, e.projeto);
      montada?.evento?.(e);
      return atualizar();
    case 'projeto.removido':
      remover(d.projetos, e.id);
      return atualizar();
    case 'cerebro':
      return telaCerebro.mudou();
    case 'recarregar':
      return carregar();
    case 'treino':
      upsert(d.treinos, e.treino);
      if (montada === treinoTelas.telaTreino && treinoTelas.telaTreino.id === e.treino.id) treinoTelas.telaTreino.redesenhar();
      return atualizar();
    case 'skills':
      api('GET', '/api/skills')
        .then((l) => {
          S.d.skills = l.map(({ conteudo, ...k }) => ({ ...k, tamanho: conteudo.length }));
          if (montada === telaSkills) telaSkills.carregar();
          else atualizar();
        })
        .catch(() => {});
      return;
    case 'cerebro.uso':
      if (montada === telaCerebro) telaCerebro.uso(e);
      return;
    case 'comunicacao':
      if (montada === telaComunicacao) telaComunicacao.evento(e.ev);
      else if (montada === telaCerebro) telaCerebro.comunicacao(e.ev);
      return;
    case 'treino.removido':
      d.treinos = d.treinos.filter((t) => t.id !== e.id);
      return atualizar();
    case 'equipe':
      upsert(d.equipes, e.equipe);
      telaCerebro.mudou();
      return atualizar();
    case 'equipe.removida':
      remover(d.equipes, e.id);
      return atualizar();
    case 'ia':
      upsert(d.ias, e.ia);
      return atualizar();
    case 'ia.removida':
      remover(d.ias, e.id);
      return atualizar();
    case 'headroom':
      S.d.headroom = e.headroom;
      return atualizar();
    case 'agente':
      upsert(d.agentes, e.agente);
      montada?.evento?.(e);
      return;
    case 'agente.removido':
      remover(d.agentes, e.id);
      montada?.evento?.(e);
      return;
    case 'canvas':
    case 'mensagem':
      montada?.evento?.(e);
      return;
    case 'atividade':
      resumo.novo(e.item);
      return;
    case 'geral':
      d.geral = e.geral;
      return atualizar();
    case 'maquina':
      upsert(d.maquinas, e.maquina);
      return atualizar();
    case 'maquina.removida':
      remover(d.maquinas, e.id);
      return atualizar();
    case 'comecar':
      d.comecar = e.comecar;
      return atualizar();
    case 'avulso.fim':
      avisarFim(e);
      return atualizar();
    case 'ia.teste':
      return toast(e.ok ? `${e.nome}: conta testada e em uso.` : `${e.nome} não passou no teste: ${e.motivo}`, e.ok ? '' : 'erro');
    case 'aviso':
      return toast(e.texto, 'erro');
    case 'terminal': {
      const linhas = (d.terminais[e.equipe] ??= []);
      linhas.push(e.linha);
      if (linhas.length > 400) linhas.splice(0, linhas.length - 400);
      if (montada === rotaAtual().tela) montada.terminal?.(e.equipe);
      return;
    }
  }
};

const carregar = async () => {
  S.d = await api('GET', '/api/estado');
  S.carregado = true;
  if (S.proj !== 'todos' && !S.d.projetos.some((p) => p.id === S.proj)) S.proj = 'todos';
  const faltaObjetivo = S.d.comecar.feito && !S.d.comecar.objetivosFeito;
  if ((!S.d.comecar.feito || faltaObjetivo) && !['comecar', 'objetivos'].includes(rotaAtual().nome)) location.hash = S.d.comecar.feito ? '#/objetivos' : '#/comecar';
  montar();
  if (S.d.comecar.feito) resumo.verificar();
};

const conectar = () => {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/eventos?token=${encodeURIComponent(token())}`);
  ws.onopen = () => {
    S.conectado = true;
    carregar().catch(() => {});
  };
  ws.onmessage = (m) => aplicar(JSON.parse(m.data));
  ws.onclose = (ev) => {
    S.conectado = false;
    atualizarTopo();
    if (ev.code === 4401) {
      const novo = prompt('Token de acesso do Singularize:');
      if (novo) localStorage.setItem('orq.token', novo);
    }
    setTimeout(conectar, 1500);
  };
};

// ------------------------------------------------------------------ ações

const ler = (form) => Object.fromEntries(new FormData(form).entries());

const tamanhoLegivel = (n) => (!n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const LIMITE_ANEXO = 50 * 1024 * 1024;
// Lê qualquer arquivo para enviar junto com a tarefa. Acima de 50 MB fica de fora (com aviso).
const lerFotos = async (arquivos) => {
  const lista = [...arquivos];
  const grandes = lista.filter((f) => f.size > LIMITE_ANEXO);
  if (grandes.length) toast(`${grandes.map((f) => f.name).join(', ')}: acima de 50 MB, não foi anexado.`);
  return Promise.all(
    lista
      .filter((f) => f.size <= LIMITE_ANEXO)
      .map(
        (f) =>
          new Promise((ok) => {
            const r = new FileReader();
            r.onload = () => ok({ nome: f.name, tipo: f.type || 'application/octet-stream', tamanho: f.size, dados: r.result });
            r.readAsDataURL(f);
          }),
      ),
  );
};

const enviarTarefa = async () => {
  const campo = $('#pedido');
  const texto = campo.value.trim();
  const alvo = telaInicio.projetoAlvo();
  if (!alvo) {
    S.novoProj = true;
    telaInicio.novoProjeto();
    return toast('Crie um projeto primeiro.');
  }
  if (!texto) return campo.focus();
  if (S.fotos.length > 20) return toast('No máximo 20 arquivos por tarefa.');
  const t = await api('POST', '/api/tarefas', { projetoId: alvo.id, texto, arquivos: S.fotos });
  S.draft = '';
  S.fotos = [];
  campo.value = '';
  telaInicio.fotos();
  toast(`${t.id} entrou na fila de ${alvo.nome}.`);
};

const moverNaFila = (id, delta) => {
  const ids = naFila().map((t) => t.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return api('POST', '/api/fila/ordem', { ids });
};

const acoes = {
  ...treinoTelas.acoes,
  'skill-nova': () => {
    location.hash = '#/skills';
    telaSkills.editando = null;
    telaSkills.desenhar();
  },
  'skill-remover': async (b) => {
    if (!(await perguntar({ titulo: 'Remover esta skill?', texto: 'As equipes deixam de herdá-la. A nota sai do cérebro (40-skills).', sim: 'Remover', nao: 'Cancelar' }))) return;
    await api('DELETE', `/api/skills/${encodeURIComponent(b.dataset.id)}`);
    location.hash = '#/skills';
    toast('Skill removida.');
  },
  'eq-criar-e-treinar': (b) => {
    S.treinarAoCriar = true;
    return formularios['proposta-equipe'](b.closest('form')).catch((e) => toast(e.message));
  },
  'eq-criar-sem-treino': (b) => {
    S.treinarAoCriar = false;
    return formularios['proposta-equipe'](b.closest('form')).catch((e) => toast(e.message));
  },
  'eq-descartar-analise': () => {
    S.analiseEquipe = null;
    desenharAnalise();
  },
  'eq-ajustar-existente': (b) => {
    S.abertos.add(`eq-${b.dataset.id}`);
    S.analiseEquipe = null;
    desenharAnalise();
    telaEquipes.atualizar(true);
    setTimeout(() => document.querySelector(`#i-${CSS.escape(b.dataset.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    toast('Ajuste o foco e as instruções desta equipe e salve.');
  },
  'eq-especializar': (b) => {
    const f = $('[data-form="equipe"]');
    f.querySelector('[name="familia"]').value = b.dataset.familia ?? '';
    $('#nova-equipe').scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.querySelector('[name="nome"]').focus();
  },
  projeto: (b) => {
    S.draft = $('#pedido')?.value ?? S.draft;
    S.proj = b.dataset.id;
    localStorage.setItem('orq.proj', S.proj);
    S.sel = null;
    S.novoProj = false;
    telaInicio.novoProjeto();
    telaInicio.modo();
    telaInicio.atualizar();
  },
  'comecar-escolher-pasta': async () => {
    const escolhida = await escolherPastaNativa($('#cm-pasta').value);
    if (escolhida) {
      telaComecar.pasta = escolhida;
      $('#cm-pasta').value = escolhida;
    }
  },
  'comecar-pasta-ok': async () => {
    await api('POST', '/api/ajustes/geral', { pastaProjetos: $('#cm-pasta').value });
    telaComecar.fase = 'objetivos';
    telaComecar.render();
  },
  'comecar-objetivo': (b) => {
    const id = b.dataset.id;
    telaComecar.objetivos.has(id) ? telaComecar.objetivos.delete(id) : telaComecar.objetivos.add(id);
    telaComecar.render();
    $(`[data-acao="comecar-objetivo"][data-id="${CSS.escape(id)}"]`)?.focus();
  },
  'comecar-objetivos-ok': () => telaComecar.concluirObjetivos([...telaComecar.objetivos]),
  'comecar-objetivos-pular': () => telaComecar.concluirObjetivos([]),
  'comecar-marcar': (b) => {
    const id = b.dataset.id;
    telaComecar.escolhidas.has(id) ? telaComecar.escolhidas.delete(id) : telaComecar.escolhidas.add(id);
    telaComecar.render();
    $(`[data-acao="comecar-marcar"][data-id="${CSS.escape(id)}"]`)?.focus();
  },
  'comecar-continuar': () => {
    const faltam = telaComecar.opcoes().filter((i) => telaComecar.escolhidas.has(i.id) && !telaComecar.instalada(i));
    if (faltam.length) {
      telaComecar.fase = 'confirmar';
      return telaComecar.render();
    }
    return telaComecar.confirmar();
  },
  'comecar-voltar': () => {
    telaComecar.fase = 'escolher';
    telaComecar.render();
  },
  'comecar-instalar': () => telaComecar.confirmar(),
  'comecar-reinstalar': (b) => telaComecar.instalar(S.d.ias.find((i) => i.id === b.dataset.id)),
  'comecar-fim': () => (location.hash = '#/'),
  'ia-instalar': async (b) => {
    const ia = S.d.ias.find((i) => i.id === b.dataset.id);
    const plano = S.d.planos[ia.tipo];
    if (!confirm(`Instalar ${ia.nome}?\n\n${plano.descricao}\nComando:\n${plano.comando}`)) return;
    await instalarIA(ia);
  },
  'ia-entrar': (b) => entrarIA(S.d.ias.find((i) => i.id === b.dataset.id)),
  'conta-entrar': async (b) => {
    const ia = S.d.ias.find((i) => i.id === b.dataset.id);
    const conta = ia?.contas?.find((c) => c.id === b.dataset.conta);
    const plano = S.d.planos[ia.tipo];
    const { sessao, comando } = await api('POST', `/api/ias/${ia.id}/entrar?conta=${encodeURIComponent(b.dataset.conta)}`);
    return abrirTerminal({ titulo: `Entrar na conta "${conta?.nome ?? ''}": ${ia.nome}`, descricao: `Faça o login com a conta que você quer usar aqui. Ela fica guardada numa pasta só desta conta. ${plano?.entrar?.dica ?? ''}`, comando, sessao, token, esc });
  },
  'conta-testar': async (b) => {
    b.textContent = 'Testando…';
    try {
      const r = await api('POST', `/api/ias/${b.dataset.id}/testar?conta=${encodeURIComponent(b.dataset.conta)}`);
      if (r.ok) toast(`A conta respondeu em ${(r.ms / 1000).toFixed(1)} s.`);
      else mostrarFalhaTeste(S.d.ias.find((i) => i.id === b.dataset.id), r);
    } finally {
      b.textContent = 'Testar';
    }
  },
  'conta-liberar': async (b) => {
    await api('PATCH', `/api/ias/${b.dataset.id}/contas/${encodeURIComponent(b.dataset.conta)}`, { liberar: true });
    toast('Conta liberada.');
  },
  'conta-remover': async (b) => {
    if (!(await perguntar({ titulo: 'Remover esta conta do rodízio?', texto: 'A IA deixa de usar esta conta. O login e a pasta de perfil continuam no computador.', sim: 'Remover', nao: 'Cancelar' }))) return;
    await api('DELETE', `/api/ias/${b.dataset.id}/contas/${encodeURIComponent(b.dataset.conta)}`);
    toast('Conta removida.');
  },
  'trocar-pasta-padrao': async () => {
    const escolhida = window.singularize ? await escolherPastaNativa(S.d.geral.pastaProjetos) : prompt('Pasta padrão dos projetos:', S.d.geral.pastaProjetos ?? '');
    if (!escolhida) return;
    await api('POST', '/api/ajustes/geral', { pastaProjetos: escolhida });
    toast('Pasta padrão atualizada. Vale para os próximos projetos.');
  },
  'mq-testar': async (b) => {
    const m = await api('POST', `/api/maquinas/${b.dataset.id}/testar`);
    toast(m.estado === 'ok' ? `Conectou em ${m.nome}.` : `Não conectou: ${m.erro}`, m.estado === 'ok' ? '' : 'erro');
  },
  'mq-terminal': (b) => terminalMaquina(`/api/maquinas/${b.dataset.id}/terminal`, 'Terminal remoto', 'Se for a primeira conexão, confira a máquina e digite a senha se pedir. Para sair, digite exit.'),
  'mq-chave': async (b) => {
    await terminalMaquina(`/api/maquinas/${b.dataset.id}/chave`, 'Acesso sem senha', 'Digite a senha da máquina uma vez. Depois disso, o app entra sozinho.');
    acoes['mq-testar'](b);
  },
  'mq-remover': (b) => confirm('Remover esta máquina do app? Nada é apagado nela.') && api('DELETE', `/api/maquinas/${b.dataset.id}`),
  'passos-fechar': () => {
    localStorage.setItem('orq.passos', 'ok');
    telaInicio.passos();
  },
  'focar-pedido': () => {
    if (!S.d.projetos.length) {
      S.novoProj = true;
      telaInicio.novoProjeto();
      return toast('Crie um projeto primeiro.');
    }
    if (S.modo !== 'tarefa') acoes.modo({ dataset: { modo: 'tarefa' } });
    $('#pedido')?.focus();
  },
  'novo-projeto': () => {
    S.novoProj = S.novoProj === true ? false : true;
    telaInicio.novoProjeto();
  },
  'editar-projeto': () => {
    S.novoProj = S.novoProj === 'editar' ? false : 'editar';
    telaInicio.novoProjeto();
  },
  'pj-escolher-pasta': async () => {
    const escolhida = await escolherPastaNativa($('#pj-pasta').value);
    if (escolhida) {
      $('#pj-pasta').value = escolhida;
      telaInicio.pastaManual = true;
      $('#pj-pasta-dica').textContent = 'Pasta escolhida por você.';
    }
  },
  'fechar-projeto': () => {
    S.novoProj = false;
    telaInicio.novoProjeto();
  },
  'abrir-livre-projeto': (b) => {
    localStorage.setItem('orq.cv.ws', b.dataset.id);
    location.hash = '#/livre';
  },
  modo: (b) => {
    S.draft = $('#pedido')?.value ?? S.draft;
    S.modo = b.dataset.modo;
    telaInicio.modo();
  },
  term: (b) => {
    S.term = b.dataset.id;
    telaInicio.terminalPills();
    telaInicio.terminal(S.term);
  },
  selecionar: (b) => {
    S.sel = b.dataset.id;
    telaInicio.esquerda();
    telaInicio.direita();
  },
  'remover-foto': (b) => {
    S.fotos.splice(Number(b.dataset.i), 1);
    telaInicio.fotos();
  },
  mover: (b) => moverNaFila(b.dataset.id, Number(b.dataset.delta)),
  'remover-tarefa': async (b) => {
    if (!confirm('Remover esta tarefa?')) return;
    await api('DELETE', `/api/tarefas/${b.dataset.id}`);
    if (b.dataset.voltar) location.hash = '#/';
  },
  responder: async (b) => {
    b.blur();
    b.disabled = true;
    try {
      await api('POST', `/api/tarefas/${b.dataset.id}/responder`, { resposta: b.dataset.resposta });
      toast('Resposta enviada. A equipe continua.');
    } catch (e) {
      await recarregarTarefa(b.dataset.id);
      throw e;
    }
  },
  aprovar: async (b) => {
    await api('POST', `/api/tarefas/${b.dataset.id}/aprovar`);
    toast('Entrega aprovada. Os aprendizados foram promovidos no vault.');
  },
  'questionar-equipe': (b) => {
    S.questionarPara = b.dataset.equipe;
    const sel = $('#q-para');
    if (sel) sel.value = b.dataset.equipe;
    $('#r-conversa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('#q-texto')?.focus(), 300);
  },
  'tv-recolher': () => {
    const aberto = $('#r-treinos-vivo .tv-cab')?.getAttribute('aria-expanded') === 'true';
    gravarLocal('orq.tv.recolhido', aberto ? '1' : '0');
    treinosVivos();
  },
  'tv-fechar': (b) => {
    const atuais = (lerLocal('orq.tv.fechados', '') || '').split(',').filter(Boolean).slice(-50);
    gravarLocal('orq.tv.fechados', [...atuais, b.dataset.id].join(','));
    treinosVivos();
  },
  'abrir-devolver': () => {
    S.devolvendo = !S.devolvendo;
    telaTarefa.atualizar(true);
  },
  cancelar: (b) => confirm('Cancelar esta tarefa? O que já foi feito fica no worktree e na nota.') && api('POST', `/api/tarefas/${b.dataset.id}/cancelar`),
  diagnostico: () => gerarDiagnostico(),
  'bk-exportar': async (b) => {
    b.disabled = true;
    try {
      const partes = [...document.querySelectorAll('[name="bk-parte"]:checked')].map((x) => x.value);
      const r = await api('POST', '/api/backup/exportar', { partes, cerebro: $('#bk-cerebro').checked, segredos: $('#bk-segredos').checked });
      $('#bk-exportado').innerHTML = `Salvo: <code class="mono">${esc(r.arquivo)}</code> (${tamanho(r.tamanho)})${window.singularize?.mostrarArquivo ? ` <button type="button" class="link" data-acao="bk-mostrar" data-arquivo="${esc(r.arquivo)}">Mostrar na pasta</button>` : ''}`;
      toast('Backup exportado.');
    } finally {
      b.disabled = false;
    }
  },
  'bk-mostrar': (b) => window.singularize?.mostrarArquivo?.(b.dataset.arquivo),
  'bk-importar': async (b) => {
    const modo = document.querySelector('[name="bk-modo"]:checked')?.value ?? 'juntar';
    if (modo === 'substituir' && !confirm('Substituir? O que não estiver no arquivo será removido (o estado atual fica guardado num backup automático).')) return;
    b.disabled = true;
    try {
      const r = await api('POST', '/api/backup/importar', { conteudo: telaBackup.importado, modo });
      toast(`Importado: ${contagemTexto(r.contagem)}${r.notasGravadas ? ` · ${r.notasGravadas} notas do cérebro` : ''}.`);
      await carregar();
    } finally {
      b.disabled = false;
    }
  },
  'bk-restaurar': async (b) => {
    if (!confirm('Voltar tudo para este backup? O estado atual fica guardado antes, num backup automático.')) return;
    await api('POST', `/api/backup/automaticos/${encodeURIComponent(b.dataset.nome)}/restaurar`);
    toast('Restaurado.');
    await carregar();
  },
  testar: async (b) => {
    await api('POST', `/api/tarefas/${b.dataset.id}/teste`).catch((e) => toast(e.message, 'erro'));
    toast('A equipe está preparando o ambiente de teste. O link aparece aqui quando estiver no ar.');
  },
  'parar-teste': (b) => api('POST', `/api/tarefas/${b.dataset.id}/teste/parar`).catch((e) => toast(e.message, 'erro')),
  'teste-corrigir': async (b) => {
    b.disabled = true;
    b.textContent = 'Mandando para a equipe…';
    await api('POST', `/api/tarefas/${b.dataset.id}/teste/corrigir`).catch((e) => toast(e.message, 'erro'));
    toast('A equipe está corrigindo. O quadro do teste mostra o andamento e o app sobe de novo sozinho.');
  },
  copiar: async (b) => {
    try {
      await navigator.clipboard.writeText(b.dataset.valor);
      toast('Copiado.');
    } catch {
      toast(b.dataset.valor);
    }
  },
  corrigir: async (b) => {
    await api('POST', `/api/tarefas/${b.dataset.id}/corrigir`).catch((e) => toast(e.message, 'erro'));
    toast('A equipe vai corrigir o que o avaliador apontou. Volta para você quando o avaliador conferir.');
    telaTarefa.atualizar(true);
  },
  'salvar-comandos': async () => {
    const r = await api('PUT', '/api/ajustes/comandos', { texto: $('#r-comandos').value });
    S.d.comandosLiberados = r.lista;
    toast(r.lista.length ? `${r.lista.length} comandos liberados para as IAs.` : 'Nenhum comando liberado: as IAs não rodam nada no terminal.');
  },
  retomar: async (b) => {
    b.disabled = true;
    await api('POST', `/api/tarefas/${b.dataset.id}/retomar`).catch((e) => {
      b.disabled = false;
      throw e;
    });
    toast('Tarefa de volta à fila. O gestor tenta de novo com as IAs ligadas agora.');
  },
  abrir: (b) => {
    const k = b.dataset.chave;
    S.abertos.has(k) ? S.abertos.delete(k) : S.abertos.add(k);
    rotaAtual().tela.atualizar(true);
  },
  'remover-equipe': (b) => confirm('Remover esta equipe?') && api('DELETE', `/api/equipes/${b.dataset.id}`),
  'remover-ia': (b) => confirm('Remover esta IA do sistema?') && api('DELETE', `/api/ias/${b.dataset.id}`),
  detectar: async () => {
    await api('POST', '/api/ias/detectar');
    toast('Procura concluída.');
  },
  'hr-instalar': async () => {
    const completo = !!$('#hr-completo')?.checked;
    const r = await api('POST', '/api/headroom/instalar', { completo });
    S.hrRecusado = false;
    if (r?.precisa) {
      // Falta uma dependência: explica, pede permissão e só instala com o "sim".
      const ok = await perguntar({ titulo: `O Headroom precisa do ${r.precisa.nome}`, texto: `${r.precisa.descricao} Posso instalar?`, detalhe: r.precisa.comando, sim: `Instalar o ${r.precisa.nome} e continuar`, nao: 'Agora não' });
      if (!ok) {
        S.hrRecusado = r.precisa.nome;
        telaIAs.headroom();
        return;
      }
      const { sessao, comando } = await api('POST', '/api/headroom/dependencia', { id: r.precisa.id, completo });
      const fim = await abrirTerminal({ titulo: `Instalando o ${r.precisa.nome}`, descricao: 'Instala só para o seu usuário. Quando terminar, o Headroom é instalado em seguida, sozinho.', comando, sessao, token, esc });
      if (fim?.codigo !== 0) return toast(`O ${r.precisa.nome} não foi instalado. Veja o terminal e tente de novo.`, 'erro');
    }
    const det = $('#log-headroom')?.closest('details');
    if (det) det.open = true;
    toast('Instalando o Headroom. Acompanhe pelo log.');
  },
  'hr-economia': async () => {
    const { texto } = await api('GET', '/api/headroom/economia');
    const el = $('#r-economia');
    el.textContent = texto;
    el.style.display = 'block';
  },
  'liberar-cota': (b) => api('PATCH', `/api/ias/${b.dataset.id}`, { liberarCota: true }),
  'testar-ia': async (b) => {
    b.disabled = true;
    b.textContent = 'Testando…';
    try {
      const r = await api('POST', `/api/ias/${b.dataset.id}/testar`);
      if (r.ok) toast(`Respondeu em ${(r.ms / 1000).toFixed(1)} s.`);
      else mostrarFalhaTeste(S.d.ias.find((i) => i.id === b.dataset.id), r);
    } finally {
      b.disabled = false;
      b.textContent = 'Testar';
    }
  },
};

document.addEventListener('click', (ev) => {
  const cv = ev.target.closest('[data-cv]');
  if (cv && montada === telaCanvas) {
    ev.preventDefault();
    return Promise.resolve(telaCanvas.clique(cv)).catch(() => {});
  }
  const b = ev.target.closest('[data-acao]');
  if (!b || !acoes[b.dataset.acao]) return;
  ev.preventDefault();
  Promise.resolve(acoes[b.dataset.acao](b)).catch(() => {});
});

const formularios = {
  tarefa: () => enviarTarefa(),
  projeto: async (f) => {
    const dados = ler(f);
    const corpo = { nome: dados.nome, pasta: dados.pasta, maquinaId: dados.maquinaId || null, modo: dados.modo, worktrees: !!dados.worktrees, ias: new FormData(f).getAll('ias') };
    const p = f.dataset.editar ? await api('PATCH', `/api/projetos/${f.dataset.editar}`, corpo) : await api('POST', '/api/projetos', corpo);
    if (f.dataset.editar) toast('Projeto salvo.');
    S.novoProj = false;
    S.proj = p.id;
    localStorage.setItem('orq.proj', p.id);
    telaInicio.novoProjeto();
    telaInicio.atualizar();
    $('#pedido')?.focus();
  },
  terminal: async (f) => {
    const campo = $('#msg-term');
    if (!campo.value.trim()) return;
    await api('POST', `/api/terminais/${S.term}/mensagem`, { texto: campo.value, projetoId: telaInicio.projetoAlvo()?.id });
    campo.value = '';
  },
  'terminal-direto': async (f) => {
    const campo = f.elements.texto;
    if (!campo.value.trim()) return;
    await api('POST', `/api/terminais/${f.dataset.id}/mensagem`, { texto: campo.value, projetoId: S.proj !== 'todos' ? S.proj : undefined });
    campo.value = '';
  },
  responder: async (f) => {
    const resposta = f.elements.resposta.value.trim();
    if (!resposta) return;
    f.elements.resposta.blur();
    try {
      await api('POST', `/api/tarefas/${f.dataset.id}/responder`, { resposta });
      toast('Resposta enviada. A equipe continua.');
    } catch (e) {
      // A pergunta já tinha sido respondida (ou a tarefa andou): atualiza a tela com o estado real.
      await recarregarTarefa(f.dataset.id);
      throw e;
    }
  },
  questionar: async (f) => {
    const texto = f.elements.texto.value.trim();
    if (!texto) return;
    S.questionarPara = f.elements.para.value;
    await api('POST', `/api/tarefas/${f.dataset.id}/questionar`, { para: f.elements.para.value, texto });
    f.elements.texto.value = '';
    document.activeElement?.blur();
    toast('Pergunta enviada. A resposta aparece aqui.');
  },
  devolver: async (f) => {
    await api('POST', `/api/tarefas/${f.dataset.id}/devolver`, { motivo: f.elements.motivo.value });
    S.devolvendo = false;
    toast('Devolvida. Ela volta ao topo da fila do gestor.');
    document.activeElement?.blur();
    telaTarefa.atualizar(true);
  },
  maquina: async (f) => {
    const dados = ler(f);
    const m = await api('POST', '/api/maquinas', dados);
    f.reset();
    toast('Máquina adicionada. Testando a conexão…');
    acoes['mq-testar']({ dataset: { id: m.id } });
  },
  // Nova equipe: primeiro o gestor analisa; você confirma na proposta (criarProposta).
  equipe: async (f) => {
    const dados = ler(f);
    S.analiseEquipe = { dados, carregando: true };
    desenharAnalise();
    try {
      S.analiseEquipe = { dados, proposta: await api('POST', '/api/equipes/analisar', dados) };
    } catch (e) {
      S.analiseEquipe = null;
      toast(e.message);
    }
    desenharAnalise();
  },
  'conta-nova': async (f) => {
    const dados = ler(f);
    const { login, ...ia } = await api('POST', `/api/ias/${f.dataset.id}/contas`, { nome: dados.nome, env: dados.env, perfil: !!dados.perfil });
    upsert(S.d.ias, ia);
    f.reset();
    telaIAs.atualizar(true);
    const nova = ia.contas.at(-1);
    // Perfil separado: o login da conta nova já abre; ao terminar, o app testa e ela entra no rodízio.
    if (login) {
      const plano = S.d.planos[ia.tipo];
      return abrirTerminal({ titulo: `Entrar na conta "${nova?.nome ?? ''}": ${ia.nome}`, descricao: `Faça o login com a outra conta. Ela fica guardada numa pasta só dela. ${plano?.entrar?.dica ?? ''}`, comando: login.comando, sessao: login.sessao, token, esc });
    }
    toast('Conta adicionada ao rodízio.');
  },
  skill: async (f) => {
    const dados = ler(f);
    const corpo = { nome: dados.nome, descricao: dados.descricao, conteudo: dados.conteudo, todas: !!dados.todas, equipes: new FormData(f).getAll('equipes') };
    const k = f.dataset.id ? await api('PUT', `/api/skills/${encodeURIComponent(f.dataset.id)}`, corpo) : await api('POST', '/api/skills', corpo);
    toast(`Skill ${k.nome} salva. As equipes já herdam na próxima tarefa.`);
    location.hash = `#/skills/${encodeURIComponent(k.id)}`;
    if (telaSkills.editando === k.id) telaSkills.carregar();
  },
  'proposta-equipe': async (f) => {
    const { dados, proposta } = S.analiseEquipe ?? {};
    if (!proposta) return;
    const editado = ler(f);
    const e = await api('POST', '/api/equipes', {
      ...dados,
      nome: editado.nome || proposta.nome,
      desc: proposta.desc,
      familia: proposta.familia,
      foco: proposta.foco,
      contextos: proposta.contextos.join(', '),
      caminho: editado.caminho,
      instrucoes: editado.instrucoes,
      requer: dados.requer || (proposta.requerEditar ? 'editar' : ''),
      aprovacao: !!dados.aprovacao,
      treinoRecomendado: proposta.treino,
    });
    upsert(S.d.equipes, e);
    S.analiseEquipe = null;
    $('[data-form="equipe"]')?.reset();
    desenharAnalise();
    if (S.treinarAoCriar) {
      S.treinarAoCriar = false;
      location.hash = `#/treinar/${e.id}`;
      return;
    }
    toast(`Equipe ${e.nome} criada com o prompt de base. O gestor já pode usá-la.`);
  },
  treinar: (f) => treinoTelas.enviarTreinar(f),
  ia: async (f) => {
    const dados = ler(f);
    await api('POST', '/api/ias', { ...dados, capacidades: { arquivos: !!dados.arquivos, editar: !!dados.editar } });
    f.reset();
    toast('IA cadastrada.');
  },
  'editar-ia': async (f) => {
    const dados = ler(f);
    const niveis = 'nivel-padrao' in dados ? { rapido: dados['nivel-rapido'], padrao: dados['nivel-padrao'], forte: dados['nivel-forte'] } : undefined;
    await api('PATCH', `/api/ias/${f.dataset.id}`, { ...dados, niveis, capacidades: { arquivos: !!dados.arquivos, editar: !!dados.editar } });
    document.activeElement?.blur();
    S.abertos.delete(`ia-${f.dataset.id}`);
    telaIAs.atualizar(true);
    toast('Salvo.');
  },
};

document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-form]');
  if (f && montada === telaCanvas && telaCanvas.temFormulario(f.dataset.form)) {
    ev.preventDefault();
    return Promise.resolve(telaCanvas.enviar(f)).catch(() => {});
  }
  if (!f || !formularios[f.dataset.form]) return;
  ev.preventDefault();
  Promise.resolve(formularios[f.dataset.form](f)).catch(() => {});
});

document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'pj-maquina' && !telaInicio.pastaManual) $('#pj-pasta').value = pastaSugerida($('#pj-nome').value, ev.target.value);
  if (ev.target.dataset?.cvMudar && montada === telaCanvas) return telaCanvas.mudar(ev.target);
  const el = ev.target.closest('[data-mudar]');
  if (!el) return;
  const tipo = el.dataset.mudar;
  if (tipo === 'fotos') {
    S.fotos.push(...(await lerFotos(el.files)));
    el.value = '';
    return telaInicio.fotos();
  }
  if (tipo === 'tipo-nova') {
    const t = S.d.sistema.tipos?.[el.value];
    const f = el.form;
    f.elements.arquivos.checked = !!t?.capacidades?.arquivos;
    f.elements.editar.checked = !!t?.capacidades?.editar;
    f.elements.args.placeholder = (t?.args ?? []).join(' ');
    f.elements.modelo.value = t?.modelo ?? '';
    return;
  }
  if (tipo === 'mq-instalar') {
    if (!el.value) return;
    const m = S.d.maquinas.find((x) => x.id === el.dataset.id);
    const nome = NOMES_COMANDO[el.value];
    const tipoIA = el.value;
    el.value = '';
    if (!confirm(`Instalar ${nome} em ${m.nome}? A instalação roda num terminal aqui dentro; se pedir senha, digite nele.`)) return;
    return terminalMaquina(`/api/maquinas/${m.id}/instalar/${tipoIA}`, `Instalando ${nome} em ${m.nome}`, 'Depois de instalar, entre na conta abrindo o terminal da máquina e rodando a IA uma vez.');
  }
  if (tipo === 'niveis-auto') {
    S.d.niveisModelo = { automatico: el.checked };
    return api('PUT', '/api/ajustes/niveis', { automatico: el.checked }).then(() => toast(el.checked ? 'O modelo agora segue a dificuldade de cada etapa.' : 'Cada IA usa o modelo dela em tudo.')).catch(() => {});
  }
  if (tipo === 'hr-usar') return api('PATCH', '/api/headroom', { usar: el.checked }).catch(() => {});
  if (tipo === 'hr-porta') return api('PATCH', '/api/headroom', { porta: Number(el.value) }).catch(() => {});
  if (tipo === 'hr-ia') {
    const ias = [...document.querySelectorAll('[data-mudar="hr-ia"]:checked')].map((x) => x.value);
    return api('PATCH', '/api/headroom', { ias }).catch(() => {});
  }
  const valor = el.type === 'checkbox' ? (el.dataset.campo === 'requer' ? (el.checked ? 'editar' : null) : el.checked) : el.value;
  if (tipo === 'equipe') await api('PATCH', `/api/equipes/${el.dataset.id}`, { [el.dataset.campo]: valor }).catch(() => {});
  if (tipo === 'ia') await api('PATCH', `/api/ias/${el.dataset.id}`, { [el.dataset.campo]: valor }).catch(() => {});
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && ev.target.id === 'pedido') {
    ev.preventDefault();
    enviarTarefa().catch(() => {});
  }
});

document.addEventListener('input', (ev) => {
  // A pasta do projeto acompanha o nome até a pessoa editar a pasta.
  if (ev.target.id === 'pj-nome' && !telaInicio.pastaManual) $('#pj-pasta').value = pastaSugerida(ev.target.value, $('#pj-maquina')?.value);
  if (ev.target.id === 'pj-pasta') {
    telaInicio.pastaManual = true;
    $('#pj-pasta-dica').textContent = 'Pasta escolhida por você.';
  }
  if (ev.target.dataset?.cvMudar && montada === telaCanvas) telaCanvas.digitar(ev.target);
  if (ev.target.id === 'pedido') S.draft = ev.target.value;
});

// Balão das dicas: qualquer elemento com data-dica mostra a explicação ao passar o mouse ou focar.
const balao = document.createElement('div');
balao.className = 'balao';
balao.setAttribute('role', 'tooltip');
balao.hidden = true;
document.body.appendChild(balao);
const mostrarDica = (el) => {
  balao.textContent = el.dataset.dica;
  balao.hidden = false;
  const r = el.getBoundingClientRect();
  const b = balao.getBoundingClientRect();
  const x = Math.min(window.innerWidth - b.width - 12, Math.max(12, r.left + r.width / 2 - b.width / 2));
  const cima = r.top - b.height - 10;
  balao.style.left = `${x}px`;
  balao.style.top = `${cima > 8 ? cima : r.bottom + 10}px`;
};
const esconderDica = () => (balao.hidden = true);
document.addEventListener('pointerover', (ev) => {
  const el = ev.target.closest?.('[data-dica]');
  el ? mostrarDica(el) : esconderDica();
});
document.addEventListener('focusin', (ev) => (ev.target.dataset?.dica ? mostrarDica(ev.target) : esconderDica()));
document.addEventListener('focusout', esconderDica);
document.addEventListener('keydown', (ev) => ev.key === 'Escape' && esconderDica());
window.addEventListener('scroll', esconderDica, true);

// Colar print direto no pedido.
document.addEventListener('paste', async (ev) => {
  if (ev.target.id !== 'pedido') return;
  const imagens = [...(ev.clipboardData?.files ?? [])];
  if (!imagens.length) return;
  ev.preventDefault();
  S.fotos.push(...(await lerFotos(imagens)));
  telaInicio.fotos();
});

// Arrastar na fila.
let arrastando = null;
document.addEventListener('dragstart', (ev) => {
  const li = ev.target.closest('[data-arrastar]');
  if (!li) return;
  arrastando = li.dataset.arrastar;
  li.classList.add('arrastando');
  ev.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (ev) => {
  const li = ev.target.closest('[data-arrastar]');
  if (!li || !arrastando) return;
  ev.preventDefault();
  document.querySelectorAll('.fila li.alvo').forEach((x) => x.classList.remove('alvo'));
  li.classList.add('alvo');
});
document.addEventListener('dragend', () => {
  arrastando = null;
  document.querySelectorAll('.fila li').forEach((x) => x.classList.remove('alvo', 'arrastando'));
});
// Arquivo solto fora do pedido não pode abrir no lugar do app.
window.addEventListener('dragover', (ev) => ev.dataTransfer?.types?.includes('Files') && ev.preventDefault());
window.addEventListener('drop', (ev) => ev.dataTransfer?.files?.length && !ev.target.closest?.('[data-form="tarefa"]') && ev.preventDefault());
// Arrastar arquivos do computador para o pedido.
document.addEventListener('dragover', (ev) => {
  if (!ev.target.closest?.('[data-form="tarefa"]') || !ev.dataTransfer?.types?.includes('Files')) return;
  ev.preventDefault();
  ev.target.closest('[data-form="tarefa"]').classList.add('soltando');
});
document.addEventListener('dragleave', (ev) => ev.target.closest?.('[data-form="tarefa"]')?.classList.remove('soltando'));
document.addEventListener('drop', async (ev) => {
  const form = ev.target.closest?.('[data-form="tarefa"]');
  if (!form || !ev.dataTransfer?.files?.length) return;
  ev.preventDefault();
  form.classList.remove('soltando');
  S.fotos.push(...(await lerFotos(ev.dataTransfer.files)));
  telaInicio.fotos();
});
document.addEventListener('drop', (ev) => {
  const li = ev.target.closest('[data-arrastar]');
  if (!li || !arrastando) return;
  ev.preventDefault();
  const ids = naFila().map((t) => t.id).filter((id) => id !== arrastando);
  ids.splice(ids.indexOf(li.dataset.arrastar), 0, arrastando);
  api('POST', '/api/fila/ordem', { ids }).catch(() => {});
});

// ------------------------------------------------------------------ resumo de volta

// "Enquanto você estava fora": guarda quando o operador interagiu pela última vez
// e, ao voltar depois de um tempo, mostra o que aconteceu desde então.
const AUSENCIA_MIN = 10 * 60_000;
const IGNORAR_NO_RESUMO = new Set(['agente.iniciado', 'agente.criado']);
const resumo = {
  aberto: false,
  desde: null,
  itens: [],
  visto() {
    return Date.parse(lerLocal('orq.visto', '')) || 0;
  },
  marcar() {
    localStorage.setItem('orq.visto', new Date().toISOString());
  },
  async verificar(forcar = false) {
    const visto = this.visto();
    if (!forcar && (!visto || Date.now() - visto < AUSENCIA_MIN)) {
      if (!visto) this.marcar();
      return;
    }
    const desde = forcar ? new Date(Date.now() - 12 * 3600_000).toISOString() : new Date(visto).toISOString();
    const { itens } = await api('GET', `/api/resumo?desde=${encodeURIComponent(desde)}`);
    const relevantes = itens.filter((i) => !IGNORAR_NO_RESUMO.has(i.tipo));
    if (!relevantes.length && !forcar) return this.marcar();
    this.desde = desde;
    this.itens = relevantes;
    this.aberto = true;
    this.render();
  },
  novo(item) {
    if (this.aberto && !IGNORAR_NO_RESUMO.has(item.tipo)) {
      this.itens.push(item);
      this.render(true);
    }
  },
  fechar() {
    this.aberto = false;
    this.marcar();
    $('#r-resumo').innerHTML = '';
  },
  async comIA(botao) {
    botao.disabled = true;
    botao.textContent = 'Resumindo…';
    try {
      const r = await api('POST', '/api/resumo/ia', { desde: this.desde });
      this.texto = { texto: r.texto, ia: r.ia };
      this.render();
    } finally {
      botao.disabled = false;
      botao.textContent = 'Resumir com IA';
    }
  },
  render(soLista = false) {
    const caixa = $('#r-resumo');
    if (!this.aberto) return (caixa.innerHTML = '');
    const icone = { 'tarefa.revisao': 'ok', 'tarefa.concluida': 'ok', 'tarefa.esperando': 'espera', 'tarefa.falhou': 'erro', 'agente.saiu': 'erro', 'agente.quieto': 'espera', mensagem: 'acento', 'cerebro.aprendeu': 'acento' };
    const lista = this.itens
      .slice(-40)
      .map(
        (i) => `<li><span class="ponto" style="background:var(--${{ ok: 'ok', espera: 'espera', erro: 'erro', acento: 'acento' }[icone[i.tipo] ?? 'acento']})"></span>
        <span><span class="dica">${new Date(i.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> ${esc(i.texto)}${i.trecho ? `<span class="mono" style="display:block;font-size:11.5px;color:var(--mudo);white-space:pre-wrap">${esc(i.trecho.split("\n").slice(-2).join("\n").slice(-220))}</span>` : ''}</span></li>`,
      )
      .join('');
    if (soLista && $('#r-resumo-lista')) return ($('#r-resumo-lista').innerHTML = lista);
    const minutos = Math.round((Date.now() - Date.parse(this.desde)) / 60000);
    const quando = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')}`;
    caixa.innerHTML = `<section class="resumo-caixa" role="dialog" aria-label="Enquanto você estava fora">
      <div style="display:flex;align-items:baseline;gap:12px"><h2 class="titulo" style="font-size:24px">Enquanto você estava fora</h2><span class="dica">últimos ${quando}</span><div class="cresce"></div>
        <button type="button" class="icone-btn" data-acao="resumo-fechar" aria-label="Fechar">${I.x}</button></div>
      ${this.texto ? `<p class="serif" style="margin:0;font-size:17px;line-height:1.5;white-space:pre-wrap">${esc(this.texto.texto)}</p>${this.texto.ia ? `<span class="dica">por ${esc(this.texto.ia)}</span>` : ''}` : ''}
      <ul class="resumo-lista" id="r-resumo-lista">${lista || '<li class="dica">Nada relevante aconteceu.</li>'}</ul>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn contorno pequeno" data-acao="resumo-ia">Resumir com IA</button>
        <button type="button" class="btn pequeno" data-acao="resumo-fechar">Entendi</button>
      </div>
    </section>`;
  },
};
acoes['resumo-fechar'] = () => resumo.fechar();
acoes['resumo-ia'] = (b) => resumo.comIA(b);
acoes['resumo-abrir'] = () => {
  resumo.texto = null;
  return resumo.verificar(true);
};

let ultimaMarca = 0;
const registrarPresenca = () => {
  if (resumo.aberto || Date.now() - ultimaMarca < 30_000) return;
  ultimaMarca = Date.now();
  resumo.marcar();
};
document.addEventListener('pointerdown', registrarPresenca, { capture: true });
document.addEventListener('keydown', registrarPresenca, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumo.verificar().catch(() => {});
});

setInterval(() => montada === telaInicio && rotaAtual().nome === 'inicio' && telaInicio.esquerda(), 30_000);

conectar();
