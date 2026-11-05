# Singularize Orquestrador

Orquestrador geral de IA. Você usa as ferramentas de terminal e assinaturas que já tem (Claude Code, Gemini CLI, Codex, Ollama, OpenCode, qualquer CLI) e decide como elas trabalham: num fluxo com gestor, ou soltas numa tela livre conversando entre si.

O app tem dois modos que se completam.

### 1. Solicitações: projeto → gestor → equipes → avaliador

```
você → fila → GESTOR (a própria API) → supervisores (um por equipe) → AVALIADOR → você aprova
                       │                         │
                       └──── nota da tarefa no cérebro (Obsidian) ────┘
```

- **Gestor**: recebe as solicitações, pega uma por vez da fila, entende o propósito do pedido e usa só as equipes que fazem sentido. Se nenhuma serve, cria uma equipe sob medida para o projeto. Às equipes passa só o caminho da nota da tarefa, não o contexto inteiro.
- **Equipes**: só gestor e avaliador vêm prontos. As outras nascem dos objetivos escolhidos no primeiro acesso (`objetivos` em `orq.config.json`), do gestor (sob medida, por projeto) ou de você. A IA principal e a reserva de cada uma saem sempre das IAs em uso. Cada uma roda numa IA de terminal; o resultado entra na nota e volta ao gestor como JSON.
- **Avaliador**: confere a entrega contra os critérios tirados do pedido e pode te perguntar coisas.
- **Modo por projeto**: **Automático** (o gestor decide e roda), **Com aprovação** (o gestor propõe o plano e espera você) ou **Manual** (sem gestor; você orquestra os agentes na tela livre).
- **Remanejamento**: cada equipe tem IA principal e reserva. Se uma falhar ou ficar sem cota, a etapa passa para a próxima que consiga fazer aquele trabalho.

### 2. Tela livre: agentes interativos que conversam entre si

- **Terminais reais**: cada agente é uma sessão de terminal persistente (PTY) com a IA que você escolher, exibida na tela. Você digita nele como no seu terminal.
- **Plano infinito**: arraste, redimensione, dê zoom. Crie vários agentes de uma vez, com o mesmo papel. Notas e rascunhos à mão livre ficam ao lado. Cada projeto tem seu espaço, mais um espaço Geral.
- **Fios**: arraste o círculo na borda de um agente até outro para ligar os dois. Só agentes ligados conversam, a não ser que você marque "Comunicação livre" no espaço.
- **Conversa objetiva**: os agentes falam pelo comando `orq`, que já vem no PATH deles. A mensagem tem até 600 caracteres, e o que for detalhe vai como caminho para o cérebro (`--ref`). O servidor confere se o caminho existe e só entrega quando o agente de destino está ocioso, digitando no terminal dele.
- **Operador no controle**: liga e desliga fios, inicia, para e reinicia agentes, troca a IA de cada um e manda mensagens pelo painel lateral.

### O cérebro (vault do Obsidian)

- `10-tarefas/`: uma nota por tarefa do gestor.
- `20-areas/`: o que funcionou de fato, por área (segurança, código, debug…), com subtópicos como `como-testar.md`.
- Gestor, equipes e agentes consultam o cérebro antes de começar e registram o que aprenderam como **rascunho**. Vira **validado** quando você aprova a entrega ou valida a nota.

### Também

- **Tela Cérebro**: o graph view do Obsidian dentro do app. Notas, links `[[...]]`, equipes como nós grandes e tarefas ligadas às equipes que trabalharam nelas; filtro por equipe e atualização ao vivo (`fs.watch` no vault).

- **Resumo de volta**: depois de 10 minutos sem você mexer no app, ao voltar aparece "Enquanto você estava fora". Mostra tarefas que terminaram ou travaram, mensagens entre agentes e agentes que trabalharam e pararam, com o trecho final da saída. O botão "Resumir com IA" usa o Ollama local se houver.
- **Headroom** (opcional): proxy local que comprime o contexto. Instala, liga e escolhe por IA na tela **IAs**.
- **Máquinas remotas (SSH)**: como o Remote-SSH do VS Code. Projetos e agentes rodam noutra máquina, com as IAs de lá; o `orq` dos agentes remotos chega ao app por túnel reverso.
- **Pasta de projetos**: escolhida no primeiro acesso (já vem sugerida), trocável a qualquer momento e por projeto.
- **Acesso pelo celular**, com token.

## Instalar

App de desktop para **Windows 10/11** e **Linux**, numa janela própria (Electron), sem terminal nem navegador e sem precisar de Node.js.

- **Windows**: `Singularize-Orquestrador-Setup-1.0.0.exe`. Instala só para o usuário, cria atalhos e aparece em Aplicativos para desinstalar.
- **Linux**: `Singularize-Orquestrador-1.0.0.AppImage`. Dê permissão de execução e abra.

No primeiro acesso o app pede a **pasta dos projetos** e depois mostra as IAs (Claude Code, Gemini CLI, Codex, Ollama) para você escolher. **Nada é instalado sozinho**: só as IAs marcadas que faltarem, depois que você confirma, num terminal visível dentro do app. Em seguida, **Entrar na conta** abre o login de cada uma.

Dados do app: `%APPDATA%\Singularize Orquestrador\dados` (Windows) ou `~/.config/Singularize Orquestrador/dados` (Linux), com um `.env` opcional (`ORQ_TOKEN`, `ORQ_HOST`, `ORQ_PORTA`…). Cérebro e projetos em `Documentos/Singularize/`.

O manual completo está em `MANUAL.md` e na página **Ajuda** do app.

### Rodar pelo código

Precisa do Node.js 18+. Os terminais usam `@lydell/node-pty`, que já traz binários prontos.

```bash
npm install
npm run app            # o app de desktop
npm start              # só o servidor, em http://127.0.0.1:4700
npm run simular        # tudo em modo de demonstração
npm run empacotar:win  # gera o instalador .exe em dist/
npm run empacotar:linux
```

## IAs e contas

Tela **IAs**. Qualquer CLI entra: escolha o tipo ou "Outro CLI" e informe comando e argumentos, com `{prompt}` onde vai a instrução e `{modelo}` para o modelo. Exemplos:

| Tipo | Comando padrão |
| --- | --- |
| Claude Code | `claude -p {prompt} --permission-mode acceptEdits` |
| Gemini CLI | `gemini -p {prompt}` |
| Codex CLI | `codex exec {prompt}` |
| Ollama | `ollama run {modelo} {prompt}` |

Para uma segunda conta da mesma ferramenta, cadastre outra IA do mesmo tipo com uma variável de ambiente diferente, por exemplo `CLAUDE_CONFIG_DIR=~/.claude-trabalho`. Os valores dessas variáveis ficam só no servidor.

Por padrão o Claude Code roda com `--permission-mode acceptEdits` (edita arquivos sem perguntar, mas pede para rodar comandos). Ajuste os argumentos se quiser mais ou menos autonomia.

## O comando `orq` (dentro dos agentes)

```bash
orq quem                                    # quem está ligado a mim
orq cerebro owasp refresh                   # procura skills e notas no cérebro
orq enviar codigo "Implementar refresh token conforme o checklist" --ref 20-areas/seguranca/checklist-owasp.md
orq enviar seguranca "Feito, testes passando" --re m12      # resposta a uma mensagem
orq aprender seguranca "Rotação de refresh token" "Rotacionar a cada uso; invalidar a família inteira ao detectar reuso."
orq ler 20-areas/seguranca/como-testar.md
```

Ao iniciar, o agente recebe um aviso curto explicando quem ele é, qual a área dele no cérebro e esses comandos. Dá para desligar em "Editar" no agente.

Limites para manter a conversa útil e barata:
- até 600 caracteres por mensagem e 5 referências;
- 6 mensagens por minuto por agente;
- 12 respostas encadeadas, depois disso o operador precisa intervir.

No Claude Code, o modo interativo já vem com `--allowedTools "Bash(orq:*)"`, para o `orq` rodar sem pedir permissão a cada vez. O resto continua pedindo como de costume. Os argumentos de cada IA no modo interativo ficam editáveis em **IAs → Configurar**.

## Headroom

Tela **IAs → Headroom**:

1. **Instalar Headroom**: tenta `uv tool install`, depois `pipx`, depois um ambiente Python só do app em `.headroom/`. A versão padrão é `headroom-ai[proxy]`; marque "Versão completa" para `headroom-ai[all]`, que inclui o modelo de compressão de texto (PyTorch, vários GB).
2. **Usar Headroom**: o app sobe `headroom proxy --port 8787` e derruba quando você desliga.
3. **Passar pelo Headroom**: escolha quais IAs usam o proxy. O app injeta `ANTHROPIC_BASE_URL` e `OPENAI_BASE_URL` só nelas. Gemini CLI e Ollama seguem direto.
4. **Ver economia** mostra o `headroom savings`.

Se o proxy cair, as IAs voltam a ir direto ao provedor na etapa seguinte.

## Worktrees

Marque "Cada tarefa num worktree separado" ao criar o projeto (só repositórios git). A tarefa roda em `../.orq-worktrees/<projeto>/T-xxx` na branch `orq/T-xxx`, e o merge fica com você depois de aprovar.

## Acesso remoto

Defina `ORQ_TOKEN` e `ORQ_HOST=0.0.0.0` (ou o IP do Tailscale) no `.env` da pasta de dados e reinicie o app. Abra `http://<ip>:4700/?token=SEU_TOKEN` no celular uma vez; o token fica salvo no navegador. A tela se adapta ao celular.

## Máquinas remotas

Tela **Máquinas**: destino `usuario@host` ou um Host do `~/.ssh/config`. Usa o OpenSSH do sistema (`BatchMode` para as equipes, `-t` para os agentes interativos). **Acesso sem senha** gera a chave se faltar e a autoriza na máquina num terminal do app. Os prompts vão por stdin; o `orq` é copiado para `~/.singularize/bin` lá e fala com o app por `ssh -R`. Precisa de Node.js 18+ na máquina remota só para o `orq`.

## Postgres e Redis

```bash
docker compose up -d
# no .env:
DATABASE_URL=postgres://orq:orq@127.0.0.1:5433/orq
REDIS_URL=redis://127.0.0.1:6380
```

Sem eles, tudo fica em `data/estado.json` e os eventos ficam em memória. Com Redis, os eventos também passam pelo canal `orq:eventos`.

## Estrutura

```
src/server.js        API HTTP + WebSocket (/eventos)
src/gestor.js        fila, planejamento, execução das etapas, perguntas, aprovação
src/adaptadores.js   como cada CLI é chamada; modo simulado
src/prompts.js       prompts curtos do gestor, supervisores e avaliador
src/vault.js         notas no formato Obsidian
src/headroom.js      instalação e proxy do Headroom
src/agentes.js       agentes em PTY (locais e por SSH), entrega de mensagens, aviso inicial
src/maquinas.js      SSH: teste, execução remota, chave, terminal
src/instalacao-ias.js instalação e login das IAs, só quando o usuário confirma
desktop/             app Electron, preload e empacotamento
src/cerebro.js       busca, leitura, registro e grafo do vault
src/equipes.js       equipes por objetivo e IAs das equipes
public/cerebro.js    tela Cérebro (grafo)
src/atividade.js     registro para o resumo de volta
src/rotas-agentes.js API da tela livre, mensagens, cérebro e resumo
bin/orq              comando que os agentes usam
public/canvas.js     tela livre (xterm.js, fios, notas, rascunhos)
src/store/           arquivo JSON ou Postgres
public/              front sem build, só por eventos
```

Se o servidor reiniciar, as tarefas voltam de onde pararam.
