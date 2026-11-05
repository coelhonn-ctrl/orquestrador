// Agente de demonstração para a tela livre: um prompt que responde sozinho.
// Quando recebe uma mensagem [orq mN] de outro agente, responde de volta usando o próprio `orq`.
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nome = process.argv[2] ?? 'agente';
const orq = path.join(path.dirname(fileURLToPath(import.meta.url)), 'orq.mjs');
const roxo = (t) => `\x1b[38;5;141m${t}\x1b[0m`;
const cinza = (t) => `\x1b[2m${t}\x1b[0m`;

console.log(roxo(`● ${nome} (simulado)`) + cinza('  digite algo; mensagens de outros agentes chegam aqui'));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: roxo('› ') });
rl.prompt();

const rodarOrq = (args) =>
  new Promise((ok) => execFile(process.execPath, [orq, ...args], (erro, saida, stderr) => ok((saida || stderr || erro?.message || '').trim())));

rl.on('line', async (linha) => {
  const texto = linha.trim();
  if (!texto) return rl.prompt();
  const m = texto.match(/^\[orq (m\d+)\] (.+?) para .+?: (.+?)(?: \| |$)/);
  const deId = texto.match(/orq enviar (\S+) "\.\.\." --re/)?.[1];
  if (texto.startsWith('[orq] Você é')) {
    console.log(cinza('ok'));
  } else if (m && deId && !m[3].startsWith('Feito')) {
    console.log(cinza(`… trabalhando no pedido de ${m[2]}`));
    await new Promise((r) => setTimeout(r, 1500));
    const achados = await rodarOrq(['cerebro', m[3].split(' ').slice(0, 2).join(' ')]);
    console.log(cinza(achados.split('\n').slice(0, 2).join('\n')));
    console.log(await rodarOrq(['enviar', deId, `Feito: ${m[3].slice(0, 80)}`, '--re', m[1]]));
  } else if (m) {
    console.log(cinza(`recebido do ${m[2]}: ${m[3]}`));
  } else if (texto.startsWith('orq')) {
    console.log(await rodarOrq(texto.split(/\s+/).slice(1)));
  } else {
    console.log(cinza(`(simulado) entendi: ${texto}`));
  }
  rl.prompt();
});
