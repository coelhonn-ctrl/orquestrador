import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const git = (cwd, args) =>
  new Promise((resolve, reject) =>
    execFile('git', ['-C', cwd, ...args], (erro, saida, stderr) => (erro ? reject(new Error(stderr.trim() || erro.message)) : resolve(saida.trim()))),
  );

// Cada tarefa ganha um worktree próprio quando o projeto é um repositório git e a opção está ligada.
// Assim duas tarefas não pisam uma na outra e o merge fica com você.
export const prepararWorktree = async (projeto, tarefa, avisar) => {
  if (!projeto?.pasta) return { cwd: null };
  if (!projeto.worktrees) return { cwd: projeto.pasta };
  try {
    await git(projeto.pasta, ['rev-parse', '--is-inside-work-tree']);
    const branch = `orq/${tarefa.id}`;
    const destino = path.join(path.dirname(projeto.pasta), '.orq-worktrees', path.basename(projeto.pasta), tarefa.id);
    if (!fs.existsSync(destino)) {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      await git(projeto.pasta, ['worktree', 'add', '-b', branch, destino]);
    }
    return { cwd: destino, branch };
  } catch (erro) {
    avisar(`Worktree não criado (${erro.message}). A tarefa roda na pasta do projeto.`);
    return { cwd: projeto.pasta };
  }
};
