#!/bin/sh
# Singularize Orquestrador: instala o que falta na primeira vez, sobe o servidor e abre o navegador.
cd "$(dirname "$0")" || exit 1

# Atalhos de área de trabalho não carregam o perfil do terminal: procura o Node
# instalado por nvm, fnm, volta ou asdf antes de desistir.
achar_node() {
  command -v node >/dev/null 2>&1 && return 0
  for perfil in "$HOME/.nvm/nvm.sh" "${NVM_DIR:-}/nvm.sh"; do
    [ -s "$perfil" ] && . "$perfil" >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && return 0
  done
  for dir in "$HOME/.volta/bin" "$HOME/.asdf/shims" "$HOME/.local/share/fnm" "/opt/homebrew/bin" "/usr/local/bin"; do
    [ -x "$dir/node" ] && PATH="$dir:$PATH" && export PATH && return 0
  done
  if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)" && command -v node >/dev/null 2>&1 && return 0; fi
  ultimo=$(ls -d "$HOME"/.nvm/versions/node/v* 2>/dev/null | sort -V | tail -1)
  [ -n "$ultimo" ] && PATH="$ultimo/bin:$PATH" && export PATH && return 0
  return 1
}
achar_node
VERSAO=$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')
VERSAO=${VERSAO:-0}
if [ "$VERSAO" -lt 18 ]; then
  echo "O app precisa do Node.js 18 ou mais novo (encontrado: ${VERSAO}). https://nodejs.org"
  exit 1
fi

[ -f .env ] || cp .env.exemplo .env
if [ ! -d node_modules ]; then
  echo "Instalando dependências (só na primeira vez)…"
  npm install --no-audit --no-fund || exit 1
fi

exec node src/server.js --abrir
