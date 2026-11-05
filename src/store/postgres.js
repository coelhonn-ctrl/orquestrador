import fs from 'node:fs';
import path from 'node:path';

const COLECOES = ['projetos', 'equipes', 'ias', 'tarefas', 'ajustes', 'agentes', 'mensagens', 'canvas', 'maquinas', 'treinos'];

const tabela = (nome) => {
  if (!COLECOES.includes(nome)) throw new Error(`Coleção desconhecida: ${nome}`);
  return `orq_${nome}`;
};

export const criarStorePostgres = async (url, raiz) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  const schema = fs.readFileSync(path.join(raiz, 'sql', '001_schema.sql'), 'utf8');
  await pool.query(schema);

  return {
    tipo: 'postgres',
    listar: async (nome) => {
      const { rows } = await pool.query(`select dados from ${tabela(nome)} order by criado`);
      return rows.map((r) => r.dados);
    },
    obter: async (nome, id) => {
      const { rows } = await pool.query(`select dados from ${tabela(nome)} where id = $1`, [id]);
      return rows[0]?.dados ?? null;
    },
    salvar: async (nome, obj) => {
      await pool.query(
        `insert into ${tabela(nome)} (id, dados) values ($1, $2)
         on conflict (id) do update set dados = excluded.dados, atualizado = now()`,
        [obj.id, obj],
      );
      return obj;
    },
    remover: async (nome, id) => {
      await pool.query(`delete from ${tabela(nome)} where id = $1`, [id]);
    },
    proximaSequencia: async (nome) => {
      const { rows } = await pool.query(
        `insert into orq_sequencias (nome, valor) values ($1, 1)
         on conflict (nome) do update set valor = orq_sequencias.valor + 1
         returning valor`,
        [nome],
      );
      return Number(rows[0].valor);
    },
    fechar: () => pool.end(),
  };
};
