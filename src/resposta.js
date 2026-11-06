import { extrairJSON } from './json.js';

// Conversa com as IAs com conferência: cada etapa diz o que a resposta precisa ter. Se a IA fizer o
// trabalho mas responder fora do formato (sem o JSON, campo faltando, equipe que não existe), o app
// pede a correção à mesma IA, mostrando o que veio errado, sem refazer o trabalho. Só depois de
// esgotar as correções a etapa passa para outra IA.

const RECORTE = 6000;
const CORRECOES = 2;

const texto = (v) => typeof v === 'string' && v.trim().length > 0;
const lista = (v) => (Array.isArray(v) ? v : []);

// IA que errou o formato recentemente recebe um lembrete mais firme no fim do pedido.
// Cada erro soma 1, cada acerto tira 1: o lembrete some sozinho quando ela volta a acertar.
export const lembreteFormato = (ia) =>
  (ia?.uso?.formato ?? 0) >= 2
    ? '\n\nIMPORTANTE: termine a resposta com o JSON pedido, dentro de um bloco ```json```, sem nenhum texto depois dele. Respostas sem esse JSON são descartadas.'
    : '';

export const contarFormato = (ia, errou) => {
  ia.uso = { chamadas: 0, falhas: 0, ...ia.uso };
  const atual = ia.uso.formato ?? 0;
  ia.uso.formato = errou ? Math.min(10, atual + 1) : Math.max(0, atual - 1);
  if (errou) ia.uso.correcoes = (ia.uso.correcoes ?? 0) + 1;
  return ia;
};

export const promptCorrecao = ({ esquema, problemas, saida }) => `TIPO_ETAPA: corrigir-formato
Sua resposta anterior não pôde ser usada pelo app: ${problemas.join('; ')}.
Não refaça o trabalho, não rode comandos e não altere arquivos: só reescreva a resposta.
Responda SOMENTE com este JSON, preenchido com o que você já fez ou concluiu:
${esquema}

Fim da sua resposta anterior:
<<<
${String(saida ?? '').trim().slice(-RECORTE) || '(vazia)'}
>>>`;

// rodar(null) faz o pedido original; rodar(textoDeCorrecao) pede a correção.
export const pedirValidado = async ({ rodar, esquema, validar = () => [], correcoes = CORRECOES, aoCorrigir = () => {} }) => {
  // Sem o formato combinado não há o que pedir na correção.
  if (!esquema) correcoes = 0;
  let r = await rodar(null);
  for (let i = 0; ; i++) {
    if (r.codigo !== 0) return { r, json: null, problemas: [], correcoes: i };
    const json = extrairJSON(r.saida);
    const problemas = json ? validar(json) : ['não trouxe o objeto JSON pedido'];
    if (!problemas.length) return { r, json, problemas, correcoes: i };
    if (i >= correcoes) return { r, json: null, problemas, correcoes: i };
    aoCorrigir(problemas, i + 1, correcoes);
    r = await rodar(promptCorrecao({ esquema, problemas, saida: r.saida }));
  }
};

// ------------------------------------------------------------ o que cada etapa precisa trazer

export const validar = {
  triagem: (j) => (texto(j.sintoma) && lista(j.hipoteses).length ? [] : ['faltaram "sintoma" e a lista "hipoteses"']),
  diagnostico: (j) => (texto(j.causa_raiz) && lista(j.correcao).length ? [] : ['faltaram "causa_raiz" e a lista "correcao"']),
  consenso: (j) => (texto(j.causa_raiz) && (lista(j.correcao).length || j.consenso === false) ? [] : ['faltaram "causa_raiz" e a lista "correcao"']),
  teste: (j) => {
    if (j.status === 'falhou') return texto(j.resumo) ? [] : ['faltou o "resumo" dizendo o que impede o teste'];
    const tipo = j.tipo ?? 'servidor';
    if (!['servidor', 'estatico', 'arquivos', 'nenhum'].includes(tipo)) return ['"tipo" deve ser servidor, estatico, arquivos ou nenhum'];
    if (tipo === 'servidor' && !lista(j.processos).some((p) => texto(p?.comando))) return ['faltou "processos" com o "comando" que sobe o servidor'];
    if (tipo === 'servidor' && !texto(j.url)) return ['faltou a "url" para o usuário abrir'];
    if (['estatico', 'arquivos'].includes(tipo) && !lista(j.arquivos).some(texto)) return ['faltou a lista "arquivos"'];
    return [];
  },
  // existe(ref) diz se a equipe citada existe; novas equipes pedidas no próprio plano também valem.
  planejar: (j, { existe, ids = [] } = {}) => {
    const p = [];
    const etapas = lista(j.etapas);
    if (!etapas.length) return ['faltou a lista "etapas" com ao menos uma etapa'];
    const novas = new Set(lista(j.novasEquipes).map((n) => String(n?.nome ?? '').trim().toLowerCase()).filter(Boolean));
    const desconhecidas = [];
    for (const e of etapas) {
      if (!texto(e?.equipe)) {
        p.push('há etapa sem "equipe"');
        continue;
      }
      if (!existe(e.equipe) && !novas.has(e.equipe.trim().toLowerCase())) desconhecidas.push(e.equipe);
    }
    if (desconhecidas.length)
      p.push(`as equipes ${desconhecidas.map((x) => `"${x}"`).join(', ')} não existem. Use um destes ids: ${ids.join(', ') || '(nenhum)'}, ou crie a equipe em "novasEquipes" e use o nome dela`);
    return p;
  },

  questionar: (j) => (texto(j.resposta) || texto(j.resumo) ? [] : ['faltaram "resumo" e "resposta"']),

  analisarEquipe: (j) => (j.duplicada || texto(j.nome) ? [] : ['faltou o "nome" da equipe (ou "duplicada", se ela já existe)']),

  executar: (j) => {
    const p = [];
    if (j.status !== undefined && !['ok', 'pergunta', 'falhou'].includes(j.status)) p.push(`"status" deve ser ok, pergunta ou falhou (veio "${j.status}")`);
    if (j.status === 'pergunta' && !texto(j.pergunta)) p.push('"status" é pergunta, mas faltou o texto em "pergunta"');
    if (j.status === undefined && !texto(j.resumo)) p.push('faltaram "status" e "resumo"');
    if (j.arquivos !== undefined && !Array.isArray(j.arquivos)) p.push('"arquivos" deve ser uma lista');
    return p;
  },

  avaliar: (j) => {
    const p = [];
    if (j.status !== undefined && !['ok', 'pergunta'].includes(j.status)) p.push(`"status" deve ser ok ou pergunta (veio "${j.status}")`);
    if (j.status === 'pergunta') {
      if (!texto(j.pergunta)) p.push('"status" é pergunta, mas faltou o texto em "pergunta"');
      return p;
    }
    if (typeof j.aprovado !== 'boolean') p.push('faltou "aprovado" (true ou false)');
    if (j.criterios !== undefined && !Array.isArray(j.criterios)) p.push('"criterios" deve ser uma lista de {"texto","ok"}');
    return p;
  },

  casos: (j) => {
    const validos = lista(j.casos).filter((c) => texto(c?.pedido) && lista(c?.criterios).some(texto));
    return validos.length ? [] : ['faltou a lista "casos", cada um com "pedido" e ao menos um item em "criterios"'];
  },

  variantes: (j) => (lista(j.variantes).some((v) => texto(v?.instrucoes)) ? [] : ['faltou a lista "variantes", cada uma com "instrucoes" preenchidas']),

  notas: (quantos) => (j) => {
    const notas = lista(j.notas);
    const p = [];
    if (notas.length !== quantos) p.push(`"notas" precisa ter exatamente ${quantos} itens, um por caso, na ordem (veio ${notas.length})`);
    if (notas.some((n) => !Number.isFinite(Number(n?.nota)))) p.push('toda nota precisa ter "nota" numérica de 0 a 100');
    return p;
  },
};
