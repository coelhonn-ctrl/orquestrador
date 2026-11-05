// As CLIs devolvem texto livre; o contrato é que a última coisa seja um objeto JSON.
// Procuramos primeiro um bloco ```json, depois o último objeto balanceado que faça parse.

const tentar = (texto) => {
  try {
    const valor = JSON.parse(texto);
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null;
  } catch {
    return null;
  }
};

const objetosBalanceados = (texto) => {
  const achados = [];
  for (let inicio = texto.indexOf('{'); inicio !== -1; inicio = texto.indexOf('{', inicio + 1)) {
    let profundidade = 0;
    let emString = false;
    let escape = false;
    for (let i = inicio; i < texto.length; i++) {
      const c = texto[i];
      if (emString) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') emString = false;
        continue;
      }
      if (c === '"') emString = true;
      else if (c === '{') profundidade++;
      else if (c === '}' && --profundidade === 0) {
        achados.push(texto.slice(inicio, i + 1));
        break;
      }
    }
  }
  return achados;
};

export const extrairJSON = (texto) => {
  if (!texto) return null;
  const blocos = [...texto.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const bloco of blocos.reverse()) {
    const valor = tentar(bloco.trim());
    if (valor) return desembrulhar(valor);
  }
  const candidatos = objetosBalanceados(texto).sort((a, b) => b.length - a.length);
  for (const candidato of candidatos) {
    const valor = tentar(candidato);
    if (valor) return desembrulhar(valor);
  }
  return null;
};

// `claude -p --output-format json` embrulha a resposta em { result: "..." }.
const desembrulhar = (valor) => {
  if (typeof valor.result === 'string' && !('status' in valor) && !('etapas' in valor)) {
    return extrairJSON(valor.result) ?? valor;
  }
  return valor;
};
