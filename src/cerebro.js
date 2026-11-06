import fs from 'node:fs';
import path from 'node:path';

// O "cérebro" é o vault do Obsidian visto pelos agentes: buscar uma skill ou área que já existe,
// ler uma nota e registrar o que aprenderam. Caminhos sempre relativos à raiz do vault.

const IGNORAR = new Set(['.obsidian', '.trash', '30-anexos']);
const LIMITE_NOTAS = 4000;

const normalizar = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const slug = (t) => normalizar(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'nota';

export const criarCerebro = (raiz) => {
  // Resolve um caminho vindo de fora e garante que fica dentro do vault.
  const resolver = (relativo) => {
    const limpo = String(relativo ?? '').replace(/^vault[\\/]/, '').trim();
    const abs = path.resolve(raiz, limpo);
    if (abs !== raiz && !abs.startsWith(raiz + path.sep)) return null;
    return abs;
  };

  const relativo = (abs) => path.relative(raiz, abs).split(path.sep).join('/');

  const listarNotas = () => {
    const saida = [];
    const andar = (dir) => {
      if (saida.length >= LIMITE_NOTAS || !fs.existsSync(dir)) return;
      for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORAR.has(nome.name) || nome.name.startsWith('.')) continue;
        const abs = path.join(dir, nome.name);
        if (nome.isDirectory()) andar(abs);
        else if (nome.name.endsWith('.md')) saida.push(abs);
      }
    };
    andar(raiz);
    return saida;
  };

  const resumoDe = (conteudo) => {
    const corpo = conteudo.replace(/^---[\s\S]*?---/, '');
    const titulo = corpo.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
    const linha = corpo.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '';
    const estado = conteudo.match(/^estado:\s*(\w+)/m)?.[1] ?? null;
    return { titulo, linha: linha.slice(0, 160), estado };
  };

  // Busca simples por termos no caminho, título e conteúdo. Validado e áreas vêm antes de tarefas.
  const buscar = (consulta, limite = 15) => {
    const termos = normalizar(consulta).split(/\s+/).filter(Boolean);
    const achados = [];
    for (const abs of listarNotas()) {
      const rel = relativo(abs);
      const conteudo = fs.readFileSync(abs, 'utf8');
      const { titulo, linha, estado } = resumoDe(conteudo);
      const alvoCabeca = normalizar(`${rel} ${titulo}`);
      const alvoCorpo = normalizar(conteudo);
      let pontos = 0;
      for (const t of termos) {
        if (alvoCabeca.includes(t)) pontos += 5;
        else if (alvoCorpo.includes(t)) pontos += 1;
        else {
          pontos = -1;
          break;
        }
      }
      if (termos.length && pontos <= 0) continue;
      if (rel.startsWith('20-areas/')) pontos += 2;
      if (estado === 'validado') pontos += 2;
      if (rel.startsWith('10-tarefas/')) pontos -= 1;
      // O conhecimento consolidado vem antes; casos de uso depois; como foi adquirido por último.
      if (/^20-areas\/[^/]+\/exemplos\//.test(rel)) pontos -= 1;
      if (/^20-areas\/[^/]+\/origem\//.test(rel)) pontos -= 3;
      achados.push({ caminho: rel, absoluto: abs, titulo: titulo || path.basename(rel, '.md'), resumo: linha, estado, pontos });
    }
    return achados.sort((a, b) => b.pontos - a.pontos || a.caminho.localeCompare(b.caminho)).slice(0, limite);
  };

  const ler = (rel) => {
    const abs = resolver(rel);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return { caminho: relativo(abs), absoluto: abs, conteudo: fs.readFileSync(abs, 'utf8') };
  };

  const existe = (rel) => {
    const abs = resolver(rel);
    return !!abs && fs.existsSync(abs);
  };

  // Um agente registra uma skill/padrão. Entra como rascunho; o operador valida.
  const aprender = ({ area, titulo, texto, agente }) => {
    const dir = resolver(path.join('20-areas', slug(area || 'geral')));
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, `${slug(titulo)}.md`);
    const cabecalho = `---\narea: ${slug(area || 'geral')}\nestado: rascunho\nautor: ${agente ?? 'operador'}\natualizado: ${new Date().toISOString()}\n---\n# ${titulo}\n\n`;
    if (fs.existsSync(abs)) fs.appendFileSync(abs, `\n\n## Complemento de ${agente ?? 'operador'} · ${new Date().toLocaleString('pt-BR')}\n${texto}\n`);
    else fs.writeFileSync(abs, `${cabecalho}${texto}\n`);
    return { caminho: relativo(abs), absoluto: abs };
  };

  const validar = (rel) => {
    const abs = resolver(rel);
    if (!abs || !fs.existsSync(abs)) return false;
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/^estado:\s*rascunho/m, 'estado: validado'));
    return true;
  };

  const areas = () => {
    const dir = path.join(raiz, '20-areas');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  };

  // Grafo do cérebro, como o "graph view" do Obsidian, agrupado por equipe:
  // nós = notas (+ um nó por equipe/área), ligações = [[links]] entre notas, nota → equipe da área,
  // e tarefa → equipes que trabalharam nela.
  const grafo = ({ equipes = [], tarefas = [] } = {}) => {
    const nos = new Map();
    const ligacoes = new Map();
    const ligar = (a, b, tipo) => {
      if (!a || !b || a === b || !nos.has(a) || !nos.has(b)) return;
      const chave = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!ligacoes.has(chave)) ligacoes.set(chave, { de: a, para: b, tipo });
    };
    const porArea = new Map(equipes.filter((e) => e.area).map((e) => [e.area, e]));
    const hubDeArea = (area) => {
      const equipe = porArea.get(area);
      const id = equipe ? `equipe:${equipe.id}` : `area:${area}`;
      if (!nos.has(id)) nos.set(id, { id, tipo: 'equipe', titulo: equipe?.nome ?? area.replace(/-/g, ' '), equipe: equipe?.id ?? null, familia: equipe?.familia || null, area, notas: 0 });
      return id;
    };
    // Toda equipe aparece, mesmo sem notas ainda: dá para ver o time se formando.
    for (const e of equipes) if (e.area) hubDeArea(e.area);

    const arquivos = listarNotas();
    const porNome = new Map();
    const conteudos = new Map();
    for (const abs of arquivos) {
      const rel = relativo(abs);
      const conteudo = fs.readFileSync(abs, 'utf8');
      conteudos.set(rel, conteudo);
      const { titulo, linha, estado } = resumoDe(conteudo);
      const partes = rel.split('/');
      const tipo = partes[0] === '10-tarefas' ? 'tarefa' : partes[0] === '20-areas' ? 'conhecimento' : 'outro';
      const area = tipo === 'conhecimento' && partes.length > 2 ? partes[1] : null;
      const st = fs.statSync(abs);
      const no = { id: rel, tipo, titulo: titulo || path.basename(rel, '.md'), resumo: linha, estado, area, equipe: null, tamanho: st.size, atualizado: st.mtimeMs };
      nos.set(rel, no);
      porNome.set(normalizar(path.basename(rel, '.md')), rel);
      porNome.set(normalizar(rel.replace(/\.md$/, '')), rel);
    }
    for (const [rel, conteudo] of conteudos) {
      const no = nos.get(rel);
      if (no.area) {
        const hub = hubDeArea(no.area);
        no.equipe = nos.get(hub).equipe;
        // Três caminhos: só o conhecimento consolidado (raiz da área) liga direto na equipe.
        // Casos de uso (exemplos/) e como foi adquirido (origem/) só se ligam pelos links da nota de conhecimento.
        const partes = rel.split('/');
        no.camada = partes.length === 3 ? 'conhecimento' : partes[2] === 'origem' ? 'origem' : 'caso';
        if (no.camada === 'conhecimento') {
          nos.get(hub).notas += 1;
          ligar(rel, hub, 'area');
        }
      }
      for (const m of conteudo.matchAll(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
        const alvo = porNome.get(normalizar(m[1].trim().replace(/\.md$/, '')));
        if (alvo) ligar(rel, alvo, 'link');
      }
      for (const m of conteudo.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
        const alvo = porNome.get(normalizar(decodeURI(m[1]).replace(/^\.\//, '').replace(/\.md$/, '')));
        if (alvo) ligar(rel, alvo, 'link');
      }
    }
    // Tarefa → equipes que trabalharam nela.
    for (const t of tarefas) {
      const rel = `10-tarefas/${t.id}.md`;
      if (!nos.has(rel)) continue;
      nos.get(rel).estado = t.estado;
      for (const passo of t.plano ?? []) {
        const e = equipes.find((x) => x.id === passo.equipe);
        if (e?.area) ligar(rel, hubDeArea(e.area), 'trabalho');
      }
    }
    return { nos: [...nos.values()], ligacoes: [...ligacoes.values()], gerado: Date.now() };
  };

  return { raiz, resolver, buscar, ler, existe, aprender, validar, areas, relativo, grafo };
};
