import { executar } from './adaptadores.js';

const LARGURA_AGENTE = 640;
const ALTURA_AGENTE = 420;
const TIPOS_NO = new Set(['agente', 'nota', 'rascunho']);
const CORES_NOTA = new Set(['roxo', 'ambar', 'verde', 'cinza']);

const numero = (v, padrao, min = -1e6, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao;
};

// Limpa o documento da tela livre vindo do navegador: só os campos conhecidos, com limites.
const sanitizarCanvas = (id, corpo, agentesExistentes) => {
  const nos = (Array.isArray(corpo.nos) ? corpo.nos : [])
    .filter((n) => n && TIPOS_NO.has(n.tipo) && typeof n.id === 'string')
    .filter((n) => n.tipo !== 'agente' || agentesExistentes.has(n.agenteId))
    .slice(0, 400)
    .map((n) => ({
      id: n.id.slice(0, 60),
      tipo: n.tipo,
      x: numero(n.x, 0),
      y: numero(n.y, 0),
      w: numero(n.w, 300, 160, 3000),
      h: numero(n.h, 200, 100, 3000),
      ...(n.tipo === 'agente' ? { agenteId: n.agenteId } : {}),
      ...(n.tipo === 'nota' ? { texto: String(n.texto ?? '').slice(0, 20000), cor: CORES_NOTA.has(n.cor) ? n.cor : 'roxo' } : {}),
      ...(n.tipo === 'rascunho'
        ? {
            titulo: String(n.titulo ?? '').slice(0, 80),
            tracos: (Array.isArray(n.tracos) ? n.tracos : []).slice(0, 600).map((t) => (Array.isArray(t) ? t.slice(0, 2000).map((v) => numero(v, 0, -5000, 5000)) : [])),
          }
        : {}),
    }));
  const idsAgentes = new Set(nos.filter((n) => n.tipo === 'agente').map((n) => n.agenteId));
  const vistos = new Set();
  const conexoes = (Array.isArray(corpo.conexoes) ? corpo.conexoes : [])
    .filter((c) => c && idsAgentes.has(c.de) && idsAgentes.has(c.para) && c.de !== c.para)
    .filter((c) => {
      const chave = [c.de, c.para].sort().join('|');
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((c) => ({ id: String(c.id ?? `${c.de}-${c.para}`).slice(0, 120), de: c.de, para: c.para }));
  const vista = { x: numero(corpo.vista?.x, 0), y: numero(corpo.vista?.y, 0), z: Math.min(2.5, Math.max(0.2, Number(corpo.vista?.z) || 1)) };
  return { id, nos, conexoes, livre: !!corpo.livre, vista };
};

export const registrarRotasAgentes = ({ app, rota, erro, campo, cfg, store, bus, agentes, cerebro, atividade }) => {
  const obterCanvas = async (ws) => (await store.obter('canvas', ws)) ?? { id: ws, nos: [], conexoes: [], livre: false, vista: { x: 0, y: 0, z: 1 } };

  const salvarCanvas = async (doc, autor = 'servidor') => {
    await store.salvar('canvas', doc);
    bus.emitir({ tipo: 'canvas', canvas: doc, autor });
    return doc;
  };

  // ------------------------------------------------------------ tela livre

  app.get('/api/canvas/:ws', rota((req) => obterCanvas(campo(req.params.ws, 120))));

  app.put(
    '/api/canvas/:ws',
    rota(async (req) => {
      const ws = campo(req.params.ws, 120);
      const existentes = new Set((await store.listar('agentes')).map((a) => a.id));
      const doc = sanitizarCanvas(ws, req.body ?? {}, existentes);
      const antes = await obterCanvas(ws);
      // Agente só sai da tela pelo DELETE do agente. Um save atrasado do navegador não pode apagar
      // um agente que acabou de ser criado no servidor.
      for (const n of antes.nos) if (n.tipo === 'agente' && existentes.has(n.agenteId) && !doc.nos.some((x) => x.agenteId === n.agenteId)) doc.nos.push(n);
      return salvarCanvas(doc, campo(req.body?.autor, 60));
    }),
  );

  // ------------------------------------------------------------ agentes

  app.get('/api/agentes', rota(() => agentes.listar()));

  app.post(
    '/api/agentes',
    rota(async (req) => {
      const b = req.body ?? {};
      const quantidade = numero(b.quantidade, 1, 1, 12);
      const workspace = campo(b.workspace, 120) || 'geral';
      const doc = await obterCanvas(workspace);
      const x0 = numero(b.x, 0);
      const y0 = numero(b.y, 0);
      const colunas = Math.min(quantidade, 3);
      const criados = [];
      for (let i = 0; i < quantidade; i++) {
        const nome = quantidade > 1 ? `${campo(b.nome, 50)} ${i + 1}` : campo(b.nome, 60);
        const a = await agentes.criar({
          nome,
          iaId: campo(b.iaId, 60),
          papel: campo(b.papel, 300),
          area: campo(b.area, 60),
          pasta: campo(b.pasta, 400),
          projetoId: campo(b.projetoId, 120) || null,
          maquinaId: campo(b.maquinaId, 80) || null,
          workspace,
          briefing: b.briefing !== false,
        });
        doc.nos.push({
          id: `no-${a.id}`,
          tipo: 'agente',
          agenteId: a.id,
          x: x0 + (i % colunas) * (LARGURA_AGENTE + 40),
          y: y0 + Math.floor(i / colunas) * (ALTURA_AGENTE + 40),
          w: LARGURA_AGENTE,
          h: ALTURA_AGENTE,
        });
        criados.push(a);
      }
      await salvarCanvas(doc);
      if (b.iniciar !== false) for (const a of criados) await agentes.iniciar(a.id).catch((e) => bus.emitir({ tipo: 'aviso', texto: e.message }));
      return criados;
    }),
  );

  app.patch('/api/agentes/:id', rota((req) => agentes.atualizar(req.params.id, req.body ?? {})));

  app.delete(
    '/api/agentes/:id',
    rota(async (req) => {
      const a = (await agentes.listar()).find((x) => x.id === req.params.id);
      if (!a) throw erro(404, 'Agente não encontrado.');
      await agentes.remover(a.id);
      const doc = await obterCanvas(a.workspace);
      doc.nos = doc.nos.filter((n) => n.agenteId !== a.id);
      doc.conexoes = doc.conexoes.filter((c) => c.de !== a.id && c.para !== a.id);
      await salvarCanvas(doc);
      return { ok: true };
    }),
  );

  const tamanho = (b) => ({ cols: numero(b?.cols, 100, 20, 500), rows: numero(b?.rows, 28, 5, 200) });
  app.post('/api/agentes/:id/iniciar', rota((req) => agentes.iniciar(req.params.id, tamanho(req.body))));
  app.post('/api/agentes/:id/reiniciar', rota((req) => agentes.reiniciar(req.params.id, tamanho(req.body))));
  app.post(
    '/api/agentes/:id/parar',
    rota(async (req) => {
      await agentes.parar(req.params.id);
      return { ok: true };
    }),
  );
  app.get('/api/agentes/:id/conexoes', rota((req) => agentes.conexoesDe(req.params.id)));

  // ------------------------------------------------------------ mensagens

  app.get('/api/mensagens', rota((req) => agentes.listarMensagens(campo(req.query.workspace, 120) || null)));

  app.post(
    '/api/mensagens',
    rota((req) => {
      const b = req.body ?? {};
      const refs = Array.isArray(b.refs) ? b.refs.map((r) => campo(r, 400)) : String(b.refs ?? '').split(/[\n,]/).map((r) => r.trim()).filter(Boolean);
      const de = req.get('x-orq-agente') && req.get('x-orq-agente') !== 'operador' ? req.get('x-orq-agente') : campo(b.de, 60) || 'operador';
      return agentes.enviar({ de, para: campo(b.para, 60), objetivo: campo(b.objetivo, 4000), refs, re: campo(b.re, 30) || null });
    }),
  );

  // ------------------------------------------------------------ cérebro (vault)

  app.get('/api/cerebro', rota((req) => ({ itens: cerebro.buscar(campo(req.query.q, 200), Number(req.query.limite) || 15) })));
  app.get('/api/cerebro/areas', rota(() => ({ areas: cerebro.areas() })));
  app.get('/api/cerebro/grafo', rota(async () => cerebro.grafo({ equipes: await store.listar('equipes'), tarefas: await store.listar('tarefas') })));
  app.get(
    '/api/cerebro/nota',
    rota((req) => {
      const nota = cerebro.ler(campo(req.query.caminho, 400));
      if (!nota) throw erro(404, 'Nota não encontrada no cérebro. Procure com: orq cerebro <termo>');
      return nota;
    }),
  );
  app.post(
    '/api/cerebro/aprender',
    rota((req) => {
      const b = req.body ?? {};
      const titulo = campo(b.titulo, 120);
      const texto = campo(b.texto, 20000);
      if (!titulo || !texto) throw erro(400, 'Informe título e texto.');
      const agente = req.get('x-orq-agente') || 'operador';
      const r = cerebro.aprender({ area: campo(b.area, 60), titulo, texto, agente });
      atividade.registrar({ tipo: 'cerebro.aprendeu', agente, texto: `${agente} registrou no cérebro: ${r.caminho}` });
      return r;
    }),
  );
  app.post(
    '/api/cerebro/validar',
    rota((req) => {
      if (!cerebro.validar(campo(req.body?.caminho, 400))) throw erro(404, 'Nota não encontrada.');
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ resumo de volta

  app.get('/api/resumo', rota((req) => ({ itens: atividade.desde(campo(req.query.desde, 40)) })));

  app.post(
    '/api/resumo/ia',
    rota(async (req) => {
      const itens = atividade.desde(campo(req.body?.desde, 40)).filter((i) => i.tipo !== 'agente.iniciado').slice(-80);
      if (!itens.length) return { texto: 'Nada aconteceu desde a sua última visita.', ia: null };
      const ias = (await store.listar('ias')).filter((i) => i.ativa && i.status === 'pronto' && !['shell', 'simulado'].includes(i.tipo));
      const ia = cfg.simular ? null : (ias.find((i) => i.tipo === 'ollama') ?? ias[0]);
      if (!ia) {
        const contar = (prefixo) => itens.filter((i) => i.tipo.startsWith(prefixo)).length;
        return {
          ia: null,
          texto: `${contar('tarefa.')} mudanças em tarefas, ${contar('mensagem')} mensagens entre agentes e ${contar('agente.')} eventos de agentes. Sem IA local disponível para escrever o resumo; veja a lista abaixo.`,
        };
      }
      const linhas = itens.map((i) => `- ${new Date(i.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ${i.texto}${i.trecho ? ` | última saída: ${i.trecho.replace(/\n/g, ' / ').slice(0, 200)}` : ''}`);
      const prompt = `Você resume para o operador o que aconteceu enquanto ele estava fora, num sistema de agentes de IA.\nEscreva em português, no máximo 6 linhas: o que terminou, o que travou ou espera ele, e até 3 próximos passos concretos. Sem introdução.\n\nEventos:\n${linhas.join('\n')}`;
      const r = await executar(ia, prompt, { cwd: cfg.raiz, timeoutMs: 120_000 });
      return { ia: ia.nome, texto: r.codigo === 0 ? r.saida.trim().slice(0, 3000) : `Não consegui resumir com ${ia.nome}.` };
    }),
  );
};
