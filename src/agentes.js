import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty from '@lydell/node-pty';
import { comandoDe, argsInterativos, resolverExecutavel, envDaIA } from './adaptadores.js';
import { argsSsh, comandoRemoto, comandoSsh } from './maquinas.js';

// Agentes interativos: cada um é uma sessão de terminal real (PTY) e persistente,
// com a IA que o operador escolher. Conversam entre si pelo comando `orq`, de forma objetiva,
// apontando para o cérebro (vault) em vez de colar contexto.

const BUFFER_MAX = 256 * 1024;
const OBJETIVO_MAX = 600;
const REFS_MAX = 5;
const MSG_POR_MINUTO = 6;
const PROFUNDIDADE_MAX = 12;
const OCIOSO_PARA_ENTREGAR = 1500;
const SILENCIO_FIM_RAJADA = 20_000;
const RAJADA_RELEVANTE = 8_000;

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|[\x00-\x08\x0b-\x1f]/g;
const agora = () => new Date().toISOString();
const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status });

const normalizar = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const slug = (t) => normalizar(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agente';

// Dentro do app de desktop, o "node" é o próprio executável do app em modo Node.
// Só o processo que é esse executável recebe ELECTRON_RUN_AS_NODE; os demais não podem herdar,
// senão outro app Electron aberto pelo agente (ex.: o VS Code) se comportaria como Node.
const ajustarEnvNode = (env, comando) => {
  if (comando === process.execPath && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
};

const ultimasLinhas = (buffer, n = 4) =>
  buffer
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !/^[─━═│┃╭╮╰╯\-_=\s]+$/.test(l))
    .slice(-n)
    .join('\n');

export const criarAgentes = ({ cfg, store, bus, cerebro, headroom, atividade }) => {
  const sessoes = new Map();
  const canais = new Map(); // agenteId -> Set(fn) — independente do processo, para o front reconectar sem perder nada
  const buffersFinais = new Map();
  const envios = new Map(); // agenteId -> timestamps de mensagens enviadas
  const dirBin = path.join(cfg.raiz, 'bin');

  const canal = (id) => {
    if (!canais.has(id)) canais.set(id, new Set());
    return canais.get(id);
  };
  const transmitir = (id, dados) => canal(id).forEach((fn) => fn(dados));

  const publico = (a) => ({ ...a, rodando: sessoes.has(a.id) });

  const salvar = async (a) => {
    a.atualizado = agora();
    await store.salvar('agentes', a);
    bus.emitir({ tipo: 'agente', agente: publico(a) });
    return a;
  };

  const listar = async () => (await store.listar('agentes')).map(publico);

  const exigir = async (id) => {
    const a = await store.obter('agentes', id);
    if (!a) throw erro(404, `Agente "${id}" não existe.`);
    return a;
  };

  // Aceita id, nome ou slug do nome, para o `orq enviar seguranca ...` ficar natural.
  const encontrar = async (chave) => {
    const todos = await store.listar('agentes');
    const k = normalizar(chave).trim();
    return todos.find((a) => a.id === chave) ?? todos.find((a) => normalizar(a.nome) === k) ?? todos.find((a) => slug(a.nome) === slug(k)) ?? null;
  };

  // ------------------------------------------------------------ criação

  const idLivre = async (nome) => {
    const base = slug(nome);
    let id = base;
    for (let n = 2; await store.obter('agentes', id); n++) id = `${base}-${n}`;
    return id;
  };

  const criar = async ({ nome, iaId, papel, area, pasta, projetoId, workspace, maquinaId, briefing = true }) => {
    if (!nome?.trim()) throw erro(400, 'Dê um nome ao agente.');
    const ia = await store.obter('ias', iaId);
    if (!ia) throw erro(400, 'Escolha uma IA para o agente.');
    const id = await idLivre(nome);
    const agente = {
      id,
      nome: nome.trim().slice(0, 60),
      iaId,
      papel: String(papel ?? '').trim().slice(0, 300),
      area: area ? slug(area) : '',
      pasta: String(pasta ?? '').trim(),
      projetoId: projetoId || null,
      maquinaId: maquinaId || null,
      workspace: workspace || 'geral',
      briefing: !!briefing,
      estado: 'parado',
      criado: agora(),
    };
    await salvar(agente);
    atividade.registrar({ tipo: 'agente.criado', agente: id, texto: `Agente ${agente.nome} criado com ${ia.nome}.` });
    return agente;
  };

  const atualizar = async (id, mudancas) => {
    const a = await exigir(id);
    for (const k of ['nome', 'papel', 'pasta']) if (mudancas[k] !== undefined) a[k] = String(mudancas[k]).trim().slice(0, k === 'papel' ? 300 : 400);
    if (mudancas.area !== undefined) a.area = mudancas.area ? slug(mudancas.area) : '';
    if (mudancas.iaId !== undefined && (await store.obter('ias', mudancas.iaId))) a.iaId = mudancas.iaId;
    if (mudancas.briefing !== undefined) a.briefing = !!mudancas.briefing;
    if (mudancas.maquinaId !== undefined) a.maquinaId = mudancas.maquinaId || null;
    return publico(await salvar(a));
  };

  const remover = async (id) => {
    await parar(id).catch(() => {});
    await store.remover('agentes', id);
    buffersFinais.delete(id);
    bus.emitir({ tipo: 'agente.removido', id });
  };

  // ------------------------------------------------------------ processo

  const pastaDe = async (a) => {
    const expandir = (p) => (p?.startsWith('~') ? os.homedir() + p.slice(1) : p);
    const candidata = expandir(a.pasta);
    if (candidata && fs.existsSync(candidata)) return candidata;
    const projeto = a.projetoId ? await store.obter('projetos', a.projetoId) : null;
    if (projeto?.pasta && fs.existsSync(projeto.pasta)) return projeto.pasta;
    return os.homedir();
  };

  const briefingDe = (a) => {
    if (a.remoto) {
      return (
        `[orq] Você é o agente "${a.nome}" (id ${a.id})${a.papel ? `, papel: ${a.papel}` : ''}. Você roda numa máquina remota; o cérebro do time fica no computador do operador.` +
        ` Procure o que já existe com: orq cerebro <termo>, e leia uma nota com: orq ler <caminho>.${a.area ? ` Sua área: 20-areas/${a.area}.` : ''}` +
        ` Para pedir algo a outro agente: orq enviar <agente> "objetivo curto" --ref <caminho no cérebro>. Quem está ligado a você: orq quem.` +
        ` Ao descobrir um jeito que funcionou: orq aprender <area> "titulo" "texto". Mensagens chegam como [orq mN]. Seja objetivo. Confirme só com "ok".`
      );
    }
    const area = a.area ? ` Sua área no cérebro: ${path.join(cerebro.raiz, '20-areas', a.area)}.` : '';
    return (
      `[orq] Você é o agente "${a.nome}" (id ${a.id})${a.papel ? `, papel: ${a.papel}` : ''}.${area}` +
      ` O cérebro do time é o vault Obsidian em ${cerebro.raiz}. Antes de criar algo do zero, procure o que já existe: orq cerebro <termo>.` +
      ` Para pedir algo a outro agente: orq enviar <agente> "objetivo curto" --ref <caminho no cérebro>. Quem está ligado a você: orq quem.` +
      ` Ao descobrir um jeito que funcionou, registre: orq aprender <area> "titulo" "texto".` +
      ` Mensagens de outros chegam como [orq mN]. Seja objetivo: detalhe vai numa nota do cérebro, não na mensagem. Confirme só com "ok".`
    );
  };

  const iniciar = async (id, { cols = 100, rows = 28 } = {}) => {
    if (sessoes.has(id)) return publico(await exigir(id));
    const a = await exigir(id);
    const ia = await store.obter('ias', a.iaId);
    if (!ia) throw erro(400, 'A IA deste agente foi removida. Escolha outra.');
    const projetoDoAgente = a.projetoId ? await store.obter('projetos', a.projetoId) : null;
    const maquinaId = a.maquinaId ?? projetoDoAgente?.maquinaId ?? null;
    const maquina = maquinaId && ia.tipo !== 'simulado' ? await store.obter('maquinas', maquinaId) : null;
    const cwd = maquina ? os.homedir() : await pastaDe(a);
    let comando;
    let args;
    if (ia.tipo === 'simulado') [comando, args] = [process.execPath, [path.join(dirBin, 'simulado-repl.mjs'), a.nome]];
    else if (maquina) {
      // Terminal remoto: ssh -t com um túnel de volta (-R) para o `orq` de lá falar com este app.
      const portaRemota = 20000 + Math.floor(Math.random() * 40000);
      const pastaRemota = a.pasta || projetoDoAgente?.pasta || '';
      comando = comandoSsh();
      args = [
        ...argsSsh(maquina, { interativo: true, encaminhar: { remota: portaRemota, local: cfg.porta } }),
        comandoRemoto({
          pasta: pastaRemota,
          comando: comandoDe(ia),
          args: argsInterativos(ia),
          shell: ia.tipo === 'shell',
          env: { ...envDaIA(ia), ORQ_AGENTE: a.id, ORQ_URL: `http://127.0.0.1:${portaRemota}`, ORQ_TOKEN: cfg.token },
        }),
      ];
    } else [comando, args] = Object.values(resolverExecutavel(comandoDe(ia), argsInterativos(ia)));

    const env = {
      ...process.env,
      ...(await headroom.envPara(ia)),
      ...envDaIA(ia),
      ORQ_AGENTE: a.id,
      ORQ_URL: `http://127.0.0.1:${cfg.porta}`,
      ORQ_TOKEN: cfg.token,
      ORQ_VAULT: cerebro.raiz,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };
    ajustarEnvNode(env, comando);
    env.ORQ_NODE = process.execPath;
    // No Windows a chave é "Path"; usamos a que existir para não criar uma duplicada.
    const chavePath = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[chavePath] = `${dirBin}${path.delimiter}${env[chavePath] ?? ''}`;
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;

    let processo;
    try {
      processo = pty.spawn(comando, args, { name: 'xterm-256color', cols, rows, cwd, env });
    } catch (e) {
      throw erro(400, `Não consegui abrir "${comando}": ${e.message}`);
    }

    const s = { processo, buffer: '', ultimaSaida: Date.now(), inicio: Date.now(), rajada: null, fila: [], briefingPendente: a.briefing, entregando: false };
    sessoes.set(id, s);
    buffersFinais.delete(id);

    processo.onData((d) => {
      s.buffer = (s.buffer + d).slice(-BUFFER_MAX);
      s.ultimaSaida = Date.now();
      s.rajada ??= Date.now();
      transmitir(id, d);
    });
    processo.onExit(async ({ exitCode }) => {
      sessoes.delete(id);
      buffersFinais.set(id, s.buffer);
      transmitir(id, `\r\n\x1b[2m[processo encerrado, código ${exitCode}]\x1b[0m\r\n`);
      const atual = await store.obter('agentes', id);
      if (!atual) return;
      atual.estado = s.parando ? 'parado' : 'saiu';
      atual.codigoSaida = exitCode;
      await salvar(atual);
      if (!s.parando) atividade.registrar({ tipo: 'agente.saiu', agente: id, texto: `${atual.nome} encerrou sozinho (código ${exitCode}).`, trecho: ultimasLinhas(s.buffer) });
    });

    a.estado = 'rodando';
    a.iniciado = agora();
    a.cwd = maquina ? `${maquina.nome}:${a.pasta || projetoDoAgente?.pasta || '~'}` : cwd;
    a.remoto = !!maquina;
    await salvar(a);
    atividade.registrar({ tipo: 'agente.iniciado', agente: id, texto: `${a.nome} começou em ${a.cwd}.` });

    // Mensagens que chegaram enquanto o agente estava parado.
    for (const m of await store.listar('mensagens')) if (m.para === id && m.estado === 'aguardando-agente') s.fila.push(m);
    return publico(a);
  };

  const parar = async (id) => {
    const s = sessoes.get(id);
    if (!s) return;
    s.parando = true;
    s.processo.kill();
  };

  const reiniciar = async (id, tamanho) => {
    await parar(id);
    for (let i = 0; i < 30 && sessoes.has(id); i++) await new Promise((r) => setTimeout(r, 100));
    return iniciar(id, tamanho);
  };

  const escrever = (id, dados) => sessoes.get(id)?.processo.write(dados);

  const redimensionar = (id, cols, rows) => {
    const s = sessoes.get(id);
    if (!s || !(cols > 10 && rows > 3)) return;
    try {
      s.processo.resize(Math.min(cols, 500), Math.min(rows, 200));
    } catch {}
  };

  const assinar = (id, fn) => {
    const s = sessoes.get(id);
    const historico = s?.buffer ?? buffersFinais.get(id) ?? '';
    if (historico) fn(historico);
    canal(id).add(fn);
    return () => canal(id).delete(fn);
  };

  // Digita no terminal como uma pessoa: texto, uma pausa, Enter. Em TUIs (Claude Code etc.)
  // mandar texto e \r juntos pode virar colagem com quebra de linha em vez de envio.
  const digitar = async (s, texto) => {
    s.entregando = true;
    s.processo.write(texto.replace(/\s*\n\s*/g, ' '));
    await new Promise((r) => setTimeout(r, 180));
    s.processo.write('\r');
    s.ultimaSaida = Date.now();
    s.entregando = false;
  };

  // ------------------------------------------------------------ mensagens

  const conexoesDe = async (id) => {
    const a = await exigir(id);
    const doc = (await store.obter('canvas', a.workspace)) ?? { conexoes: [], livre: false };
    const ligados = new Set();
    for (const c of doc.conexoes ?? []) {
      if (c.de === id) ligados.add(c.para);
      if (c.para === id) ligados.add(c.de);
    }
    const todos = await store.listar('agentes');
    const visiveis = doc.livre ? todos.filter((x) => x.workspace === a.workspace && x.id !== id) : todos.filter((x) => ligados.has(x.id));
    return { livre: !!doc.livre, agentes: visiveis.map((x) => ({ id: x.id, nome: x.nome, papel: x.papel, area: x.area, rodando: sessoes.has(x.id) })) };
  };

  const formatar = (m, destino) => {
    const refs = m.refs.length
      ? destino.remoto
        ? ` | Cérebro (leia com orq ler): ${m.refs.join(' , ')}`
        : ` | Cérebro: ${m.refs.map((r) => path.join(cerebro.raiz, r)).join(' , ')}`
      : '';
    const resposta = m.de === 'operador' ? '' : ` | Para responder: orq enviar ${m.de} "..." --re ${m.id}`;
    return `[orq ${m.id}] ${m.deNome} para ${destino.nome}: ${m.objetivo}${refs}${resposta}`;
  };

  const enviar = async ({ de, para, objetivo, refs = [], re = null }) => {
    const texto = String(objetivo ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) throw erro(400, 'Mensagem vazia. Diga o objetivo em uma ou duas frases.');
    if (texto.length > OBJETIVO_MAX)
      throw erro(400, `Seja objetivo: até ${OBJETIVO_MAX} caracteres (você mandou ${texto.length}). Coloque detalhes numa nota do cérebro (orq aprender) e passe o caminho em --ref.`);

    const origem = de === 'operador' ? { id: 'operador', nome: 'Operador' } : await encontrar(de);
    if (!origem) throw erro(400, `Remetente "${de}" desconhecido. Rode orq de dentro de um agente.`);
    const destino = await encontrar(para);
    if (!destino) throw erro(404, `Agente "${para}" não existe. Veja quem está ligado a você: orq quem.`);
    if (destino.id === origem.id) throw erro(400, 'Você não precisa mandar mensagem para si mesmo.');

    const listaRefs = (Array.isArray(refs) ? refs : [refs]).filter(Boolean).slice(0, REFS_MAX + 1);
    if (listaRefs.length > REFS_MAX) throw erro(400, `No máximo ${REFS_MAX} referências por mensagem.`);
    const refsOk = [];
    for (const r of listaRefs) {
      const rel = String(r).startsWith(cerebro.raiz) ? path.relative(cerebro.raiz, String(r)) : String(r);
      if (!cerebro.existe(rel)) throw erro(400, `"${r}" não existe no cérebro. Procure o caminho certo com: orq cerebro <termo>`);
      refsOk.push(cerebro.relativo(cerebro.resolver(rel)));
    }

    if (origem.id !== 'operador') {
      const { livre, agentes } = await conexoesDe(origem.id);
      if (!agentes.some((x) => x.id === destino.id))
        throw erro(403, `Você não está ligado a ${destino.nome}${livre ? '' : '. O operador liga agentes na tela livre'}. Ligados a você: ${agentes.map((x) => x.id).join(', ') || 'ninguém'}.`);
      const janela = (envios.get(origem.id) ?? []).filter((t) => Date.now() - t < 60_000);
      if (janela.length >= MSG_POR_MINUTO) throw erro(429, `Calma: no máximo ${MSG_POR_MINUTO} mensagens por minuto. Junte os pedidos numa mensagem só.`);
      envios.set(origem.id, [...janela, Date.now()]);
    }

    let profundidade = 0;
    if (re) {
      const anterior = await store.obter('mensagens', re);
      profundidade = (anterior?.profundidade ?? 0) + 1;
      if (profundidade > PROFUNDIDADE_MAX) throw erro(409, 'Essa conversa já foi longe demais entre agentes. Registre o estado no cérebro e espere o operador.');
    }

    const seq = await store.proximaSequencia('mensagem');
    const mensagem = {
      id: `m${seq}`,
      de: origem.id,
      deNome: origem.nome,
      para: destino.id,
      paraNome: destino.nome,
      workspace: destino.workspace,
      objetivo: texto,
      refs: refsOk,
      re,
      profundidade,
      criada: agora(),
      estado: sessoes.has(destino.id) ? 'na-fila' : 'aguardando-agente',
    };
    await store.salvar('mensagens', mensagem);
    bus.emitir({ tipo: 'mensagem', mensagem });
    atividade.registrar({ tipo: 'mensagem', agente: destino.id, texto: `${origem.nome} → ${destino.nome}: ${texto}${refsOk.length ? ` (cérebro: ${refsOk.join(', ')})` : ''}` });
    sessoes.get(destino.id)?.fila.push(mensagem);
    return mensagem;
  };

  const listarMensagens = async (workspace, limite = 60) =>
    (await store.listar('mensagens'))
      .filter((m) => !workspace || m.workspace === workspace)
      .sort((a, b) => a.criada.localeCompare(b.criada))
      .slice(-limite);

  // ------------------------------------------------------------ vigia: entrega, briefing, resumo

  const vigiar = async () => {
    for (const [id, s] of sessoes) {
      const ocioso = Date.now() - s.ultimaSaida;
      if (s.entregando || s.avulso) continue;

      if (s.briefingPendente && ocioso >= 2500 && Date.now() - s.inicio >= 2500) {
        s.briefingPendente = false;
        const a = await store.obter('agentes', id);
        if (a) await digitar(s, briefingDe(a));
        continue;
      }

      if (s.fila.length && ocioso >= OCIOSO_PARA_ENTREGAR) {
        const m = s.fila.shift();
        const destino = await store.obter('agentes', id);
        if (!destino) continue;
        await digitar(s, formatar(m, destino));
        m.estado = 'entregue';
        m.entregue = agora();
        await store.salvar('mensagens', m);
        bus.emitir({ tipo: 'mensagem', mensagem: m });
        continue;
      }

      if (s.rajada && ocioso >= SILENCIO_FIM_RAJADA) {
        const duracao = s.ultimaSaida - s.rajada;
        s.rajada = null;
        if (duracao >= RAJADA_RELEVANTE) {
          const a = await store.obter('agentes', id);
          atividade.registrar({
            tipo: 'agente.quieto',
            agente: id,
            texto: `${a?.nome ?? id} trabalhou ${Math.round(duracao / 1000)} s e parou. Pode ter terminado ou estar esperando você.`,
            trecho: ultimasLinhas(s.buffer),
          });
        }
      }
    }
  };
  setInterval(() => vigiar().catch((e) => console.error('[agentes]', e)), 500).unref();

  // Terminal avulso, sem agente: instalação e login de IAs. Visível no app pelo mesmo canal /pty.
  const avulso = (id, comando, args, { cwd, env: envExtra = {} } = {}) => {
    sessoes.get(id)?.processo.kill();
    const env = { ...process.env, ...envExtra, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
    ajustarEnvNode(env, comando);
    let processo;
    try {
      processo = pty.spawn(comando, args, { name: 'xterm-256color', cols: 100, rows: 26, cwd: cwd ?? os.homedir(), env });
    } catch (e) {
      throw erro(400, `Não consegui abrir "${comando}": ${e.message}`);
    }
    const s = { processo, buffer: '', ultimaSaida: Date.now(), inicio: Date.now(), rajada: null, fila: [], briefingPendente: false, entregando: false, avulso: true };
    sessoes.set(id, s);
    buffersFinais.delete(id);
    processo.onData((d) => {
      s.buffer = (s.buffer + d).slice(-BUFFER_MAX);
      transmitir(id, d);
    });
    return new Promise((ok) =>
      processo.onExit(({ exitCode }) => {
        sessoes.delete(id);
        buffersFinais.set(id, s.buffer);
        transmitir(id, `\r\n\x1b[2m[terminou, código ${exitCode}]\x1b[0m\r\n`);
        ok(exitCode);
      }),
    );
  };

  // Ao subir o servidor nenhum PTY sobrevive: marca como parado.
  const recuperar = async () => {
    for (const a of await store.listar('agentes')) {
      if (a.estado === 'rodando') {
        a.estado = 'parado';
        await store.salvar('agentes', a);
      }
    }
  };

  const encerrarTodos = () => {
    for (const [, s] of sessoes) {
      s.parando = true;
      s.processo.kill();
    }
  };

  return {
    listar,
    criar,
    atualizar,
    remover,
    iniciar,
    parar,
    reiniciar,
    avulso,
    escrever,
    redimensionar,
    assinar,
    enviar,
    listarMensagens,
    conexoesDe,
    encontrar,
    recuperar,
    encerrarTodos,
    rodando: (id) => sessoes.has(id),
  };
};
