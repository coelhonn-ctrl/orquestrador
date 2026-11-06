import fs from 'node:fs';
import path from 'node:path';
import { textoDoOffice } from './office.js';

// O vault é a base de conhecimento comum, no formato do Obsidian.
// 10-tarefas: uma nota por tarefa, o único contexto que gestor e supervisores compartilham.
// 20-areas:   o que funcionou de fato, por área. Entra como rascunho e vira validado no aprovar.
// 30-anexos:  fotos enviadas com as solicitações.

const LIMITE_ANEXO = 50 * 1024 * 1024;
const LIMITE_TEXTO_NOTA = 6000;
const EXT_TEXTO = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|env|log|sql|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|php|java|kt|cs|go|rs|c|h|cpp|hpp|sh|bat|ps1|vue|svelte|dart|swift|r|lua)$/i;
const ehTexto = (a) => !/officedocument|msword|ms-excel|ms-powerpoint|zip|pdf|octet-stream/.test(a.tipo) && (/^text\//.test(a.tipo) || /^application\/(json|xml|javascript|x-yaml|yaml|sql|csv)\b|\+(json|xml)$/.test(a.tipo) || EXT_TEXTO.test(a.nome));

const PASTAS = { tarefas: '10-tarefas', areas: '20-areas', anexos: '30-anexos', skills: '40-skills' };
export const MAPA = '_mapa.md';

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
- **30-anexos**: arquivos enviados com as solicitações.
- **40-skills**: habilidades modulares que as equipes herdam (criadas na Central de skills).
- **20-areas/_mapa.md**: a árvore de navegação (Categoria > Subcategoria > Domínio > Especialidade). Comece por ela.

Cada conhecimento em 20-areas abre três caminhos, do mais direto ao mais externo:
1. **O conhecimento consolidado** (a nota na raiz da área: Conceito e Método). É o que toda IA lê primeiro, e o único ligado direto à equipe.
2. **Casos de uso** (em \`exemplos/\`), ligados a partir da nota de conhecimento. Abra só se precisar ver a regra aplicada.
3. **Como foi adquirido** (a tarefa ou o treino, em \`origem/\` e \`10-tarefas\`), ligado a partir da nota de conhecimento. Nunca direto à equipe.

Gestor e supervisores melhoram as áreas aos poucos. Você pode editar tudo à mão.
`;

const comoFazer = (area, topico) => `---
area: ${area}
estado: validado
---
# ${topico.replace(/-/g, ' ')}

Escreva aqui o jeito certo de fazer isso neste ambiente. As equipes leem antes de começar.
`;

// Notas antigas: "3. Exemplos de uso" vira "3. Casos de uso", e treinos/tarefas listados ali vão para "4. Como foi adquirido".
export const migrarCamadas = (texto) => {
  let t = String(texto).replace(/^## 3\. Exemplos de uso\s*$/m, '## 3. Casos de uso');
  const m = t.match(/(## 3\. Casos de uso\n)([\s\S]*?)(?=\n## |$)/);
  if (!m) return t;
  const linhas = m[2].split('\n');
  const origem = linhas.filter((l) => /^- .*\[\[(treino-[^\]]+|T-\d+)\]\]/.test(l) && !/\[\[exemplos-/.test(l));
  const casos = linhas
    .map((l) => {
      // "- [[treino-x]] (90/100) · respostas de referência em [[exemplos-y]]": fica só o caso de uso.
      const ex = l.match(/\[\[(exemplos-[^\]]+)\]\]/);
      if (ex && /\[\[treino-/.test(l)) return `- [[${ex[1]}]]`;
      return /^- \[\[[^\]]+\]\] \((T-\d+)\)$/.test(l) ? l.replace(/ \((T-\d+)\)$/, '') : l;
    })
    .filter((l) => !origem.includes(l));
  t = t.replace(m[0], `${m[1]}${casos.join('\n')}`);
  const treinos = [...m[2].matchAll(/\[\[(treino-[^\]]+)\]\](?: \(([^)]*)\))?/g)].map((x) => `[[${x[1]}]] · treino${x[2] ? ` (${x[2]})` : ''}`);
  const tarefas = [...m[2].matchAll(/\((T-\d+)\)/g)].map((x) => `[[${x[1]}]] · tarefa`);
  return [...treinos, ...tarefas].length ? juntarSecao(t, '4. Como foi adquirido', [...treinos, ...tarefas]) : t;
};

// Itens novos numa seção "## <nome>" de uma nota (cria a seção no fim se não existir), sem repetir.
export const juntarSecao = (texto, secao, itens) => {
  const esc = secao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(## ${esc}\\n)([\\s\\S]*?)(?=\\n## |$)`);
  const m = texto.match(re);
  const corpo = m?.[2] ?? '';
  const novos = itens.filter((x) => {
    const link = x.match(/\[\[[^\]]+\]\]/)?.[0];
    return x && !corpo.includes(link ?? x);
  });
  if (!novos.length) return texto;
  const linhas = novos.map((x) => `- ${x}`).join('\n');
  return m ? texto.replace(re, (_, cabeca, c) => `${cabeca}${c.trimEnd() ? `${c.trimEnd()}\n` : ''}${linhas}\n`) : `${texto.trimEnd()}\n\n## ${secao}\n${linhas}\n`;
};

// Treinos antigos ficavam em exemplos/: vão para origem/ (como o conhecimento foi adquirido) e as notas de
// conhecimento passam a separar casos de uso de origem. Roda uma vez por inicialização; é idempotente.
export const migrarVaultCamadas = (raiz) => {
  const areas = path.join(raiz, '20-areas');
  if (!fs.existsSync(areas)) return;
  for (const area of fs.readdirSync(areas, { withFileTypes: true })) {
    if (!area.isDirectory()) continue;
    const dir = path.join(areas, area.name);
    const ex = path.join(dir, 'exemplos');
    if (fs.existsSync(ex))
      for (const n of fs.readdirSync(ex).filter((x) => /^treino-.*\.md$/.test(x))) {
        fs.mkdirSync(path.join(dir, 'origem'), { recursive: true });
        const destino = path.join(dir, 'origem', n);
        if (!fs.existsSync(destino)) fs.renameSync(path.join(ex, n), destino);
      }
    for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && !x.startsWith('_'))) {
      const arq = path.join(dir, n);
      const antes = fs.readFileSync(arq, 'utf8');
      if (!/## 3\. Exemplos de uso/.test(antes)) continue;
      fs.writeFileSync(arq, migrarCamadas(antes));
    }
  }
};

export const criarVault = (raiz, areasPadrao = {}, aoUsar = null) => {
  const caminho = (...partes) => path.join(raiz, ...partes);

  // Avisa quem estiver olhando (a tela do Cérebro) que estas notas entraram no pedido de uma equipe agora.
  const usou = ({ equipe, area, tarefaId, mapa = false }) => {
    if (!aoUsar) return;
    try {
      const dir = caminhoArea(area);
      const notas = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !n.startsWith('_')).map((n) => `${PASTAS.areas}/${area || 'geral'}/${n}`) : [];
      if (mapa) notas.push(`${PASTAS.areas}/${MAPA}`);
      if (notas.length) aoUsar({ equipe, tarefaId, notas, como: 'pedido' });
    } catch {}
  };

  const garantir = (equipes) => {
    for (const pasta of Object.values(PASTAS)) fs.mkdirSync(caminho(pasta), { recursive: true });
    if (!fs.existsSync(caminho('README.md'))) fs.writeFileSync(caminho('README.md'), LEIA_ME);
    for (const equipe of equipes) {
      if (!equipe.area) continue;
      // Notas de exemplo e de treino que versões antigas deixavam na raiz da área vão para exemplos/.
      try {
        const dirA = caminho(PASTAS.areas, equipe.area);
        if (fs.existsSync(dirA))
          for (const n of fs.readdirSync(dirA).filter((x) => /^(treino-tr-|exemplos-).+\.md$/.test(x))) {
            fs.mkdirSync(path.join(dirA, 'exemplos'), { recursive: true });
            fs.renameSync(path.join(dirA, n), path.join(dirA, 'exemplos', n));
          }
      } catch {}
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
    const fotos = (tarefa.fotos ?? []).filter((f) => !(tarefa.arquivos ?? []).some((a) => a.arquivo === f));
    const anexos = [...fotos.map((f) => `![[${f}]]\nCaminho: \`${caminhoAnexo(f)}\``), ...(tarefa.arquivos ?? []).map(descreverAnexo)].join('\n\n');
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
  // Só as notas de conhecimento (camadas 1 e 2) da raiz da área; exemplos e treinos ficam em subpastas.
  const indiceArea = (area) => {
    const dir = caminhoArea(area);
    if (!fs.existsSync(dir)) return '';
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.md') && !n.startsWith('_'))
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

  // Qualquer arquivo enviado com a solicitação (PDF, Word, planilha, código, texto, zip…).
  // Fica em 30-anexos com o nome original, prefixado pela tarefa.
  const salvarArquivo = (tarefaId, indice, { nome, dados } = {}) => {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dados ?? '');
    if (!m) return null;
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    if (buf.length > LIMITE_ANEXO) return null;
    const original = path.basename(String(nome || `arquivo-${indice + 1}`)).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-120) || `arquivo-${indice + 1}`;
    const arquivo = `${tarefaId}-${indice + 1}-${original}`;
    fs.writeFileSync(caminho(PASTAS.anexos, arquivo), buf);
    // Word, PowerPoint e Excel: guarda também o texto extraído, que as IAs conseguem ler.
    const texto = textoDoOffice(buf, original);
    let textoExtraido = null;
    if (texto) {
      textoExtraido = `${arquivo}.txt`;
      fs.writeFileSync(caminho(PASTAS.anexos, textoExtraido), texto);
    }
    return { arquivo, nome: original, tipo: m[1] || 'application/octet-stream', tamanho: buf.length, textoExtraido };
  };

  // Aprendizado em três caminhos. A nota na raiz da área guarda só o conhecimento consolidado (1. Conceito, 2. Método)
  // e é a única ligada direto à equipe; dela saem 3. Casos de uso (exemplos/) e 4. Como foi adquirido (a tarefa).
  // Aprendizado sem conceito e método (só um caso) não entra na raiz da área: fica só como exemplo.
  const registrarAprendizado = ({ area, aprendizado, texto, tarefa, equipe, caminho: trilha = [] }) => {
    const a = typeof aprendizado === 'object' && aprendizado ? aprendizado : { exemplo: aprendizado ?? texto };
    const limpo = (v, max = 3000) => String(v ?? '').trim().slice(0, max);
    const titulo = limpo(a.titulo, 90) || limpo(a.conceito, 90).split(/[.\n]/)[0] || limpo(a.exemplo, 90).split(/[.\n]/)[0];
    if (!titulo) return null;
    const dir = caminhoArea(area);
    const dirEx = path.join(dir, 'exemplos');
    fs.mkdirSync(dirEx, { recursive: true });
    const nomeConceito = slug(titulo);
    const nomeExemplo = `${tarefa.id.toLowerCase()}-${nomeConceito}`.slice(0, 80);
    const conceito = limpo(a.conceito);
    const metodo = limpo(a.metodo);
    const temConhecimento = conceito.length >= 20 && metodo.length >= 20;
    const cab = (extra) => `---\narea: ${area}\n${trilha.length ? `caminho: ${trilha.join(' > ')}\n` : ''}equipe: ${equipe}\n${extra}---\n`;

    // Camada 3: o caso real.
    fs.writeFileSync(
      path.join(dirEx, `${nomeExemplo}.md`),
      `${cab(`tipo: exemplo\nestado: rascunho\norigem: "[[${tarefa.id}]]"\n`)}# Exemplo: ${titulo}\n\n${temConhecimento ? `Conhecimento: [[${nomeConceito}]]\n\n` : ''}${limpo(a.exemplo) || `Visto na tarefa [[${tarefa.id}]].`}\n\nTarefa: [[${tarefa.id}]]\n`,
    );
    if (!temConhecimento) return path.relative(raiz, path.join(dirEx, `${nomeExemplo}.md`));

    // Camadas 1 e 2: o conhecimento, agnóstico ao caso.
    const arq = path.join(dir, `${nomeConceito}.md`);
    const quando = new Date().toLocaleDateString('sv-SE');
    if (fs.existsSync(arq)) {
      let atual = migrarCamadas(fs.readFileSync(arq, 'utf8'));
      if (!atual.includes(`[[${nomeExemplo}]]`)) {
        if (metodo && !atual.includes(metodo.slice(0, 60))) atual = atual.replace(/(## 3\. Casos de uso)/, `Variação vista em [[${nomeExemplo}]]: ${metodo}\n\n$1`);
        atual = juntarSecao(atual, '3. Casos de uso', [`[[${nomeExemplo}]]`]);
      }
      atual = juntarSecao(atual, '4. Como foi adquirido', [`[[${tarefa.id}]] · tarefa de ${quando}`]);
      fs.writeFileSync(arq, atual);
    } else {
      fs.writeFileSync(arq, `${cab('tipo: conhecimento\nestado: rascunho\n')}# ${titulo}\n\n${trilha.length ? `Caminho: ${trilha.join(' > ')}\n\n` : ''}## 1. Conceito\n${conceito}\n\n## 2. Método\n${metodo}\n\n## 3. Casos de uso\n- [[${nomeExemplo}]]\n\n## 4. Como foi adquirido\n- [[${tarefa.id}]] · tarefa de ${quando}\n`);
    }
    return path.relative(raiz, arq);
  };

  // Lista acumulada numa nota da área ("- item · [[origem]]"), sem repetir itens.
  // Usada para os critérios e os erros comuns de cada equipe (vindos dos treinos e das tarefas reais).
  const acumularLista = ({ area, nome, titulo, intro, itens, estado = 'rascunho', equipe = '', origem = '' }) => {
    const dir = caminhoArea(area);
    fs.mkdirSync(dir, { recursive: true });
    const arq = path.join(dir, `${nome}.md`);
    const atual = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : `---\narea: ${area}\nestado: ${estado}\n${equipe ? `equipe: ${equipe}\n` : ''}---\n# ${titulo}\n\n${intro}\n\n`;
    const ja = new Set([...atual.matchAll(/^- (.+?)(?: · \[\[[^\]]+\]\])?$/gm)].map((m) => m[1].trim().toLowerCase()));
    const novos = [];
    for (const x of itens.map((y) => String(y ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      if (ja.has(x.toLowerCase())) continue;
      ja.add(x.toLowerCase());
      novos.push(x);
    }
    if (!novos.length && fs.existsSync(arq)) return 0;
    fs.writeFileSync(arq, `${atual.trimEnd()}\n${novos.map((x) => `- ${x}${origem ? ` · [[${origem}]]` : ''}`).join('\n')}\n`);
    return novos.length;
  };

  const lerLista = (area, nome) => {
    const arq = path.join(caminhoArea(area), `${nome}.md`);
    if (!fs.existsSync(arq)) return [];
    return [...fs.readFileSync(arq, 'utf8').matchAll(/^- (.+?)(?: · \[\[[^\]]+\]\])?$/gm)].map((m) => m[1].trim());
  };
  // Mapa raiz: a árvore Categoria > Subcategoria > Domínio > Especialidade, com a pasta de cada equipe
  // e as notas de conhecimento de cada uma. As equipes começam por aqui em vez de buscar às cegas.
  const atualizarMapa = (equipes) => {
    try {
      const arvore = {};
      for (const e of equipes.filter((x) => x.caminho?.length && x.area)) {
        let no = arvore;
        for (const parte of e.caminho) no = no[parte] ??= {};
        (no.__equipes ??= []).push(e);
      }
      const linhas = [];
      const andar = (no, nivel) => {
        for (const [nome, filho] of Object.entries(no).filter(([k]) => k !== '__equipes').sort(([a], [b]) => a.localeCompare(b))) {
          linhas.push(`${'  '.repeat(nivel)}- **${nome}**`);
          for (const e of filho.__equipes ?? []) {
            const notas = indiceArea(e.area)
              .split('\n')
              .filter(Boolean)
              .map((l) => l.match(/^- (.+?)\.md/)?.[1])
              .filter(Boolean);
            linhas.push(`${'  '.repeat(nivel + 1)}- Equipe ${e.nome} · pasta \`20-areas/${e.area}/\`${notas.length ? `: ${notas.map((n) => `[[${n}]]`).join(', ')}` : ''}`);
          }
          andar(filho, nivel + 1);
        }
      };
      andar(arvore, 0);
      fs.mkdirSync(caminho(PASTAS.areas), { recursive: true });
      fs.writeFileSync(
        caminho(PASTAS.areas, MAPA),
        `---\ntipo: mapa\nestado: validado\n---\n# Mapa do cérebro\n\nÁrvore de navegação: Categoria > Subcategoria > Domínio > Especialidade > Item. Comece por aqui, ache o seu ramo e só então abra as notas.\nCada conhecimento abre três caminhos: a nota na raiz da área (Conceito e Método, leia primeiro), os casos de uso (\`exemplos/\`) e como foi adquirido (\`origem/\` e a tarefa). Só abra os dois últimos se precisar.\n\n${linhas.join('\n')}\n`,
      );
    } catch (e) {
      console.error('[vault] mapa:', e.message);
    }
  };
  const caminhoMapa = () => caminho(PASTAS.areas, MAPA);

  const promover = (relativo) => {
    const arq = path.join(raiz, relativo);
    if (!arq.startsWith(raiz) || !fs.existsSync(arq)) return;
    fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace(/^estado:\s*rascunho/m, 'estado: validado'));
  };

  // Como o anexo aparece na nota: nome, tipo, caminho para a IA abrir e, se for texto, o conteúdo.
  const descreverAnexo = (a) => {
    const abs = caminhoAnexo(a.arquivo);
    const tam = a.tamanho > 1024 * 1024 ? `${(a.tamanho / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.tamanho / 1024))} KB`;
    const linhas = [`### ${a.nome}`, `Tipo: ${a.tipo} · ${tam}`, `Caminho: \`${abs}\``];
    if (/^image\//.test(a.tipo)) linhas.push(`![[${a.arquivo}]]`);
    else if (ehTexto(a) && fs.existsSync(abs)) {
      // Arquivo com bytes nulos não é texto de verdade: vai só o caminho.
      const conteudo = fs.readFileSync(abs, 'utf8').replace(/\0/g, '');
      const corte = conteudo.length > LIMITE_TEXTO_NOTA;
      linhas.push(`Conteúdo${corte ? ` (primeiros ${LIMITE_TEXTO_NOTA} caracteres; leia o arquivo para o resto)` : ''}:`, '```', conteudo.slice(0, LIMITE_TEXTO_NOTA), '```');
    } else if (a.textoExtraido && fs.existsSync(caminhoAnexo(a.textoExtraido))) {
      const conteudo = fs.readFileSync(caminhoAnexo(a.textoExtraido), 'utf8');
      const corte = conteudo.length > LIMITE_TEXTO_NOTA;
      linhas.push(`Texto extraído pelo app (arquivo completo em \`${caminhoAnexo(a.textoExtraido)}\`)${corte ? `, primeiros ${LIMITE_TEXTO_NOTA} caracteres` : ''}:`, '```', conteudo.slice(0, LIMITE_TEXTO_NOTA), '```');
    } else if (/pdf/.test(a.tipo) || /\.pdf$/i.test(a.nome)) linhas.push('PDF: abra pelo caminho com a sua ferramenta de leitura de arquivos.');
    else linhas.push('Abra pelo caminho se precisar do conteúdo (arquivo binário: Word, planilha, zip etc.).');
    return linhas.join('\n');
  };

  return { raiz, usou, garantir, atualizarMapa, caminhoMapa, pastaSkills: () => caminho(PASTAS.skills), salvarArquivo, caminhoNota, caminhoArea, criarNota, anexar, lerNota, indiceArea, salvarFoto, caminhoAnexo, registrarAprendizado, promover, acumularLista, lerLista };
};
