import zlib from 'node:zlib';

// Texto de arquivos do Office (.docx, .pptx, .xlsx) para ir junto na nota da tarefa.
// As IAs de terminal leem texto e PDF, mas não abrem Word nem planilha: o app extrai o texto antes.

// Lê as entradas de um .zip pelo diretório central (o .docx é um zip de XMLs).
const lerZip = (buf) => {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return new Map();
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const entradas = new Map();
  for (let n = 0; n < total && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    entradas.set(nome, { metodo, tamComp, local });
    p += 46 + lenNome + lenExtra + lenComent;
  }
  const ler = (nome) => {
    const e = entradas.get(nome);
    if (!e) return null;
    const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const dados = buf.subarray(ini, ini + e.tamComp);
    return (e.metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('utf8');
  };
  return { nomes: [...entradas.keys()], ler };
};

const limparXML = (xml) =>
  xml
    .replace(/<w:tab\/>|<a:tab\/>/g, '\t')
    .replace(/<\/w:p>|<\/a:p>|<w:br\/>|<a:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const textoDoOffice = (buf, nome) => {
  try {
    const ext = String(nome).toLowerCase().split('.').pop();
    if (!['docx', 'pptx', 'xlsx'].includes(ext)) return null;
    const zip = lerZip(buf);
    if (!zip.ler) return null;
    if (ext === 'docx') return limparXML(zip.ler('word/document.xml') ?? '');
    if (ext === 'pptx') {
      const slides = zip.nomes.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
      return slides.map((s, i) => `--- Slide ${i + 1} ---\n${limparXML(zip.ler(s) ?? '')}`).join('\n\n');
    }
    // Planilha: textos compartilhados + valores de cada célula, linha a linha, separados por tabulação.
    const compartilhados = [...(zip.ler('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => limparXML(m[1]));
    const planilhas = zip.nomes.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    return planilhas
      .map((pl, i) => {
        const xml = zip.ler(pl) ?? '';
        const linhas = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 500).map((r) =>
          [...r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)]
            .map((c) => {
              const v = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? limparXML(c[2]);
              return /t="s"/.test(c[1]) ? compartilhados[Number(v)] ?? '' : v;
            })
            .join('\t'),
        );
        return `--- Planilha ${i + 1} ---\n${linhas.join('\n')}`;
      })
      .join('\n\n');
  } catch {
    return null;
  }
};
