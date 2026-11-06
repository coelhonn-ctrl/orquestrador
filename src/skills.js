import fs from 'node:fs';
import path from 'node:path';

// Central de skills: habilidades modulares (um jeito de fazer, um checklist, um roteiro de comportamento)
// guardadas como notas no cérebro, em 40-skills. Cada skill vale para todas as equipes ou para as
// equipes escolhidas; o supervisor recebe as skills dele junto com as instruções.

const slug = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const LIMITE_NO_PROMPT = 3000;

export const criarSkills = ({ vault, bus }) => {
  const pasta = () => {
    const p = vault.pastaSkills();
    fs.mkdirSync(p, { recursive: true });
    return p;
  };

  const ler = (arquivo) => {
    const bruto = fs.readFileSync(arquivo, 'utf8');
    const fm = bruto.match(/^---\n([\s\S]*?)\n---\n?/);
    const campos = {};
    for (const l of (fm?.[1] ?? '').split('\n')) {
      const m = l.match(/^(\w+):\s*(.*)$/);
      if (m) campos[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    const corpo = bruto.slice(fm?.[0].length ?? 0).replace(/^# .*\n+/, '').trim();
    const equipes = (campos.equipes ?? '').replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      id: path.basename(arquivo, '.md'),
      nome: campos.nome || path.basename(arquivo, '.md'),
      descricao: campos.descricao ?? '',
      todas: campos.todas === 'true',
      equipes,
      conteudo: corpo,
      atualizada: fs.statSync(arquivo).mtime.toISOString(),
      caminho: path.relative(vault.raiz, arquivo).split(path.sep).join('/'),
    };
  };

  const listar = () =>
    fs
      .readdirSync(pasta())
      .filter((n) => n.endsWith('.md'))
      .map((n) => {
        try {
          return ler(path.join(pasta(), n));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.nome.localeCompare(b.nome));

  const gravar = ({ id, nome, descricao = '', todas = false, equipes = [], conteudo = '' }) => {
    const n = String(nome ?? '').trim().slice(0, 80);
    if (!n) throw Object.assign(new Error('Dê um nome à skill.'), { status: 400 });
    if (!String(conteudo).trim()) throw Object.assign(new Error('Escreva o que a skill ensina (o conteúdo).'), { status: 400 });
    const alvo = id || slug(n) || `skill-${Date.now().toString(36)}`;
    const limpa = (v) => String(v ?? '').replace(/\n/g, ' ').replace(/"/g, "'").trim();
    const texto = `---\nnome: "${limpa(n)}"\ndescricao: "${limpa(descricao).slice(0, 300)}"\ntodas: ${!!todas}\nequipes: [${(Array.isArray(equipes) ? equipes : []).map(limpa).filter(Boolean).join(', ')}]\ntipo: skill\nestado: validado\n---\n# ${n}\n\n${String(conteudo).trim().slice(0, 20000)}\n`;
    fs.writeFileSync(path.join(pasta(), `${alvo}.md`), texto);
    bus.emitir({ tipo: 'skills' });
    return ler(path.join(pasta(), `${alvo}.md`));
  };

  const remover = (id) => {
    const arq = path.join(pasta(), `${path.basename(id)}.md`);
    if (fs.existsSync(arq)) fs.unlinkSync(arq);
    bus.emitir({ tipo: 'skills' });
    return { ok: true };
  };

  const daEquipe = (equipeId) => listar().filter((s) => s.todas || s.equipes.includes(equipeId));

  // Bloco que vai no prompt do supervisor: o conteúdo de cada skill herdada (cortado se for muito grande).
  const paraPrompt = (equipeId) => {
    const lista = daEquipe(equipeId);
    if (!lista.length) return '';
    return `\nSkills desta equipe (siga quando o caso pedir; arquivos completos em 40-skills):\n${lista
      .map((s) => `### Skill: ${s.nome}${s.descricao ? ` (use quando: ${s.descricao})` : ''}\n${s.conteudo.length > LIMITE_NO_PROMPT ? `${s.conteudo.slice(0, LIMITE_NO_PROMPT)}\n[continua em ${s.caminho}]` : s.conteudo}`)
      .join('\n\n')}\n`;
  };

  return { listar, gravar, remover, daEquipe, paraPrompt };
};
