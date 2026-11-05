// Ponte mínima entre a interface e o sistema: seletor de pastas e mostrar um arquivo na pasta.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('singularize', {
  desktop: true,
  escolherPasta: (inicial) => ipcRenderer.invoke('escolher-pasta', inicial),
  mostrarArquivo: (caminho) => ipcRenderer.invoke('mostrar-arquivo', caminho),
});
