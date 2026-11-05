#!/bin/sh
# Instalador do Singularize Orquestrador para Linux e macOS.
# Confere o Node.js, instala as dependências e cria o atalho no menu e na área de trabalho.
cd "$(dirname "$0")" || exit 1
RAIZ="$(pwd)"
NOME="Singularize Orquestrador"

printf '\n  \033[38;5;141m%s · instalação\033[0m\n\n' "$NOME"

# 1. Node.js 18+
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
  if [ "$VERSAO" -gt 0 ]; then echo "Seu Node.js é a versão $(node -v). O app precisa da 18 ou mais nova."; else echo "Node.js não encontrado."; fi
  if [ "$(uname)" = "Darwin" ]; then
    echo "  macOS com Homebrew:  brew install node"
  elif command -v apt-get >/dev/null 2>&1; then
    echo "  Ubuntu/Debian:  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
  elif command -v dnf >/dev/null 2>&1; then
    echo "  Fedora:  sudo dnf install nodejs"
  elif command -v pacman >/dev/null 2>&1; then
    echo "  Arch:  sudo pacman -S nodejs npm"
  fi
  echo "  Ou baixe em https://nodejs.org. Depois rode este instalador de novo."
  exit 1
fi
echo "Node.js $(node -v) ok"

# 2. Dependências e configuração
[ -f .env ] || cp .env.exemplo .env
echo "Instalando dependências (pode levar um minuto)…"
npm install --no-audit --no-fund || { echo "A instalação das dependências falhou. Veja as mensagens acima."; exit 1; }
chmod +x iniciar.sh bin/orq bin/orq.mjs 2>/dev/null

# 3. Atalhos
if [ "$(uname)" = "Darwin" ]; then
  ATALHO="$HOME/Desktop/$NOME.command"
  printf '#!/bin/sh\ncd "%s" && ./iniciar.sh\n' "$RAIZ" > "$ATALHO"
  chmod +x "$ATALHO"
  echo "Atalho criado na mesa: $NOME.command"
else
  DESKTOP_FILE="[Desktop Entry]
Type=Application
Name=$NOME
Comment=Orquestrador geral de IAs de terminal
Exec=\"$RAIZ/iniciar.sh\"
Path=$RAIZ
Icon=$RAIZ/instalador/icone.png
Terminal=true
Categories=Development;Utility;"
  mkdir -p "$HOME/.local/share/applications"
  printf '%s\n' "$DESKTOP_FILE" > "$HOME/.local/share/applications/singularize-orquestrador.desktop"
  chmod +x "$HOME/.local/share/applications/singularize-orquestrador.desktop"
  MESA=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
  if [ -d "$MESA" ]; then
    cp "$HOME/.local/share/applications/singularize-orquestrador.desktop" "$MESA/"
    chmod +x "$MESA/singularize-orquestrador.desktop"
    gio set "$MESA/singularize-orquestrador.desktop" metadata::trusted true 2>/dev/null || true
  fi
  echo "Atalho criado no menu de aplicativos${MESA:+ e na área de trabalho}."
fi

echo ""
echo "Pronto. Abra pelo atalho \"$NOME\" ou rode ./iniciar.sh nesta pasta."
echo "O terminal precisa ficar aberto enquanto você usa o app."
if [ -t 0 ]; then
  printf "Abrir agora? (S/n) "
  read -r RESPOSTA
  case "$RESPOSTA" in n|N) ;; *) exec ./iniciar.sh ;; esac
fi
