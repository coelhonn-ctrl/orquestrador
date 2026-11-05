import fs from 'node:fs';
import path from 'node:path';

// Backup do app: um arquivo .json com tudo o que é seu (equipes, treinos, agentes, tela livre,
// projetos, tarefas, IAs, máquinas, ajustes) e, se quiser, o cérebro inteiro.
// Serve para guardar, levar para outro computador ou voltar atrás depois de uma atualização.

const FORMATO = 'singularize-backup';
const PARTES = {
  equipes: { nome: 'Equipes e treinos', colecoes: ['equipes', 'treinos'] },
  agentes: { nome: 'Agentes e tela livre', colecoes: ['agentes', 'canvas', 'mensagens'] },
  projetos: { nome: 'Projetos e tarefas', colecoes: ['projetos', 'tarefas'] },
  ias: { nome: 'IAs e máquinas', colecoes: ['ias', 'maquinas'] },
  ajustes: { nome: 'Ajustes (pastas, Headroom, objetivos)', colecoes: ['ajustes'] },
};
const MAX_ARQUIVO_CEREBRO = 15 * 1024 * 1024;
const AUTOMATICOS = 8;

const carimbo = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

export const criarBackup = ({ cfg, store, bus, vault, versao }) => {
  const pastaBackups = path.join(path.dirname(cfg.vault), 'backups');
  const pastaAuto = path.join(cfg.dados, 'backups');

  const arquivosDoCerebro = () => {
    const saida = {};
    const andar = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name === '.trash') continue;
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) andar(abs);
        else if (fs.statSync(abs).size <= MAX_ARQUIVO_CEREBRO) saida[path.relative(cfg.vault, abs).split(path.sep).join('/')] = fs.readFileSync(abs).toString('base64');
      }
    };
    andar(cfg.vault);
    return saida;
  };

  // Monta o conteúdo do backup. Valores de variáveis das IAs (chaves, tokens) só entram se pedir.
  const montar = async ({ partes = Object.keys(PARTES), cerebro = true, segredos = false } = {}) => {
    const dados = {};
    for (const p of partes.filter((x) => PARTES[x])) {
      for (const c of PARTES[p].colecoes) {
        let itens = await store.listar(c);
        if (c === 'ias' && !segredos) itens = itens.map((i) => ({ ...i, env: Object.fromEntries(Object.keys(i.env ?? {}).map((k) => [k, ''])) }));
        dados[c] = itens;
      }
    }
    return {
      formato: FORMATO,
      versaoFormato: 1,
      versaoApp: versao,
      criado: new Date().toISOString(),
      partes,
      comSegredos: !!segredos,
      dados,
      cerebro: cerebro ? arquivosDoCerebro() : null,
    };
  };

  const resumo = (b) => ({
    versaoApp: b.versaoApp,
    criado: b.criado,
    partes: b.partes,
    contagem: Object.fromEntries(Object.entries(b.dados ?? {}).map(([c, itens]) => [c, itens.length])),
    notasCerebro: b.cerebro ? Object.keys(b.cerebro).length : 0,
  });

  const exportar = async (opcoes = {}) => {
    const b = await montar(opcoes);
    fs.mkdirSync(pastaBackups, { recursive: true });
    const arquivo = path.join(pastaBackups, `singularize-backup-${carimbo()}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(b));
    return { arquivo, tamanho: fs.statSync(arquivo).size, ...resumo(b) };
  };

  const validar = (b) => {
    if (!b || b.formato !== FORMATO || typeof b.dados !== 'object') throw Object.assign(new Error('Este arquivo não é um backup do Singularize Orquestrador.'), { status: 400 });
    return b;
  };

  const ler = (conteudo) => validar(typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo);

  // modo "juntar": acrescenta e atualiza pelo id, sem apagar o que já existe.
  // modo "substituir": as coleções que vieram no backup ficam exatamente como no arquivo.
  const importar = async (conteudo, { modo = 'juntar' } = {}) => {
    const b = ler(conteudo);
    // Antes de mexer, guarda o estado atual: dá para voltar se não era o que você queria.
    const seguranca = await automatico('antes-de-importar');
    const atuais = Object.fromEntries((await store.listar('ias')).map((i) => [i.id, i]));
    for (const [colecao, itens] of Object.entries(b.dados)) {
      if (!Array.isArray(itens)) continue;
      if (modo === 'substituir') for (const velho of await store.listar(colecao)) if (!itens.some((x) => x.id === velho.id)) await store.remover(colecao, velho.id);
      for (const item of itens) {
        if (!item?.id) continue;
        // Chaves que não vieram no backup (vazias) continuam as que você já tinha neste computador.
        if (colecao === 'ias' && item.env) item.env = Object.fromEntries(Object.entries(item.env).map(([k, v]) => [k, v || atuais[item.id]?.env?.[k] || '']));
        await store.salvar(colecao, item);
      }
    }
    let notas = 0;
    if (b.cerebro) {
      for (const [rel, base64] of Object.entries(b.cerebro)) {
        const destino = path.resolve(cfg.vault, rel);
        if (!destino.startsWith(path.resolve(cfg.vault) + path.sep)) continue;
        if (modo === 'juntar' && fs.existsSync(destino)) continue;
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, Buffer.from(base64, 'base64'));
        notas += 1;
      }
    }
    vault.garantir(await store.listar('equipes'));
    bus.emitir({ tipo: 'recarregar' });
    return { ...resumo(b), modo, notasGravadas: notas, seguranca: seguranca?.arquivo };
  };

  // Backup automático em dados/backups (guarda os últimos 8). Feito ao abrir uma versão nova do app.
  const automatico = async (motivo) => {
    try {
      fs.mkdirSync(pastaAuto, { recursive: true });
      const arquivo = path.join(pastaAuto, `auto-${motivo}-${carimbo()}.json`);
      fs.writeFileSync(arquivo, JSON.stringify(await montar({ cerebro: false, segredos: true })));
      const antigos = fs
        .readdirSync(pastaAuto)
        .filter((n) => n.startsWith('auto-'))
        .map((n) => ({ n, t: fs.statSync(path.join(pastaAuto, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
        .slice(AUTOMATICOS);
      for (const a of antigos) fs.unlinkSync(path.join(pastaAuto, a.n));
      return { arquivo };
    } catch (e) {
      console.error('[backup] automático falhou:', e.message);
      return null;
    }
  };

  // Na primeira abertura de uma versão nova: guarda o estado de antes.
  const aoIniciar = async () => {
    const reg = (await store.obter('ajustes', 'sistema')) ?? { id: 'sistema' };
    if (reg.versao !== versao) {
      const r = await automatico(`versao-${reg.versao ?? 'inicial'}-para-${versao}`);
      if (r) console.log(`Backup automático antes da versão ${versao}: ${r.arquivo}`);
      await store.salvar('ajustes', { ...reg, versao, atualizado: new Date().toISOString() });
    }
  };

  const listarAutomaticos = () => {
    if (!fs.existsSync(pastaAuto)) return [];
    return fs
      .readdirSync(pastaAuto)
      .filter((n) => n.endsWith('.json'))
      .map((n) => ({ nome: n, arquivo: path.join(pastaAuto, n), criado: fs.statSync(path.join(pastaAuto, n)).mtime.toISOString(), tamanho: fs.statSync(path.join(pastaAuto, n)).size }))
      .sort((a, b) => (a.criado < b.criado ? 1 : -1));
  };

  const restaurarAutomatico = async (nome, opcoes) => {
    const arquivo = path.join(pastaAuto, path.basename(nome));
    if (!fs.existsSync(arquivo)) throw Object.assign(new Error('Backup não encontrado.'), { status: 404 });
    return importar(fs.readFileSync(arquivo, 'utf8'), opcoes);
  };

  return { PARTES, exportar, importar, ler, resumo, aoIniciar, automatico, listarAutomaticos, restaurarAutomatico, pastaBackups, pastaAuto };
};
