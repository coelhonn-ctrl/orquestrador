// Biblioteca do grafo 3D (3d-force-graph), carregada uma vez só, quando uma tela pede o modo 3D.
let carregando = null;

export const carregar3D = () =>
  (carregando ??= new Promise((ok, falha) => {
    if (window.ForceGraph3D) return ok(window.ForceGraph3D);
    const s = document.createElement('script');
    s.src = '/vendor/3d/3d-force-graph.min.js';
    s.onload = () => ok(window.ForceGraph3D);
    s.onerror = () => {
      carregando = null;
      falha(new Error('não carregou a biblioteca do grafo 3D'));
    };
    document.head.appendChild(s);
  }));

// Escolha 2D/3D de cada tela, lembrada neste navegador.
export const lerModo = (chave, padrao, validos = ['2d', '3d']) => {
  try {
    const v = localStorage.getItem(chave);
    return validos.includes(v) ? v : padrao;
  } catch {
    return padrao;
  }
};
export const gravarModo = (chave, v) => {
  try {
    localStorage.setItem(chave, v);
  } catch {}
};

// Botões "2D | 3D" (ou outros modos) para o topo das telas de grafo.
const NOME_MODO = { '2d': '2D', '3d': '3D', nucleo: 'Universo' };
export const botoesModo = (modo, atributo, modos = ['2d', '3d']) =>
  `<div class="modo-grafo" role="radiogroup" aria-label="Visualização">${modos
    .map((m) => `<button type="button" role="radio" aria-checked="${modo === m}" ${atributo}="${m}">${NOME_MODO[m] ?? m}</button>`)
    .join('')}</div>`;
