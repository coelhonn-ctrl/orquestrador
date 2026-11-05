import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Um app aberto pelo atalho (ou recém-instalado) não enxerga o PATH completo do usuário:
// no Windows o PATH só é relido ao abrir um processo novo, e no Linux/macOS o atalho não carrega
// o perfil do shell. Aqui juntamos o PATH atual com o do registro / shell de login e com as
// pastas onde os instaladores das IAs costumam colocar os comandos.

const chavePath = () => Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';

const pastasConhecidas = () => {
  const casa = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(casa, '.local', 'bin'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs'),
    ].filter(Boolean);
  }
  return [path.join(casa, '.local', 'bin'), path.join(casa, '.npm-global', 'bin'), path.join(casa, '.volta', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
};

const pathDoSistema = () => {
  try {
    if (process.platform === 'win32') {
      return execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
        { encoding: 'utf8', timeout: 8000, windowsHide: true },
      ).trim();
    }
    const shell = process.env.SHELL || '/bin/sh';
    return execFileSync(shell, ['-ilc', 'printf "%s" "$PATH"'], { encoding: 'utf8', timeout: 8000 }).trim().split('\n').pop();
  } catch {
    return '';
  }
};

export const atualizarPath = () => {
  const chave = chavePath();
  const atual = (process.env[chave] ?? '').split(path.delimiter);
  const novo = [...atual, ...pathDoSistema().split(path.delimiter), ...pastasConhecidas()].filter(Boolean);
  process.env[chave] = [...new Set(novo)].join(path.delimiter);
};
