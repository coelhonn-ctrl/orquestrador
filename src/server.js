import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { cfg, expandirCaminho } from './config.js';
import { criarStore } from './store/index.js';
import { criarBarramento } from './eventos.js';
import { criarVault } from './vault.js';
import { criarGestor } from './gestor.js';
import { TIPOS, detectar, comandoDe, executar, explicarFalha, montarArgs, definirRegistro, falhaPermanente } from './adaptadores.js';
import { criarDiagnostico } from './diagnostico.js';
import { criarEquipes } from './equipes.js';
import { criarTreino, NIVEIS, estimar } from './treino.js';
import { criarBackup } from './backup.js';
import { iaPublica } from './publico.js';
import { criarHeadroom } from './headroom.js';
import { criarCerebro } from './cerebro.js';
import { criarAtividade } from './atividade.js';
import { criarAgentes } from './agentes.js';
import { registrarRotasAgentes } from './rotas-agentes.js';
import { atualizarPath } from './caminhos.js';
import { testarMaquina, argsSsh, comandoRemoto, comandoSsh, chavePublicaLocal, aspas } from './maquinas.js';
import { PLANOS, comandoDeInstalacao, DEPENDENCIAS, comandoDeDependencia } from './instalacao-ias.js';
import { resolverExecutavel, esquecerResolvidos, envDaIA } from './adaptadores.js';

const store = await criarStore(cfg);
const bus = await criarBarramento(cfg);
const vault = criarVault(cfg.vault, cfg.padrao.areas);
const headroom = criarHeadroom({ store, bus, raiz: cfg.raiz });
const gestor = criarGestor({ cfg, store, bus, vault, headroom });
const cerebro = criarCerebro(cfg.vault);
const atividade = criarAtividade({ dir: cfg.dados, bus });
const agentes = criarAgentes({ cfg, store, bus, cerebro, headroom, atividade });
const equipes = criarEquipes({ store, bus, vault, padrao: cfg.padrao });
const diagnostico = criarDiagnostico({ cfg, store, headroom });
const treino = criarTreino({ cfg, store, bus, vault });
const VERSAO = JSON.parse(fs.readFileSync(path.join(cfg.raiz, 'package.json'), 'utf8')).version;
const backup = criarBackup({ cfg, store, bus, vault, versao: VERSAO });
definirRegistro(diagnostico.registrarExecucao);

// ---------------------------------------------------------------- semente e detecção

const semear = async () => {
  // IAs padrão que ainda não existem (inclusive as que chegaram numa versão nova do app).
  const existentes = new Set((await store.listar('ias')).map((i) => i.id));
  for (const ia of cfg.padrao.ias) {
    if (existentes.has(ia.id)) continue;
    const tipo = TIPOS[ia.tipo];
    // Nenhuma IA começa ativa: o usuário escolhe na tela "Começar". Só o terminal comum vem ligado.
    await store.salvar('ias', { args: [], argsInterativo: [], env: {}, modelo: tipo.modelo ?? '', capacidades: tipo.capacidades, ...ia, ativa: ia.tipo === 'shell', comando: ia.comando ?? '' });
  }
};

const detectarIAs = async () => {
  atualizarPath();
  esquecerResolvidos();
  const ias = await store.listar('ias');
  for (const ia of ias) {
    if (ia.tipo === 'simulado') continue;
    const caminho = await detectar(comandoDe(ia));
    ia.caminho = caminho;
    ia.status = caminho ? 'pronto' : 'ausente';
    await store.salvar('ias', ia);
    bus.emitir({ tipo: 'ia', ia: iaPublica(ia) });
  }
  const simulado = ias.find((i) => i.tipo === 'simulado');
  if (simulado) {
    simulado.status = 'pronto';
    if (cfg.simular) simulado.ativa = true;
    await store.salvar('ias', simulado);
    bus.emitir({ tipo: 'ia', ia: iaPublica(simulado) });
  }
  return ias;
};

// Antes de qualquer migração desta versão, guarda o estado como estava.
await backup.aoIniciar();
await semear();
await detectarIAs();
// Só gestor e avaliador vêm prontos; as outras equipes nascem dos objetivos ou do gestor.
await equipes.garantirFixas();
await equipes.ajustar();
await equipes.completarFamilias();
await treino.aoIniciar();

// O cérebro mudou (uma equipe aprendeu, uma tarefa andou, você editou no Obsidian): avisa a tela do grafo.
{
  let espera = null;
  const avisar = () => {
    clearTimeout(espera);
    espera = setTimeout(() => bus.emitir({ tipo: 'cerebro' }), 700);
  };
  try {
    fs.watch(cfg.vault, { recursive: true }, (_, nome) => !String(nome ?? '').includes('.obsidian') && avisar());
  } catch {
    try {
      fs.watch(cfg.vault, avisar);
    } catch {}
  }
}
vault.garantir(await store.listar('equipes'));

// ---------------------------------------------------------------- utilidades HTTP

const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status });
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => (r === undefined ? null : res.json(r))).catch(next);
const campo = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const idDe = (nome) =>
  campo(nome, 40)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `x${Date.now()}`;

const tokenValido = (recebido) => {
  if (!cfg.token) return true;
  const a = Buffer.from(String(recebido ?? ''));
  const b = Buffer.from(cfg.token);
  return a.length === b.length && timingSafeEqual(a, b);
};

const parseEnv = (textoEnv, anterior = {}) => {
  const saida = {};
  for (const linha of String(textoEnv ?? '').split('\n')) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    saida[m[1]] = m[2] === '••••' && anterior[m[1]] !== undefined ? anterior[m[1]] : m[2];
  }
  return saida;
};

const tarefaEm = async (id) => {
  const t = await store.obter('tarefas', id);
  if (!t) throw erro(404, 'Tarefa não encontrada.');
  return t;
};

// ---------------------------------------------------------------- app

const app = express();
app.disable('x-powered-by');
// Limite alto: importar um backup com o cérebro inteiro manda tudo de uma vez.
app.use(express.json({ limit: '400mb' }));
// Sem cache: depois de atualizar o app, a tela sempre carrega a versão nova.
app.use(express.static(path.join(cfg.raiz, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.get('/icone.png', (_req, res) => res.sendFile(path.join(cfg.raiz, 'instalador', 'icone.png')));
app.get('/manual.md', (_req, res) => res.type('text/markdown; charset=utf-8').sendFile(path.join(cfg.raiz, 'MANUAL.md')));
app.use('/vendor/xterm', express.static(path.join(cfg.raiz, 'node_modules', '@xterm', 'xterm')));
app.use('/vendor/xterm-fit', express.static(path.join(cfg.raiz, 'node_modules', '@xterm', 'addon-fit')));

app.use('/api', (req, _res, next) => (tokenValido(req.get('x-orq-token') ?? req.query.token) ? next() : next(erro(401, 'Token inválido.'))));

app.get(
  '/api/estado',
  rota(async () => ({
    projetos: await store.listar('projetos'),
    equipes: await store.listar('equipes'),
    ias: (await store.listar('ias')).map(iaPublica),
    tarefas: await store.listar('tarefas'),
    agentes: await agentes.listar(),
    maquinas: await store.listar('maquinas'),
    areas: cerebro.areas(),
    terminais: bus.todasLinhas(),
    headroom: await headroom.estado(),
    comecar: (await store.obter('ajustes', 'comecar')) ?? { feito: false },
    treinos: await store.listar('treinos'),
    niveisTreino: Object.fromEntries(Object.entries(NIVEIS).map(([k, v]) => [k, { ...v, ...estimar(v) }])),
    objetivos: cfg.padrao.objetivos.map((o) => ({ id: o.id, nome: o.nome, desc: o.desc, equipes: o.equipes.map((e) => e.nome) })),
    geral: { pastaProjetos: cfg.pastaProjetos, ...((await store.obter('ajustes', 'geral')) ?? {}), separador: path.sep, casa: os.homedir() },
    planos: Object.fromEntries(Object.entries(PLANOS).map(([k, v]) => [k, { descricao: v.descricao, comando: comandoDeInstalacao(k).texto, entrar: { rotulo: v.entrar.rotulo, dica: v.entrar.dica } }])),
    sistema: { versao: VERSAO, dados: cfg.dados, desktop: !!process.env.ORQ_DESKTOP, plataforma: process.platform, simular: cfg.simular, maxAtivas: cfg.maxAtivas, vault: cfg.vault, store: store.tipo, tipos: Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [k, { rotulo: v.rotulo, comando: v.comando ?? '', args: v.args, interativo: v.interativo ?? [], capacidades: v.capacidades, modelo: v.modelo ?? '' }])) },
  })),
);

// Projetos. Modo: automatico (gestor decide e cria equipes), aprovacao (gestor propõe, você aprova), manual (tela livre).
const MODOS = ['automatico', 'aprovacao', 'manual'];
app.post(
  '/api/projetos',
  rota(async (req) => {
    const nome = campo(req.body.nome, 80);
    const maquinaId = campo(req.body.maquinaId, 80) || null;
    if (maquinaId && !(await store.obter('maquinas', maquinaId))) throw erro(400, 'Máquina não encontrada.');
    // Pasta remota fica como foi escrita (é caminho de lá); a local é expandida e criada aqui.
    const pasta = maquinaId ? campo(req.body.pasta, 400) : expandirCaminho(campo(req.body.pasta, 400));
    if (!nome) throw erro(400, 'Dê um nome ao projeto.');
    if (!pasta) throw erro(400, 'Informe a pasta do projeto.');
    if (!maquinaId) fs.mkdirSync(pasta, { recursive: true });
    const id = `${idDe(nome)}-${Date.now().toString(36)}`;
    const projeto = { id, nome, pasta, maquinaId, modo: MODOS.includes(req.body.modo) ? req.body.modo : 'automatico', ias: Array.isArray(req.body.ias) ? req.body.ias.map(String) : [], worktrees: !!req.body.worktrees, criado: new Date().toISOString() };
    await store.salvar('projetos', projeto);
    bus.emitir({ tipo: 'projeto', projeto });
    return projeto;
  }),
);

app.patch(
  '/api/projetos/:id',
  rota(async (req) => {
    const p = await store.obter('projetos', req.params.id);
    if (!p) throw erro(404, 'Projeto não encontrado.');
    if (req.body.nome !== undefined) p.nome = campo(req.body.nome, 80) || p.nome;
    if (req.body.maquinaId !== undefined) p.maquinaId = campo(req.body.maquinaId, 80) || null;
    if (req.body.pasta !== undefined) p.pasta = (p.maquinaId ? campo(req.body.pasta, 400) : expandirCaminho(campo(req.body.pasta, 400))) || p.pasta;
    if (Array.isArray(req.body.ias)) p.ias = req.body.ias.map(String);
    if (req.body.worktrees !== undefined) p.worktrees = !!req.body.worktrees;
    if (MODOS.includes(req.body.modo)) p.modo = req.body.modo;
    await store.salvar('projetos', p);
    bus.emitir({ tipo: 'projeto', projeto: p });
    // As equipes sob medida deste projeto só usam as IAs que ele permite.
    if (Array.isArray(req.body.ias)) await equipes.ajustar();
    return p;
  }),
);

app.delete(
  '/api/projetos/:id',
  rota(async (req) => {
    const ativas = (await store.listar('tarefas')).filter((t) => t.projetoId === req.params.id && !['concluida', 'cancelada'].includes(t.estado));
    if (ativas.length) throw erro(409, 'O projeto ainda tem tarefas abertas.');
    await store.remover('projetos', req.params.id);
    bus.emitir({ tipo: 'projeto.removido', id: req.params.id });
    return { ok: true };
  }),
);

// Tarefas
app.post(
  '/api/tarefas',
  rota(async (req) => {
    const textoPedido = campo(req.body.texto, 20000);
    if (!textoPedido) throw erro(400, 'Descreva a tarefa.');
    const projeto = await store.obter('projetos', campo(req.body.projetoId, 120));
    if (!projeto) throw erro(400, 'Escolha um projeto.');
    if (projeto.modo === 'manual') throw erro(409, 'Este projeto é manual: orquestre os agentes na tela livre.');
    const seq = await store.proximaSequencia('tarefa');
    const id = `T-${String(seq).padStart(3, '0')}`;
    const fotos = (Array.isArray(req.body.fotos) ? req.body.fotos : []).slice(0, 10).map((f, i) => vault.salvarFoto(id, i, f?.dados)).filter(Boolean);
    const tarefas = await store.listar('tarefas');
    const tarefa = {
      id,
      projetoId: projeto.id,
      titulo: campo(textoPedido.split('\n')[0], 90),
      texto: textoPedido,
      fotos,
      origem: campo(req.body.origem, 120) || null,
      estado: 'fila',
      posicao: Math.max(0, ...tarefas.map((t) => t.posicao ?? 0)) + 1,
      fase: 'Na fila do gestor.',
      plano: [],
      criada: new Date().toISOString(),
    };
    await store.salvar('tarefas', tarefa);
    bus.emitir({ tipo: 'tarefa', tarefa });
    setImmediate(gestor.tick);
    return tarefa;
  }),
);

app.post(
  '/api/fila/ordem',
  rota(async (req) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    const naFila = (await store.listar('tarefas')).filter((t) => t.estado === 'fila');
    const posicoes = naFila.map((t) => t.posicao).sort((a, b) => a - b);
    const ordenadas = [...ids.map((id) => naFila.find((t) => t.id === id)).filter(Boolean), ...naFila.filter((t) => !ids.includes(t.id))];
    for (const [i, t] of ordenadas.entries()) {
      t.posicao = posicoes[i];
      await store.salvar('tarefas', t);
      bus.emitir({ tipo: 'tarefa', tarefa: t });
    }
    return { ok: true };
  }),
);

app.get('/api/tarefas/:id/nota', rota(async (req) => ({ nota: vault.lerNota(await tarefaEm(req.params.id)), caminho: vault.caminhoNota({ id: req.params.id }) })));
app.post('/api/tarefas/:id/responder', rota((req) => gestor.responder(req.params.id, campo(req.body.resposta, 4000) || 'Ok')));
app.post('/api/tarefas/:id/aprovar', rota((req) => gestor.aprovar(req.params.id)));
app.post('/api/tarefas/:id/devolver', rota((req) => gestor.devolver(req.params.id, campo(req.body.motivo, 4000))));
app.post('/api/tarefas/:id/cancelar', rota((req) => gestor.cancelar(req.params.id)));
app.post('/api/tarefas/:id/retomar', rota((req) => gestor.retomar(req.params.id)));
app.delete(
  '/api/tarefas/:id',
  rota(async (req) => {
    const t = await tarefaEm(req.params.id);
    if (!['fila', 'concluida', 'cancelada', 'falhou'].includes(t.estado)) throw erro(409, 'Cancele a tarefa antes de remover.');
    await store.remover('tarefas', t.id);
    bus.emitir({ tipo: 'tarefa.removida', id: t.id });
    return { ok: true };
  }),
);

app.get('/api/anexos/:nome', (req, res) => {
  if (!tokenValido(req.get('x-orq-token') ?? req.query.token)) return res.status(401).end();
  const arq = vault.caminhoAnexo(req.params.nome);
  return fs.existsSync(arq) ? res.sendFile(arq) : res.status(404).end();
});

// Equipes
// Contextos: palavras-chave de quando usar a equipe (ex.: "balada, eventos, portaria").
const listaContextos = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/))
    .map((x) => campo(x, 40))
    .filter(Boolean)
    .slice(0, 20);

const salvarEquipe = async (e) => {
  await store.salvar('equipes', e);
  vault.garantir([e]);
  bus.emitir({ tipo: 'equipe', equipe: e });
  return e;
};

app.post(
  '/api/equipes',
  rota(async (req) => {
    const nome = campo(req.body.nome, 60);
    if (!nome) throw erro(400, 'Dê um nome à equipe.');
    const id = idDe(nome);
    if (await store.obter('equipes', id)) throw erro(409, 'Já existe uma equipe com esse nome.');
    return salvarEquipe({
      id,
      nome,
      desc: campo(req.body.desc, 300),
      principal: campo(req.body.principal, 60),
      reserva: campo(req.body.reserva, 60) || '',
      area: idDe(req.body.area || nome),
      requer: req.body.requer === 'editar' ? 'editar' : null,
      agentes: campo(req.body.agentes, 200),
      instrucoes: campo(req.body.instrucoes, 4000),
      familia: campo(req.body.familia, 60),
      foco: campo(req.body.foco, 600),
      contextos: listaContextos(req.body.contextos),
      aprovacao: !!req.body.aprovacao,
      ativa: true,
    }).then(async (e) => {
      // Sem IA escolhida (ou escolhida uma fora de uso), assume uma das IAs em uso.
      await equipes.ajustar();
      return (await store.obter('equipes', e.id)) ?? e;
    });
  }),
);

app.patch(
  '/api/equipes/:id',
  rota(async (req) => {
    const e = await store.obter('equipes', req.params.id);
    if (!e) throw erro(404, 'Equipe não encontrada.');
    for (const k of ['nome', 'desc', 'principal', 'reserva', 'agentes', 'instrucoes', 'familia', 'foco']) if (req.body[k] !== undefined) e[k] = campo(req.body[k], k === 'instrucoes' ? 4000 : k === 'foco' ? 600 : 300);
    if (req.body.contextos !== undefined) e.contextos = listaContextos(req.body.contextos);
    for (const k of ['aprovacao', 'ativa']) if (req.body[k] !== undefined) e[k] = !!req.body[k];
    if (req.body.requer !== undefined) e.requer = req.body.requer === 'editar' ? 'editar' : null;
    if (e.fixa) e.ativa = true;
    return salvarEquipe(e);
  }),
);

app.delete(
  '/api/equipes/:id',
  rota(async (req) => {
    const e = await store.obter('equipes', req.params.id);
    if (!e) throw erro(404, 'Equipe não encontrada.');
    if (e.fixa) throw erro(409, 'Gestor, avaliador e treinador fazem parte do sistema e não podem ser removidos.');
    await store.remover('equipes', e.id);
    bus.emitir({ tipo: 'equipe.removida', id: e.id });
    return { ok: true };
  }),
);

// IAs (contas e ferramentas de terminal)
const aplicarIA = (ia, body) => {
  if (body.nome !== undefined) ia.nome = campo(body.nome, 60) || ia.nome;
  if (body.comando !== undefined) ia.comando = campo(body.comando, 200);
  if (body.modelo !== undefined) ia.modelo = campo(body.modelo, 120);
  if (body.args !== undefined) ia.args = Array.isArray(body.args) ? body.args.map(String) : campo(body.args, 1000).split(/\s+/).filter(Boolean);
  if (body.argsInterativo !== undefined) ia.argsInterativo = Array.isArray(body.argsInterativo) ? body.argsInterativo.map(String) : campo(body.argsInterativo, 1000).split(/\s+/).filter(Boolean);
  if (body.env !== undefined) ia.env = parseEnv(body.env, ia.env);
  if (body.ativa !== undefined) {
    ia.ativa = !!body.ativa;
    delete ia.problema;
  }
  if (body.capacidades) ia.capacidades = { arquivos: !!body.capacidades.arquivos, editar: !!body.capacidades.editar };
  if (body.liberarCota) ia.limiteAte = null;
  return ia;
};

const salvarIA = async (ia) => {
  if (ia.tipo !== 'simulado') {
    ia.caminho = await detectar(comandoDe(ia));
    ia.status = ia.caminho ? 'pronto' : 'ausente';
  }
  await store.salvar('ias', ia);
  const publica = iaPublica(ia);
  bus.emitir({ tipo: 'ia', ia: publica });
  return publica;
};

app.post(
  '/api/ias',
  rota(async (req) => {
    const tipo = TIPOS[req.body.tipo] ? req.body.tipo : 'custom';
    const nome = campo(req.body.nome, 60) || TIPOS[tipo].rotulo;
    let id = idDe(nome);
    if (await store.obter('ias', id)) id = `${id}-${Date.now().toString(36)}`;
    const ia = aplicarIA({ id, tipo, nome, ativa: true, args: [], env: {}, comando: '', modelo: TIPOS[tipo].modelo ?? '', capacidades: TIPOS[tipo].capacidades }, req.body);
    if (tipo === 'custom' && !ia.comando) throw erro(400, 'Informe o comando que abre a IA no terminal.');
    return salvarIA(ia);
  }),
);

app.patch(
  '/api/ias/:id',
  rota(async (req) => {
    const ia = await store.obter('ias', req.params.id);
    if (!ia) throw erro(404, 'IA não encontrada.');
    const publica = await salvarIA(aplicarIA(ia, req.body));
    if (req.body.ativa !== undefined) await equipes.ajustar();
    return publica;
  }),
);

app.delete(
  '/api/ias/:id',
  rota(async (req) => {
    await store.remover('ias', req.params.id);
    bus.emitir({ tipo: 'ia.removida', id: req.params.id });
    await equipes.ajustar();
    return { ok: true };
  }),
);

app.post('/api/ias/detectar', rota(async () => (await detectarIAs()).map(iaPublica)));

app.post(
  '/api/ias/:id/testar',
  rota(async (req) => {
    const ia = await store.obter('ias', req.params.id);
    if (!ia) throw erro(404, 'IA não encontrada.');
    const inicio = Date.now();
    atualizarPath();
    esquecerResolvidos();
    const prompt = 'Responda apenas com o JSON {"status":"ok"}';
    const alvo = resolverExecutavel(comandoDe(ia), montarArgs(ia, prompt));
    const r = await executar(ia, prompt, { cwd: os.homedir(), timeoutMs: 120_000, velocidade: 4, envExtra: await headroom.envPara(ia) });
    const ok = r.codigo === 0;
    const detalhe = {
      ok,
      ms: Date.now() - inicio,
      motivo: ok ? '' : explicarFalha(ia, r),
      codigo: r.codigo,
      tempoEsgotado: !!r.timeout,
      comando: [alvo.comando, ...alvo.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
      pasta: os.homedir(),
      saida: r.saida.trim().slice(-4000),
      erro: r.erro.trim().slice(-4000),
    };
    if (!ok) console.error(`[testar ${ia.id}]`, JSON.stringify(detalhe));
    // O teste decide se a IA está com problema: passou, volta a ser usada; falha permanente, fica marcada.
    const atual = await store.obter('ias', ia.id);
    if (atual) {
      if (ok) delete atual.problema;
      else if (falhaPermanente(detalhe.motivo)) atual.problema = { motivo: detalhe.motivo, em: new Date().toISOString() };
      await store.salvar('ias', atual);
      bus.emitir({ tipo: 'ia', ia: iaPublica(atual) });
    }
    return detalhe;
  }),
);

// Headroom (compressão de contexto)
app.get('/api/headroom', rota(() => headroom.estado()));
app.post('/api/headroom/instalar', rota(async (req) => {
  // Falta algo (o Python)? Não instala nada: devolve o que falta para a tela pedir permissão.
  const req_ = await headroom.requisitos();
  if (!req_.ok) {
    const d = DEPENDENCIAS[req_.falta];
    return { precisa: { id: req_.falta, nome: d.nome, descricao: d.descricao, comando: d.exibir } };
  }
  headroom.instalar({ completo: !!req.body?.completo }).catch((e) => console.error('[headroom]', e));
  return { ok: true };
}));
// O usuário disse "sim": instala a dependência num terminal visível e, dando certo, segue com o Headroom.
app.post('/api/headroom/dependencia', rota(async (req) => {
  const id = DEPENDENCIAS[req.body?.id] ? req.body.id : 'python';
  const alvo = comandoDeDependencia(id);
  const sessao = `dependencia-${id}`;
  agentes.avulso(sessao, alvo.comando, alvo.args, {}).then(async (codigo) => {
    const r = await headroom.requisitos();
    bus.emitir({ tipo: 'avulso.fim', sessao, modo: 'dependencia', codigo: r.ok ? codigo : codigo || 1 });
    if (r.ok) headroom.instalar({ completo: !!req.body?.completo }).catch((e) => console.error('[headroom]', e));
  });
  return { sessao, comando: alvo.texto };
}));
app.patch('/api/headroom', rota((req) => headroom.configurar(req.body ?? {})));
app.get('/api/headroom/economia', rota(async () => ({ texto: await headroom.economia() })));

// Pasta padrão onde os projetos novos são criados (cada projeto pode escolher outra).
app.post(
  '/api/ajustes/geral',
  rota(async (req) => {
    const atual = (await store.obter('ajustes', 'geral')) ?? { id: 'geral' };
    if (req.body?.pastaProjetos !== undefined) {
      const pasta = expandirCaminho(campo(req.body.pastaProjetos, 400));
      if (!pasta) throw erro(400, 'Escolha uma pasta.');
      try {
        fs.mkdirSync(pasta, { recursive: true });
        fs.accessSync(pasta, fs.constants.W_OK);
      } catch {
        throw erro(400, 'Sem permissão para criar ou escrever nessa pasta. Escolha outra.');
      }
      atual.pastaProjetos = pasta;
    }
    await store.salvar('ajustes', { ...atual, id: 'geral' });
    const geral = { pastaProjetos: cfg.pastaProjetos, ...atual, separador: path.sep, casa: os.homedir() };
    bus.emitir({ tipo: 'geral', geral });
    return geral;
  }),
);

// Primeiro uso: o usuário escolhe as IAs. Nada é instalado aqui; só liga e desliga.
app.post(
  '/api/comecar',
  rota(async (req) => {
    const anterior = (await store.obter('ajustes', 'comecar')) ?? {};
    const comecar = { ...anterior, id: 'comecar', feito: true, em: new Date().toISOString() };
    // IAs escolhidas (quando vierem): as outras saem de uso.
    if (Array.isArray(req.body?.ias)) {
      const escolhidas = new Set(req.body.ias.map(String));
      for (const ia of await store.listar('ias')) {
        if (ia.tipo === 'shell') continue;
        ia.ativa = escolhidas.has(ia.id);
        await store.salvar('ias', ia);
        bus.emitir({ tipo: 'ia', ia: iaPublica(ia) });
      }
      comecar.ias = [...escolhidas];
    }
    let resultado = null;
    // Objetivos de uso: viram equipes. Lista vazia = pular (o gestor cria conforme os pedidos).
    if (Array.isArray(req.body?.objetivos)) {
      const validos = new Set(cfg.padrao.objetivos.map((o) => o.id));
      comecar.objetivos = req.body.objetivos.map(String).filter((o) => validos.has(o));
      // Na primeira vez (ou vindo de uma versão que criava equipes sozinha), tira as que vinham prontas.
      resultado = await equipes.aplicarObjetivos(comecar.objetivos, { trocar: !anterior.objetivosFeito });
      comecar.objetivosFeito = true;
    }
    await equipes.ajustar();
    await store.salvar('ajustes', comecar);
    bus.emitir({ tipo: 'comecar', comecar });
    return { ...comecar, equipes: resultado };
  }),
);

// Instalar ou entrar na conta de uma IA: só quando o usuário confirma, num terminal visível no app.
const terminalDeIA = async (req, modo) => {
  const ia = await store.obter('ias', req.params.id);
  if (!ia) throw erro(404, 'IA não encontrada.');
  const plano = PLANOS[ia.tipo];
  if (!plano) throw erro(400, 'Esta IA não tem instalação automática. Instale pelo site dela e use "Procurar de novo".');
  const sessao = `${modo}-${ia.id}`;
  let alvo;
  if (modo === 'instalar') alvo = comandoDeInstalacao(ia.tipo);
  else {
    atualizarPath();
    esquecerResolvidos();
    const args = plano.entrar.args.map((a) => a.replace('{modelo}', ia.modelo || TIPOS[ia.tipo]?.modelo || ''));
    alvo = resolverExecutavel(ia.comando || plano.entrar.comando, args);
  }
  agentes.avulso(sessao, alvo.comando, alvo.args, { env: envDaIA(ia) }).then(async (codigo) => {
    // Depois de instalar ou entrar na conta, a IA ganha outra chance.
    const depois = await store.obter('ias', ia.id);
    if (depois?.problema) {
      delete depois.problema;
      await store.salvar('ias', depois);
    }
    await detectarIAs();
    if (modo === 'instalar' && codigo === 0) {
      const atual = await store.obter('ias', ia.id);
      if (atual?.status === 'pronto' && !atual.ativa) {
        atual.ativa = true;
        await store.salvar('ias', atual);
        bus.emitir({ tipo: 'ia', ia: iaPublica(atual) });
      }
      await equipes.ajustar();
    }
    bus.emitir({ tipo: 'avulso.fim', sessao, ia: ia.id, modo, codigo });
  });
  return { sessao, comando: alvo.texto ?? [plano.entrar.comando, ...plano.entrar.args].join(' ') };
};
app.post('/api/ias/:id/instalar', rota((req) => terminalDeIA(req, 'instalar')));
// Treinamento de equipes
app.post('/api/equipes/:id/treinos', rota((req) => treino.novo(req.params.id, req.body ?? {})));
app.post('/api/equipes/:id/desfazer-treino', rota((req) => treino.desfazer(req.params.id)));
app.put('/api/treinos/:id/casos', rota((req) => treino.editarCasos(req.params.id, req.body?.casos)));
app.post('/api/treinos/:id/gerar-casos', rota(async (req) => {
  treino.gerarCasos(req.params.id).catch((e) => console.error('[treino]', e));
  return { ok: true };
}));
app.post('/api/treinos/:id/comecar', rota((req) => treino.comecar(req.params.id)));
app.post('/api/treinos/:id/continuar', rota((req) => treino.continuar(req.params.id)));
app.post('/api/treinos/:id/cancelar', rota((req) => treino.cancelar(req.params.id)));
app.post('/api/treinos/:id/aplicar', rota((req) => treino.aplicar(req.params.id)));
app.delete('/api/treinos/:id', rota(async (req) => {
  await treino.cancelar(req.params.id);
  await store.remover('treinos', req.params.id);
  bus.emitir({ tipo: 'treino.removido', id: req.params.id });
  return { ok: true };
}));

// Backup: exportar tudo num arquivo, ver o que tem num backup, importar (juntar ou substituir).
app.get('/api/backup', rota(() => ({ partes: backup.PARTES, pasta: backup.pastaBackups, automaticos: backup.listarAutomaticos() })));
app.post('/api/backup/exportar', rota((req) => backup.exportar({ partes: Array.isArray(req.body?.partes) ? req.body.partes : undefined, cerebro: req.body?.cerebro !== false, segredos: !!req.body?.segredos })));
app.post('/api/backup/previa', rota((req) => backup.resumo(backup.ler(req.body?.conteudo))));
app.post('/api/backup/importar', rota((req) => backup.importar(req.body?.conteudo, { modo: req.body?.modo === 'substituir' ? 'substituir' : 'juntar' })));
app.post('/api/backup/automaticos/:nome/restaurar', rota((req) => backup.restaurarAutomatico(req.params.nome, { modo: 'substituir' })));

// Relatório de diagnóstico em .txt, para o usuário repassar quando algo não funciona.
app.post('/api/diagnostico', rota(async (req) => diagnostico.gerar({ testar: req.body?.testar !== false })));

// O mesmo teste do botão Testar, mas num terminal visível: dá para ver tudo o que a IA responde.
app.post(
  '/api/ias/:id/testar-terminal',
  rota(async (req) => {
    const ia = await store.obter('ias', req.params.id);
    if (!ia) throw erro(404, 'IA não encontrada.');
    atualizarPath();
    esquecerResolvidos();
    const alvo = resolverExecutavel(comandoDe(ia), montarArgs(ia, 'Responda apenas com o JSON {"status":"ok"}'));
    const sessao = `teste-${ia.id}`;
    agentes.avulso(sessao, alvo.comando, alvo.args, { cwd: os.homedir(), env: { ...envDaIA(ia), ...(await headroom.envPara(ia)) } }).then((codigo) => bus.emitir({ tipo: 'avulso.fim', sessao, ia: ia.id, modo: 'teste', codigo }));
    return { sessao, comando: [alvo.comando, ...alvo.args].join(' ') };
  }),
);
app.post('/api/ias/:id/entrar', rota((req) => terminalDeIA(req, 'entrar')));

// O app de desktop pede para encerrar: fecha terminais, proxy e grava o estado antes de sair.
app.post(
  '/api/sistema/encerrar',
  rota(async () => {
    setTimeout(encerrar, 100);
    return { ok: true };
  }),
);
app.get(
  '/api/sistema/ocupado',
  rota(async () => ({
    agentes: (await agentes.listar()).filter((a) => a.rodando).length,
    tarefas: (await store.listar('tarefas')).filter((t) => ['planejando', 'executando'].includes(t.estado)).length,
  })),
);

// Máquinas remotas (SSH)
const salvarMaquina = async (m) => {
  await store.salvar('maquinas', m);
  bus.emitir({ tipo: 'maquina', maquina: m });
  return m;
};
const maquinaEm = async (id) => {
  const m = await store.obter('maquinas', id);
  if (!m) throw erro(404, 'Máquina não encontrada.');
  return m;
};
app.post(
  '/api/maquinas',
  rota(async (req) => {
    const destino = campo(req.body.destino, 200);
    if (!destino || /\s/.test(destino)) throw erro(400, 'Informe o destino como usuario@endereco ou o nome de um Host do seu ~/.ssh/config.');
    const nome = campo(req.body.nome, 60) || destino;
    let id = idDe(nome);
    if (await store.obter('maquinas', id)) id = `${id}-${Date.now().toString(36)}`;
    return salvarMaquina({ id, nome, destino, porta: Number(req.body.porta) || null, chave: campo(req.body.chave, 400) || null, criada: new Date().toISOString(), estado: 'nao-testada' });
  }),
);
app.patch(
  '/api/maquinas/:id',
  rota(async (req) => {
    const m = await maquinaEm(req.params.id);
    if (req.body.nome !== undefined) m.nome = campo(req.body.nome, 60) || m.nome;
    if (req.body.destino !== undefined) m.destino = campo(req.body.destino, 200) || m.destino;
    if (req.body.porta !== undefined) m.porta = Number(req.body.porta) || null;
    if (req.body.chave !== undefined) m.chave = campo(req.body.chave, 400) || null;
    return salvarMaquina(m);
  }),
);
app.delete(
  '/api/maquinas/:id',
  rota(async (req) => {
    const usado = (await store.listar('projetos')).find((p) => p.maquinaId === req.params.id);
    if (usado) throw erro(409, `O projeto ${usado.nome} usa esta máquina. Mude o projeto antes de remover.`);
    await store.remover('maquinas', req.params.id);
    bus.emitir({ tipo: 'maquina.removida', id: req.params.id });
    return { ok: true };
  }),
);
app.post(
  '/api/maquinas/:id/testar',
  rota(async (req) => {
    const m = await maquinaEm(req.params.id);
    m.estado = 'testando';
    await salvarMaquina(m);
    const r = await testarMaquina(m, cfg.raiz, (await store.listar('ias')).map((i) => path.basename(comandoDe(i))).filter(Boolean));
    Object.assign(m, r.ok ? { estado: 'ok', so: r.so, comandos: r.comandos, orq: r.orq, erro: null, testada: new Date().toISOString() } : { estado: 'erro', erro: r.erro, testada: new Date().toISOString() });
    return salvarMaquina(m);
  }),
);
// Terminal interativo na máquina (para aceitar a chave do servidor, digitar senha, instalar coisas lá).
app.post(
  '/api/maquinas/:id/terminal',
  rota(async (req) => {
    const m = await maquinaEm(req.params.id);
    const sessao = `ssh-${m.id}`;
    agentes.avulso(sessao, comandoSsh(), [...argsSsh(m, { interativo: true }), comandoRemoto({ pasta: campo(req.body?.pasta, 400) || '', shell: true })]).then((codigo) => bus.emitir({ tipo: 'avulso.fim', sessao, codigo }));
    return { sessao, comando: `ssh ${m.destino}` };
  }),
);
// Acesso sem senha: usa (ou cria) a chave deste computador e a autoriza lá. Pede a senha uma única vez, no terminal.
app.post(
  '/api/maquinas/:id/chave',
  rota(async (req) => {
    const m = await maquinaEm(req.params.id);
    const pub = await chavePublicaLocal();
    const sessao = `chave-${m.id}`;
    const remoto = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qF ${aspas(pub)} ~/.ssh/authorized_keys || echo ${aspas(pub)} >> ~/.ssh/authorized_keys) && chmod 600 ~/.ssh/authorized_keys && echo && echo "Pronto: este computador agora entra sem senha."`;
    agentes.avulso(sessao, comandoSsh(), [...argsSsh(m, { interativo: true }), remoto]).then((codigo) => bus.emitir({ tipo: 'avulso.fim', sessao, codigo }));
    return { sessao, comando: `ssh ${m.destino} (autorizar a chave deste computador)` };
  }),
);
// Instalar uma IA na máquina remota, com o mesmo instalador oficial do Linux/macOS.
app.post(
  '/api/maquinas/:id/instalar/:tipo',
  rota(async (req) => {
    const m = await maquinaEm(req.params.id);
    const { planoUnix } = await import('./instalacao-ias.js');
    const plano = planoUnix(req.params.tipo);
    if (!plano) throw erro(400, 'Sem instalação automática para essa IA.');
    const sessao = `instalar-${m.id}-${req.params.tipo}`;
    agentes.avulso(sessao, comandoSsh(), [...argsSsh(m, { interativo: true }), `exec "\${SHELL:-/bin/sh}" -lc ${aspas(plano.instalar)}`]).then(async (codigo) => {
      const r = await testarMaquina(m, cfg.raiz, (await store.listar('ias')).map((i) => path.basename(comandoDe(i))).filter(Boolean));
      if (r.ok) await salvarMaquina(Object.assign(await maquinaEm(m.id), { estado: 'ok', so: r.so, comandos: r.comandos, orq: r.orq, erro: null }));
      bus.emitir({ tipo: 'avulso.fim', sessao, codigo });
    });
    return { sessao, comando: plano.exibir ?? plano.instalar };
  }),
);

// Terminais
app.post(
  '/api/terminais/:equipe/mensagem',
  rota(async (req) => {
    const mensagem = campo(req.body.texto, 8000);
    if (!mensagem) throw erro(400, 'Escreva a mensagem.');
    await gestor.mensagemDireta(req.params.equipe, mensagem, campo(req.body.projetoId, 120) || null);
    return { ok: true };
  }),
);

registrarRotasAgentes({ app, rota, erro, campo, cfg, store, bus, agentes, cerebro, atividade });

app.use((err, _req, res, _next) => {
  const status = err.status ?? (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ erro: status >= 500 ? 'Erro interno. Veja o log do servidor.' : err.message });
});

// ---------------------------------------------------------------- servidor + eventos

const servidor = http.createServer(app);
const wssEventos = new WebSocketServer({ noServer: true });
const wssPty = new WebSocketServer({ noServer: true, perMessageDeflate: false });

servidor.on('upgrade', (req, socket, cabeca) => {
  const url = new URL(req.url, 'http://local');
  const alvo = url.pathname === '/eventos' ? wssEventos : url.pathname === '/pty' ? wssPty : null;
  if (!alvo) return socket.destroy();
  alvo.handleUpgrade(req, socket, cabeca, (ws) => alvo.emit('connection', ws, req, url));
});

wssEventos.on('connection', (socket, _req, url) => {
  if (!tokenValido(url.searchParams.get('token'))) return socket.close(4401, 'token');
  const enviar = (evento) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(evento));
  bus.aoEvento(enviar);
  socket.on('close', () => bus.removerOuvinte(enviar));
});

// Um WebSocket por terminal de agente: saída crua do PTY para o xterm e teclas de volta.
wssPty.on('connection', (socket, _req, url) => {
  if (!tokenValido(url.searchParams.get('token'))) return socket.close(4401, 'token');
  const id = url.searchParams.get('agente') ?? '';
  const sair = agentes.assinar(id, (dados) => socket.readyState === socket.OPEN && socket.send(dados));
  socket.on('message', (bruto) => {
    let m;
    try {
      m = JSON.parse(bruto.toString());
    } catch {
      return;
    }
    if (m.t === 'in' && typeof m.d === 'string') agentes.escrever(id, m.d);
    if (m.t === 'tam') agentes.redimensionar(id, Number(m.cols), Number(m.rows));
  });
  socket.on('close', sair);
});

servidor.listen(cfg.porta, cfg.host, () => {
  const modo = cfg.simular ? ' (modo simulado)' : '';
  console.log(`Singularize Orquestrador em http://${cfg.host}:${cfg.porta}${modo}`);
  console.log(`Vault: ${cfg.vault} · Store: ${store.tipo}`);
  if (cfg.host !== '127.0.0.1' && !cfg.token) console.warn('ATENÇÃO: aberto na rede sem ORQ_TOKEN. Defina um token.');
  if (!process.env.ORQ_DESKTOP) console.log('Deixe esta janela aberta enquanto usa o app. Para encerrar: Ctrl+C.');
  if (cfg.abrir) {
    const endereco = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.porta}${cfg.token ? `/?token=${encodeURIComponent(cfg.token)}` : ''}`;
    const [cmd, args] = process.platform === 'darwin' ? ['open', [endereco]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', endereco]] : ['xdg-open', [endereco]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
  headroom.iniciarSeLigado().catch((e) => console.error('[headroom]', e));
  gestor.recuperar();
});

atividade.conhecer(await store.listar('tarefas'));
await agentes.recuperar();

setInterval(() => gestor.tick(), 5000).unref();

const encerrar = async () => {
  agentes.encerrarTodos();
  await headroom.parar();
  await store.fechar?.();
  process.exit(0);
};
process.on('SIGINT', encerrar);
// Dentro do app de desktop: quando o app fecha (ou cai), a entrada padrão termina e o servidor sai junto.
if (process.env.ORQ_DESKTOP) {
  process.stdin.on('end', encerrar);
  process.stdin.on('close', encerrar);
  process.stdin.resume();
}
process.on('SIGTERM', encerrar);
