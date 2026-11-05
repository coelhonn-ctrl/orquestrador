import fs from 'node:fs';
import path from 'node:path';

// O vault é a base de conhecimento comum, no formato do Obsidian.
// 10-tarefas: uma nota por tarefa, o único contexto que gestor e supervisores compartilham.
// 20-areas:   o que funcionou de fato, por área. Entra como rascunho e vira validado no aprovar.
// 30-anexos:  fotos enviadas com as solicitações.

const PASTAS = { tarefas: '10-tarefas', areas: '20-areas', anexos: '30-anexos' };

const slug = (texto) =>
  String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'nota';

const hora = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const LEIA_ME = `# Cérebro do Singularize Orquestrador

Base de conhecimento comum das equipes. Abra esta pasta no Obsidian.

- **10-tarefas**: uma nota por tarefa. É o único canal entre o gestor e os supervisores.
- **20-areas**: o que funcionou de fato, por área. Rascunhos viram \`validado\` quando você aprova a entrega.
- **30-anexos**: fotos enviadas com as solicitações.

Gestor e supervisores melhoram as áreas aos poucos. Você pode editar tudo à mão.
`;

const comoFazer = (area, topico) => `---
area: ${area}
estado: validado
---
# ${topico.replace(/-/g, ' ')}

Escreva aqui o jeito certo de fazer isso neste ambiente. As equipes leem antes de começar.
`;

export const criarVault = (raiz, areasPadrao = {}) => {
  const caminho = (...partes) => path.join(raiz, ...partes);

  const garantir = (equipes) => {
    for (const pasta of Object.values(PASTAS)) fs.mkdirSync(caminho(pasta), { recursive: true });
    if (!fs.existsSync(caminho('README.md'))) fs.writeFileSync(caminho('README.md'), LEIA_ME);
    for (const equipe of equipes) {
      if (!equipe.area) continue;
      const dirArea = caminho(PASTAS.areas, equipe.area);
      fs.mkdirSync(dirArea, { recursive: true });
      for (const topico of areasPadrao[equipe.area] ?? []) {
        const arq = path.join(dirArea, `${topico}.md`);
        if (!fs.existsSync(arq)) fs.writeFileSync(arq, comoFazer(equipe.area, topico));
      }
    }
  };

  const caminhoNota = (tarefa) => caminho(PASTAS.tarefas, `${tarefa.id}.md`);
  const caminhoArea = (area) => caminho(PASTAS.areas, area || 'geral');

  const criarNota = (tarefa, projeto) => {
    const anexos = (tarefa.fotos ?? []).map((f) => `![[${f}]]`).join('\n');
    const texto = `---
id: ${tarefa.id}
projeto: "${projeto?.nome ?? ''}"
pasta: "${tarefa.cwd ?? projeto?.pasta ?? ''}"
criada: ${tarefa.criada}
---
# ${tarefa.id} · ${tarefa.titulo}

## Pedido
${tarefa.texto}
${anexos ? `\n## Anexos\n${anexos}\n` : ''}
## Registro
`;
    fs.writeFileSync(caminhoNota(tarefa), texto);
  };

  const anexar = (tarefa, titulo, corpo) => {
    const arq = caminhoNota(tarefa);
    if (!fs.existsSync(arq)) return;
    fs.appendFileSync(arq, `\n### ${titulo} · ${hora()}\n${String(corpo ?? '').trim()}\n`);
  };

  const lerNota = (tarefa) => {
    const arq = caminhoNota(tarefa);
    return fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
  };

  // Índice curto da área: só nomes e primeira linha, para não gastar tokens com notas inteiras.
  const indiceArea = (area) => {
    const dir = caminhoArea(area);
    if (!fs.existsSync(dir)) return '';
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => {
        const conteudo = fs.readFileSync(path.join(dir, n), 'utf8');
        const estado = conteudo.match(/^estado:\s*(\w+)/m)?.[1] ?? 'rascunho';
        const resumo = conteudo.replace(/^---[\s\S]*?---/, '').split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
        return `- ${n} (${estado}): ${resumo.trim().slice(0, 140)}`;
      })
      .join('\n');
  };

  const salvarFoto = (tarefaId, indice, dataUrl) => {
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(dataUrl ?? '');
    if (!m) return null;
    const nome = `${tarefaId}-${indice + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(caminho(PASTAS.anexos, nome), Buffer.from(m[2], 'base64'));
    return nome;
  };

  const caminhoAnexo = (nome) => caminho(PASTAS.anexos, path.basename(nome));

  const registrarAprendizado = ({ area, texto, tarefa, equipe }) => {
    const dir = caminhoArea(area);
    fs.mkdirSync(dir, { recursive: true });
    const nome = `${slug(texto.split(/[.\n]/)[0])}.md`;
    const arq = path.join(dir, nome);
    if (fs.existsSync(arq) && fs.readFileSync(arq, 'utf8').includes(`[[${tarefa.id}]]`)) return path.relative(raiz, arq);
    const corpo = fs.existsSync(arq)
      ? `${fs.readFileSync(arq, 'utf8')}\n\nVisto de novo em [[${tarefa.id}]]: ${texto}\n`
      : `---\narea: ${area}\nestado: rascunho\norigem: "[[${tarefa.id}]]"\nequipe: ${equipe}\n---\n# ${texto.split(/[.\n]/)[0].slice(0, 90)}\n\n${texto}\n`;
    fs.writeFileSync(arq, corpo);
    return path.relative(raiz, arq);
  };

  const promover = (relativo) => {
    const arq = path.join(raiz, relativo);
    if (!arq.startsWith(raiz) || !fs.existsSync(arq)) return;
    fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace(/^estado:\s*rascunho/m, 'estado: validado'));
  };

  return { raiz, garantir, caminhoNota, caminhoArea, criarNota, anexar, lerNota, indiceArea, salvarFoto, caminhoAnexo, registrarAprendizado, promover };
};
