import fs from 'node:fs';
import path from 'node:path';

const COLECOES = ['projetos', 'equipes', 'ias', 'tarefas', 'ajustes', 'agentes', 'mensagens', 'canvas', 'maquinas', 'treinos'];
const clonar = (v) => structuredClone(v);

// Armazenamento em arquivo JSON. Sem dependências, bom para começar e para um só usuário.
export const criarStoreMemoria = async (diretorio) => {
  fs.mkdirSync(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'estado.json');
  const vazio = () => ({ ...Object.fromEntries(COLECOES.map((c) => [c, {}])), sequencias: {} });
  let dados = vazio();
  // Se o arquivo estiver danificado (queda de energia, disco cheio), usa a cópia da última abertura
  // e guarda o danificado à parte, em vez de começar do zero.
  const anterior = path.join(diretorio, 'estado.anterior.json');
  const lerArquivo = (f) => ({ ...vazio(), ...JSON.parse(fs.readFileSync(f, 'utf8')) });
  if (fs.existsSync(arquivo)) {
    try {
      dados = lerArquivo(arquivo);
      fs.copyFileSync(arquivo, anterior);
    } catch (e) {
      const danificado = path.join(diretorio, `estado.danificado-${Date.now()}.json`);
      fs.copyFileSync(arquivo, danificado);
      console.error(`[store] estado.json danificado (${e.message}). Guardado em ${danificado}.`);
      if (fs.existsSync(anterior)) {
        dados = lerArquivo(anterior);
        console.error('[store] Usando a cópia da última abertura (estado.anterior.json).');
      }
    }
  }

  let timer = null;
  const gravarAgora = () => {
    clearTimeout(timer);
    timer = null;
    fs.writeFileSync(`${arquivo}.tmp`, JSON.stringify(dados, null, 1));
    fs.renameSync(`${arquivo}.tmp`, arquivo);
  };
  const agendar = () => {
    clearTimeout(timer);
    timer = setTimeout(gravarAgora, 150);
  };

  const colecao = (nome) => {
    if (!COLECOES.includes(nome)) throw new Error(`Coleção desconhecida: ${nome}`);
    return dados[nome];
  };

  return {
    tipo: 'arquivo',
    listar: async (nome) => Object.values(colecao(nome)).map(clonar),
    obter: async (nome, id) => (colecao(nome)[id] ? clonar(colecao(nome)[id]) : null),
    salvar: async (nome, obj) => {
      colecao(nome)[obj.id] = clonar(obj);
      agendar();
      return obj;
    },
    remover: async (nome, id) => {
      delete colecao(nome)[id];
      agendar();
    },
    proximaSequencia: async (nome) => {
      dados.sequencias[nome] = (dados.sequencias[nome] ?? 0) + 1;
      agendar();
      return dados.sequencias[nome];
    },
    fechar: async () => {
      if (timer) gravarAgora();
    },
  };
};
