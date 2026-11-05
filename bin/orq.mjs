#!/usr/bin/env node
// CLI que os agentes usam de dentro do terminal para falar com o orquestrador.
// Vem configurado pelas variáveis ORQ_URL, ORQ_TOKEN e ORQ_AGENTE, injetadas ao abrir o agente.

const url = process.env.ORQ_URL ?? 'http://127.0.0.1:4700';
const token = process.env.ORQ_TOKEN ?? '';
const eu = process.env.ORQ_AGENTE ?? 'operador';

const AJUDA = `orq: fale com o Singularize Orquestrador

  orq quem                                   agentes ligados a você
  orq enviar <agente> "objetivo" [--ref caminho.md]... [--re mN]
                                             pede algo a outro agente (até 600 caracteres)
  orq cerebro [termos]                       procura skills e notas no cérebro (vault)
  orq ler <caminho.md>                       mostra uma nota do cérebro
  orq aprender <area> "titulo" "texto"       registra no cérebro o que funcionou (rascunho)
  orq areas                                  lista as áreas do cérebro

Seja objetivo. Detalhes vão numa nota do cérebro; na mensagem vai só o caminho.`;

const chamar = async (metodo, caminho, corpo) => {
  let r;
  try {
    r = await fetch(url + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-orq-token': token, 'x-orq-agente': eu },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (e) {
    console.error(`orq: não consegui falar com o orquestrador em ${url} (${e.message})`);
    process.exit(2);
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`orq: ${dados.erro ?? `erro ${r.status}`}`);
    process.exit(1);
  }
  return dados;
};

// Separa --ref/--re dos argumentos posicionais.
const separar = (args) => {
  const pos = [];
  const refs = [];
  let re = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ref' && args[i + 1]) refs.push(args[++i]);
    else if (args[i] === '--re' && args[i + 1]) re = args[++i];
    else pos.push(args[i]);
  }
  return { pos, refs, re };
};

const [comando, ...resto] = process.argv.slice(2);

switch (comando) {
  case 'quem': {
    const { livre, agentes } = await chamar('GET', `/api/agentes/${encodeURIComponent(eu)}/conexoes`);
    if (!agentes.length) console.log('Ninguém ligado a você. O operador liga agentes na tela livre.');
    for (const a of agentes) console.log(`${a.id}\t${a.nome}${a.papel ? ` — ${a.papel}` : ''}${a.area ? ` [área ${a.area}]` : ''}${a.rodando ? '' : ' (parado)'}`);
    if (livre) console.log('(comunicação livre neste espaço)');
    break;
  }
  case 'enviar': {
    const { pos, refs, re } = separar(resto);
    const [para, ...partes] = pos;
    if (!para || !partes.length) {
      console.error('uso: orq enviar <agente> "objetivo" [--ref caminho.md] [--re mN]');
      process.exit(1);
    }
    const m = await chamar('POST', '/api/mensagens', { de: eu, para, objetivo: partes.join(' '), refs, re });
    console.log(`enviada ${m.id} para ${m.paraNome}${m.estado === 'aguardando-agente' ? ' (agente parado; entrega quando ele iniciar)' : ''}`);
    break;
  }
  case 'cerebro': {
    const { itens } = await chamar('GET', `/api/cerebro?q=${encodeURIComponent(resto.join(' '))}`);
    if (!itens.length) console.log('Nada encontrado. Se você resolver isso, registre com: orq aprender <area> "titulo" "texto"');
    for (const i of itens) console.log(`${i.caminho}${i.estado ? ` (${i.estado})` : ''}\n    ${i.titulo}${i.resumo ? ` — ${i.resumo}` : ''}`);
    break;
  }
  case 'ler': {
    if (!resto[0]) {
      console.error('uso: orq ler <caminho.md>');
      process.exit(1);
    }
    const { conteudo, absoluto } = await chamar('GET', `/api/cerebro/nota?caminho=${encodeURIComponent(resto[0])}`);
    console.log(`# ${absoluto}\n${conteudo}`);
    break;
  }
  case 'aprender': {
    const [area, titulo, ...texto] = resto;
    if (!area || !titulo || !texto.length) {
      console.error('uso: orq aprender <area> "titulo" "texto"');
      process.exit(1);
    }
    const r = await chamar('POST', '/api/cerebro/aprender', { area, titulo, texto: texto.join(' ') });
    console.log(`registrado em ${r.caminho} (rascunho até o operador validar)`);
    break;
  }
  case 'areas': {
    const { areas } = await chamar('GET', '/api/cerebro/areas');
    console.log(areas.join('\n') || 'Nenhuma área ainda.');
    break;
  }
  default:
    console.log(AJUDA);
}
