# Manual do Singularize Orquestrador

O Singularize Orquestrador coloca várias IAs de terminal para trabalhar juntas, usando os logins e assinaturas que você já tem. Nada é cobrado à parte: ele chama o Claude Code, o Antigravity (Google), o Codex, o Ollama ou qualquer outra ferramenta que rode no terminal da sua máquina.

## O que é o app

Você pode trabalhar de dois jeitos, no mesmo app.

- **Solicitações**: você descreve o resultado que quer. O **gestor** divide o trabalho entre as **equipes** (Pesquisa, Segurança, Código…), o **avaliador** confere a entrega e você aprova ou devolve. Bom para tarefas completas que você quer receber prontas.
- **Tela livre**: você monta os **agentes**, cada um um terminal real com a IA que escolher, e liga com um fio quem pode conversar com quem. Você acompanha e interfere em cada terminal. Bom para trabalho exploratório ou quando você quer controle total.

Os dois modos usam o mesmo **cérebro**: um vault do Obsidian onde fica o que já funcionou. As IAs consultam o cérebro antes de começar e registram o que aprenderam, então o time fica mais esperto a cada tarefa.

> Regra de ouro: as mensagens entre IAs são curtas. O detalhe mora no cérebro, e a mensagem só aponta o caminho da nota. Isso economiza cota e evita que uma IA confunda a outra.

## Instalação e primeiro acesso

O Singularize Orquestrador é um app de desktop: abre numa janela própria, sem terminal e sem navegador. Roda no **Windows 10/11** e no **Linux**. Não precisa instalar o Node.js para usar o app.

**Windows**

1. Dois cliques em `Singularize-Orquestrador-Setup-1.0.0.exe`.
2. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e depois em **Executar assim mesmo** (o instalador ainda não é assinado).
3. Siga o instalador. Ele instala só para o seu usuário, sem pedir senha de administrador, e cria atalhos na área de trabalho e no menu Iniciar.
4. Para desinstalar: **Configurações → Aplicativos → Singularize Orquestrador → Desinstalar**.

**Linux**

1. Baixe `Singularize-Orquestrador-1.0.0.AppImage`.
2. Dê permissão de execução: botão direito → **Propriedades → Permitir executar como programa**, ou no terminal `chmod +x Singularize-Orquestrador-1.0.0.AppImage`.
3. Dois cliques no arquivo para abrir.

Feche a janela do app para encerrar. Se houver equipes ou agentes trabalhando, ele pergunta antes de fechar. Abrir o atalho de novo com o app já aberto só traz a janela para a frente.

### Primeira vez: três passos

Na primeira vez, o app pergunta três coisas antes de começar.

**Passo 1: onde ficam seus projetos.** O app já sugere uma pasta (`Documentos/Singularize/projetos`). Clique em **Continuar** para aceitar ou em **Escolher outra pasta** para indicar outra. Cada projeto novo ganha uma subpasta ali, com o nome dele. Você pode trocar essa pasta depois em **Máquinas → Este computador → Trocar pasta padrão**, e qualquer projeto pode usar outra pasta.

**Passo 2: para que você vai usar o app.** Marque seus objetivos (Desenvolver software, Pesquisa e estudo, Escrita e conteúdo, Dados e planilhas, Marketing e vendas…). O app cria só as equipes desses objetivos; cada cartão mostra quais. Se preferir, clique em **Pular esta etapa**: nenhuma equipe é criada, e o gestor monta as equipes conforme os pedidos chegam (veja Equipes, mais abaixo).

**Passo 3: quais IAs usar.** Aparecem o Claude Code, o Antigravity (Google), o Codex, o Gemini CLI e o Ollama, cada um marcado como **Instalada neste computador** ou **Não instalada**. O app **nunca instala nada sozinho**:

1. Marque as IAs que quer usar e clique em **Continuar**.
2. Se alguma marcada não estiver instalada, a tela **Antes de instalar** mostra o que será instalado e o comando de cada uma. Clique em **Instalar e continuar** só se concordar, ou em **Voltar**.
3. Cada instalação abre num terminal dentro do app. Se pedir senha ou confirmação, responda nele.
4. Com a IA instalada, clique em **Entrar na conta** ao lado dela. É o login normal da ferramenta: o app usa a conta que você já tem, sem custo à parte. No Claude Code, se aparecer "Accessing workspace… Do you trust this folder?", escolha **Yes, I trust this folder**; quando aparecer a caixa de digitar, o login está feito e você pode digitar `/exit`.

> Para usar o Google com a sua conta pessoal, escolha o **Antigravity**. Em 18/06/2026 o Google parou de aceitar contas pessoais no Gemini CLI e o substituiu pelo Antigravity CLI; o Gemini CLI agora só funciona com chave de API paga.
5. Clique em **Ir para o app**.

Para só conhecer o app sem nenhuma IA real, marque **Modo demonstração**.

Na tela inicial aparece o guia **Primeiros passos**, com três etapas que se marcam sozinhas: escolher as IAs, criar um projeto e escolher como trabalhar.

Se você já usava uma versão anterior, o app pergunta os objetivos uma vez ao abrir. As equipes antigas que vinham prontas e não combinam com o que você marcou saem da lista (as que estão no meio de uma tarefa ficam). Em qualquer tela, passe o mouse (ou use Tab) nos círculos **?** para ler o que cada opção faz. Este manual fica em **Ajuda**, no menu do topo.

### Onde ficam seus dados

| O quê | Windows | Linux |
| --- | --- | --- |
| Projetos (padrão) | `Documentos\Singularize\projetos` | `~/Documentos/Singularize/projetos` (ou `~/Documents/…`) |
| Cérebro (vault do Obsidian) | `Documentos\Singularize\cerebro` | `~/Documentos/Singularize/cerebro` (ou `~/Documents/…`) |
| Configuração e histórico | `%APPDATA%\Singularize Orquestrador\dados` | `~/.config/Singularize Orquestrador/dados` |

Desinstalar o app não apaga o cérebro nem os projetos.

### Atualizar sem perder nada

Para atualizar, feche o app e rode o instalador da versão nova. Ele troca só o programa: equipes, treinos, agentes, tela livre, projetos, tarefas, IAs e o cérebro continuam onde estão. Se o app estiver aberto, o instalador fecha ele antes.

Para mais segurança:

- **Backup automático:** toda vez que uma versão nova abre pela primeira vez, o app guarda um backup de como estava antes. Ficam os 8 mais recentes.
- **Arquivo danificado:** se o arquivo de dados se danificar (queda de energia, disco cheio), o app abre com a cópia da última vez que abriu e guarda o danificado à parte.

### Backup, exportar e importar

Em **Ajuda → Backup e atualização**:

- **Exportar:** marque o que levar (equipes e treinos, agentes e tela livre, projetos e tarefas, IAs e máquinas, ajustes e o cérebro) e clique em **Exportar**. O arquivo vai para `Documentos/Singularize/backups`. As chaves e senhas das IAs só entram se você marcar essa opção; nesse caso, não compartilhe o arquivo.
- **Importar:** escolha um arquivo de backup. O app mostra o que tem nele e você escolhe:
    - **Juntar** (recomendado): acrescenta o que falta e atualiza o que tem o mesmo nome, sem apagar nada daqui.
    - **Substituir**: deixa tudo exatamente como no arquivo.
  Antes de importar, o app guarda o estado atual num backup automático.
- **Backups automáticos:** a lista com data e hora, com **Restaurar** e **Mostrar na pasta**.

Para levar tudo para outro computador: exporte aqui, instale o app lá, abra **Backup e atualização** e importe o arquivo.

## Conectar as IAs

Na tela **IAs** ficam todas as ferramentas que o app pode usar, marcadas como **pronta** ou **não encontrada**.

| IA | O que precisa | Lê e edita arquivos |
| --- | --- | --- |
| Claude Code | Conta Claude (assinatura Pro ou Max) | Sim |
| Antigravity CLI | Conta Google (tem plano gratuito) | Sim |
| Gemini CLI | Só chave de API paga do Gemini (desde 18/06/2026 não aceita conta pessoal) | Sim |
| Codex CLI | Conta do ChatGPT | Sim |
| Ollama | Um modelo baixado; roda no seu computador, sem internet | Não, só conversa |
| Terminal | Nada, é o shell da máquina | Sim (só na tela livre) |
| Outro CLI | O comando e os argumentos | Você define |

- **Escolher IAs**: volta à escolha do primeiro acesso, para marcar ou desmarcar IAs.
- **Instalar**: aparece numa IA que não está instalada. Mostra o comando e só instala se você confirmar.
- **Entrar na conta**: abre o login da ferramenta num terminal dentro do app (no Ollama, baixa o modelo).
- **Procurar de novo neste computador**: use se você instalou uma IA por fora.
- **Usar**: desmarcado, o gestor para de mandar trabalho para aquela IA.
- **Testar**: manda um pedido curto e mostra se ela respondeu.
- **Configurar**: comando, modelo, argumentos e variáveis de ambiente.

Para usar **duas contas** da mesma ferramenta, cadastre outra IA do mesmo tipo e, em variáveis de ambiente, aponte para outra pasta de configuração (por exemplo `CLAUDE_CONFIG_DIR=~/.claude-trabalho`). As variáveis ficam só no app e aparecem como `••••` na tela.

Com o **Modo demonstração** ligado e nenhuma IA real pronta, uma faixa amarela avisa que as respostas são de exemplo.

## Projetos e solicitações

Uma solicitação passa por fila, gestor, equipes e avaliador até chegar a você para aprovar.

### Criar um projeto

Em **Solicitações**, clique em **Criar projeto** e preencha:

- **Nome do projeto**.
- **Pasta do projeto**: já vem preenchida dentro da sua pasta de projetos, seguindo o nome. Para usar outra, edite o caminho ou clique em **Escolher…**. Se a pasta não existir, ela é criada.
- **Onde fica**: **Este computador** ou uma máquina remota por SSH (veja Máquinas remotas, mais abaixo).
- **Como este projeto trabalha?**: o modo do projeto, explicado abaixo.
- **Quais IAs este projeto pode usar**: sem marcar nenhuma, vale qualquer IA ligada. Se todas as marcadas forem desligadas em **IAs**, o projeto não trava: usa as outras IAs ligadas.
- **Cada tarefa num worktree separado** (só para repositórios git neste computador): cada tarefa vira a branch `orq/T-001`, `orq/T-002`… numa pasta à parte. O merge fica com você.

Os botões no topo trocam o projeto em foco. Com um projeto em foco, **Configurar projeto** muda qualquer uma dessas opções, inclusive o modo.

### Os três modos de projeto

Cada projeto escolhe quanto o gestor decide sozinho.

| Modo | Como funciona | Bom para |
| --- | --- | --- |
| **Automático** | O gestor entende o propósito do pedido, usa só as equipes que fazem sentido e cria equipes sob medida quando falta alguma. Roda sem te perguntar. | Tarefas que você quer receber prontas. |
| **Com aprovação** | O gestor monta o plano (e as equipes novas, se precisar) e para. Você vê o plano e clica em **Aprovar plano** ou em **Refazer**, dizendo o que mudar. | Quando você quer conferir o caminho antes de gastar cota. |
| **Manual** | Sem gestor e sem fila. Você monta e orquestra os agentes na tela livre do projeto. | Trabalho exploratório, controle total. |

O gestor escolhe as equipes pelo **propósito** do pedido. Uma pesquisa sobre países, por exemplo, vai só para Pesquisa e para o avaliador. Equipes de código, segurança ou código limpo só entram quando o pedido envolve código. Se nenhuma equipe existente serve (um texto, uma planilha, um roteiro), o gestor cria uma equipe sob medida, como **Redação**, que fica marcada como **criada pelo gestor** e vale só para aquele projeto.

### Mandar uma tarefa

1. Em **Nova tarefa**, descreva o **resultado** que você quer, como explicaria para alguém da equipe. Não precisa dizer os passos.
2. Anexe prints ou fotos se ajudar (botão **Anexar fotos**, ou cole a imagem direto no campo).
3. Clique em **Colocar na fila** (ou `Ctrl+Enter`).

Num projeto **Manual**, o campo de tarefa dá lugar a um atalho para a tela livre do projeto.

### Acompanhar

- **Esquerda**: o que está **em andamento**, com uma barrinha por etapa, e o que está **pronto para revisar**.
- **Direita**: o passo a passo da tarefa selecionada, com a equipe e a IA de cada etapa.
- **Embaixo**: **Próximas na fila**. Arraste ou use as setas para mudar a ordem. O gestor sempre pega a primeira.

Quando uma equipe, o avaliador ou um plano para aprovar precisa de você, aparece uma pergunta em amarelo no meio da tela. Clique numa opção ou escreva a resposta, e a tarefa continua.

**Falar com uma equipe** manda uma pergunta ou ajuste rápido direto para uma equipe, sem passar pela fila.

### Revisar a entrega

Abra a tarefa em **Prontas para revisar**. A página mostra o pedido, o que cada equipe fez, o que o avaliador conferiu e a nota completa da tarefa no cérebro.

- **Aprovar entrega**: conclui a tarefa e valida no cérebro o que as equipes aprenderam.
- **Devolver para as equipes**: escreva o que precisa mudar. A tarefa volta ao topo da fila e o gestor refaz o plano com o seu comentário.
- **Tentar de novo de onde parou**: aparece quando uma equipe falhou.

## Equipes

As equipes são quem o gestor chama nas solicitações. O app não traz equipes prontas além de duas que fazem parte de toda tarefa: o **Gestor**, que entende o pedido e divide o trabalho, e o **Avaliador**, que confere a entrega. As outras nascem de três jeitos:

1. **Pelos seus objetivos**: no primeiro acesso, ou depois em **Equipes → Adicionar por objetivo**.
2. **Pelo gestor**: num projeto **Automático**, quando um pedido precisa de uma equipe que não existe, o gestor cria uma sob medida. No **Com aprovação**, ele propõe e você aprova junto com o plano.
3. **Por você**: em **Nova equipe**, no fim da página.

| Objetivo | Equipes criadas |
| --- | --- |
| Desenvolver software | Código, Debug, Código limpo |
| Segurança de sistemas | Segurança |
| Pesquisa e estudo | Pesquisa |
| Escrita e conteúdo | Redação, Revisão de texto |
| Dados e planilhas | Dados |
| Marketing e vendas | Marketing |
| Planejamento e organização | Planejamento |
| Automação e servidores | Infra e automação |

Cada equipe tem uma **IA principal** e uma **reserva**, sempre escolhidas entre as IAs que você marcou para usar. Se você usa só o Gemini, todas as equipes ficam com o Gemini e sem reserva. Se ligar ou desligar uma IA em **IAs**, as equipes que dependiam dela são ajustadas sozinhas; as escolhas que você fez e continuam valendo não mudam. Equipes criadas pelo gestor para um projeto respeitam também as IAs que aquele projeto permite.

- **IA principal** e **Reserva**: se a principal falhar ou ficar sem cota, a reserva assume. Se a reserva também falhar, o gestor tenta qualquer outra IA em uso que consiga fazer aquele trabalho.
- **Pedir minha aprovação**: antes de cada etapa dessa equipe, a tarefa para e espera você **Liberar** ou **Pular**.
- **Ativa**: desligada, o gestor deixa de usar a equipe.
- **Detalhes**: descrição, agentes internos, instruções fixas da equipe e **Precisa editar arquivos** (assim ela só recebe IAs que alteram o projeto).

Equipes **criadas pelo gestor** aparecem com o nome do projeto para o qual foram criadas. Você pode editar, desligar ou remover como qualquer outra. Toda equipe ganha uma área própria no cérebro.

Em **Acompanhar equipes** você vê a saída de cada equipe enquanto trabalha e pode escrever direto para ela.

## Famílias e treino de equipes

### Famílias

Uma família agrupa equipes do mesmo assunto, e cada equipe continua independente. Exemplo: a família **Segurança** pode ter *Segurança web* (OWASP, APIs, login), *Segurança de eventos* (balada, portaria, lotação) e uma *Segurança* geral.

- Em **Equipes**, as equipes aparecem agrupadas por família. **+ Nova especialização** cria uma equipe nova já dentro daquela família.
- Em cada equipe, em **Detalhes**, preencha **Família**, **Foco / especialidade** e **Contextos** (palavras de quando usar, separadas por vírgula).
- O gestor lê família, foco e contextos e escolhe a equipe **mais específica** para cada parte do pedido. A geral da família só entra quando nenhuma especializada serve, e ele pode usar mais de uma da mesma família.
- No **Cérebro**, equipes da mesma família ficam com a mesma cor.

### Treinar uma equipe

Treinar deixa uma equipe excelente num foco que você escolhe. Quem faz o treino é a equipe **Treinador**, que fica em *Sistema* e usa a IA mais forte que você tiver ligada (de preferência o Claude).

1. Em **Equipes**, clique em **Treinar** na equipe.
2. Escreva **em que ela deve ficar excelente**. Seja específico: "segurança de baladas: controle de acesso, lotação, plano de evacuação" funciona melhor que "segurança".
3. Escolha o **nível**. Cada cartão mostra o número de cópias, rodadas e casos, e quantas chamadas e minutos o treino pode gastar no máximo:

| Nível | Cópias por rodada | Rodadas (máx.) | Casos de teste | Chamadas (máx.) |
| --- | --- | --- | --- | --- |
| Leve | 2 | 2 | 4 | ~23 |
| Médio | 3 | 3 | 5 | ~58 |
| Profundo | 4 | 5 | 6 | ~146 |
| Personalizado | você escolhe | você escolhe | você escolhe | mostrado na hora |

4. Defina a **meta**: a nota mínima, de 0 a 100, para uma cópia virar a equipe oficial. O padrão é 85.
5. Escolha a **IA do Treinador** e clique em **Criar casos de teste**.
6. O Treinador escreve os casos: pedidos como um usuário faria, cada um com os critérios do que uma boa resposta precisa ter. **Revise**: edite, remova, **+ Adicionar caso** ou **Pedir outros casos ao Treinador**.
7. Clique em **Começar o treino**. Pode sair da tela: ele continua rodando.

**O que acontece em cada rodada:**

- O Treinador cria **cópias** da equipe, cada uma com instruções diferentes (checklist, passo a passo, foco em fontes…).
- Cada cópia responde a todos os casos usando **a IA da própria equipe**.
- O Treinador dá nota de 0 a 100 por caso e diz o que faltou.
- A melhor cópia vira a base da rodada seguinte, e o Treinador corrige as falhas dela.

O treino para quando uma cópia atinge a meta ou quando as rodadas acabam. Na tela do treino você vê cada cópia, a nota de cada caso, o que faltou e as instruções completas.

**No fim:**

- **Meta atingida:** as instruções da cópia vencedora viram a equipe oficial. A equipe ganha o selo **treinada · nota** e o gestor já usa a nova versão nas próximas tarefas.
- **Meta não atingida:** você decide. Use **Aplicar à equipe mesmo assim** ou **Treinar de novo**.
- **Desfazer:** volta a equipe às instruções de antes do treino. Fica na tela do treino e em **Equipes → Detalhes**.
- **O treino alimenta o cérebro**, mesmo sem atingir a meta. Na área da equipe ficam:
    - **treino-…**: o resumo, com objetivo, rodadas e instruções vencedoras;
    - **criterios-…**: o que é uma boa resposta naquele assunto, somando todos os treinos;
    - **erros-comuns-…**: o que o juiz apontou que faltou, para evitar;
    - **exemplos-…**: as melhores respostas de cada caso, com a nota, como modelo de qualidade.
  Tudo fica ligado por links e aparece no grafo do **Cérebro**. Como as equipes consultam a própria área antes de cada tarefa, elas passam a usar isso no trabalho de verdade.

Se o app fechar no meio, o treino fica **interrompido**. **Continuar de onde parou** refaz só a rodada incompleta.

## Tela livre

Na tela livre você monta o seu time de agentes: cada agente é um terminal real, e você decide quem conversa com quem. Cada projeto tem o seu espaço, e há também o espaço **Geral** (botões no canto esquerdo da barra).

### Criar agentes

1. Clique em **Novos agentes**.
2. Preencha:
    - **Nome ou prefixo**: com mais de um, eles ganham um número (Revisor 1, Revisor 2…).
    - **Quantos**: até 12 de uma vez.
    - **IA**: Claude Code, Gemini, Codex, Ollama, um terminal comum ou outra que você cadastrou.
    - **Área do cérebro**: pasta do vault que o agente deve consultar antes de começar.
    - **Papel**: uma frase do que ele faz. Os outros agentes veem isso.
    - **Máquina**: este computador ou uma máquina remota. Num espaço de projeto remoto, já vem a máquina dele.
    - **Pasta**: onde o terminal abre. Num espaço de projeto, já vem a pasta do projeto.
3. Deixe marcado **Apresentar o agente ao time ao iniciar**: o terminal recebe um aviso curto com o nome, o papel, a área do cérebro e os comandos `orq`.
4. Clique em **Criar**. Com **Iniciar já** marcado, os terminais abrem na hora.

No cabeçalho de cada agente: **Iniciar**, **Parar**, **Reiniciar**, **Editar** e **×** para remover. Clique dentro do terminal para digitar nele normalmente.

### Ligar agentes

Arraste o **círculo roxo** na borda direita de um agente até outro agente. Pronto: os dois podem conversar. Para desligar, passe o mouse no meio do fio e clique no **×**.

Se preferir que todos do espaço conversem sem fios, marque **Comunicação livre** na barra.

Quando um agente manda algo para outro, o fio pisca e mostra o começo da mensagem.

### Notas e rascunhos

- **Nota**: texto livre, com quatro cores (clique no ponto colorido). Duplo clique no fundo também cria uma.
- **Rascunho**: área para desenhar à mão livre, com **Desfazer** e **Limpar**.

### Mover pela tela

- Arraste o fundo para mover a tela. No trackpad, dois dedos.
- Roda do mouse (ou pinça no trackpad) para zoom. **Ajustar** enquadra tudo.
- Arraste o cabeçalho de um item para movê-lo e o canto inferior direito para redimensionar.

### Painel de mensagens

O botão **Mensagens** abre o painel à direita, com tudo o que os agentes do espaço pediram uns aos outros. Embaixo dele você manda uma **mensagem do operador** para qualquer agente:

1. Escolha o agente em **Para**.
2. Escreva o **Objetivo** em uma ou duas frases (até 600 caracteres).
3. Se quiser, use **Procurar no cérebro** e clique num resultado para anexá-lo em **Do cérebro**.
4. Clique em **Enviar**. A mensagem é digitada no terminal do agente quando ele estiver livre.

## Máquinas remotas (SSH)

Assim como o Remote-SSH do VS Code, um projeto pode morar noutro computador ou servidor. O gestor, as equipes e os agentes rodam lá, com as IAs instaladas lá, e você comanda daqui. O app usa o SSH do sistema, então vale o que já estiver no seu `~/.ssh/config`. No Windows 10/11 o cliente SSH já vem instalado.

### Adicionar uma máquina

1. Abra **Máquinas** no menu do topo.
2. Em **Adicionar máquina**, preencha:
    - **Nome**: como ela aparece no app (ex.: Servidor de casa).
    - **Destino**: `usuario@endereco` (ex.: `coelho@192.168.0.20`) ou o nome de um Host do seu `~/.ssh/config`.
    - **Porta**: deixe vazio para a 22.
    - **Chave**: só se não for a padrão (ex.: `~/.ssh/id_ed25519`).
3. Clique em **Adicionar** e depois em **Testar conexão**.

Com a conexão ok, a linha mostra o sistema da máquina e quais IAs existem lá.

### Botões de cada máquina

- **Testar conexão**: confere o acesso e procura as IAs e o Node.js na máquina. Se falhar, o motivo aparece em português (senha recusada, endereço não encontrado, tempo esgotado…).
- **Acesso sem senha**: use uma vez se o teste pedir senha. Abre um terminal dentro do app, você digita a senha da máquina e o app autoriza a chave SSH deste computador lá. O gestor e as equipes precisam entrar sem digitar senha.
- **Abrir terminal**: um terminal na máquina, dentro do app.
- **Instalar IA lá…**: escolha uma IA que falta na máquina. A instalação roda num terminal visível, e só depois que você escolhe.
- **Remover**: tira a máquina do app (os projetos dela ficam sem máquina).

### Trabalhar numa máquina remota

- **Projetos**: em **Criar projeto**, escolha a máquina em **Onde fica**. A pasta é o caminho **na máquina remota** (ex.: `~/projetos/api`). O gestor só usa as IAs instaladas lá.
- **Agentes**: na tela livre, escolha a máquina em **Novos agentes**. O terminal abre lá.
- **Comando `orq` lá**: os agentes remotos usam o `orq` normalmente, por um túnel seguro até o seu app. Para isso, a máquina precisa ter o **Node.js 18 ou mais novo**. Sem Node.js lá, a linha da máquina avisa, e os agentes de lá trabalham sem o `orq`.
- O cérebro continua neste computador. As equipes remotas recebem o conteúdo da nota da tarefa junto com o pedido.

## O cérebro e o comando orq

O cérebro é a pasta `Documentos/Singularize/cerebro`. Você vê tudo dentro do app, na tela **Cérebro**, e também pode abrir essa pasta no Obsidian para ler e editar como qualquer vault.

| Pasta | O que guarda |
| --- | --- |
| `10-tarefas/` | Uma nota por solicitação: o pedido, o plano do gestor e o que cada equipe fez. |
| `20-areas/` | O que funcionou de fato, por área. Ex.: `20-areas/seguranca/como-testar.md`. |
| `30-anexos/` | Fotos enviadas com as solicitações. |

Toda nota nova feita por uma IA entra como **rascunho**. Ela vira **validado** quando você aprova a entrega que a gerou. Você também pode editar à mão: a linha `estado:` no topo da nota diz qual é.

### Ver o cérebro se formando

A tela **Cérebro**, no menu do topo, mostra o vault como um grafo, igual à visão de grafo do Obsidian, sem precisar do Obsidian:

- **Pontos grandes** são as equipes. Quanto maior, mais ela já aprendeu.
- **Pontos pequenos** são as notas: cheios quando validados, só o contorno quando ainda são rascunho.
- **Pontos cinza** são as tarefas. A linha tracejada liga cada tarefa às equipes que trabalharam nela; as linhas cheias são os links `[[...]]` entre notas.
- Nota nova aparece na hora, com um brilho, perto da equipe que a criou.

Para ver só o que uma equipe está formando, clique no nome dela na barra de filtros ou no ponto dela no grafo. O painel da direita mostra quantas notas ela tem, quantas já foram validadas, em quais tarefas trabalhou e a lista do que ela já sabe. Clique numa nota para ler o conteúdo; se for rascunho, **Validar esta nota** marca como conhecimento confiável.

Arraste o fundo para mover, use a roda do mouse para zoom e **Enquadrar** para ver tudo. **Procurar nota** destaca as notas pelo nome, e **Tarefas** mostra ou esconde as tarefas.

### Comandos que os agentes usam

Todo agente da tela livre tem o comando `orq` no terminal. Você também pode digitá-lo dentro de um agente para ver o que ele vê.

| Comando | Para quê |
| --- | --- |
| `orq quem` | Lista quem está ligado a você. |
| `orq cerebro owasp jwt` | Procura notas e skills no cérebro. |
| `orq ler 20-areas/seguranca/como-testar.md` | Mostra uma nota. |
| `orq enviar codigo "objetivo curto" --ref <caminho>` | Pede algo a outro agente, apontando notas do cérebro. |
| `orq enviar seguranca "Feito" --re m12` | Responde a uma mensagem recebida. |
| `orq aprender seguranca "título" "texto"` | Registra no cérebro o que funcionou (como rascunho). |
| `orq areas` | Lista as áreas do cérebro. |

Para manter a conversa útil e barata, o app impõe limites:

- até **600 caracteres** por mensagem e **5 referências** ao cérebro;
- referência a nota que não existe é recusada, com a dica de procurar com `orq cerebro`;
- **6 mensagens por minuto** por agente;
- **12 respostas encadeadas**: depois disso, o operador precisa intervir.

No Claude Code, o `orq` já vem liberado para rodar sem pedir permissão a cada vez. Os demais comandos continuam pedindo, como de costume.

## Resumo de volta, Headroom e celular

### Enquanto você estava fora

Se você ficar 10 minutos ou mais sem mexer no app, ao voltar aparece no canto da tela **Enquanto você estava fora**. Ele lista:

- tarefas que terminaram, travaram ou esperam você;
- mensagens trocadas entre agentes;
- agentes que trabalharam e pararam, com as últimas linhas da saída.

**Resumir com IA** escreve um resumo curto com próximos passos, usando o Ollama local se houver. **Entendi** fecha o aviso. O botão **O que aconteceu**, no topo, mostra as últimas 12 horas a qualquer momento.

### Headroom (economia de tokens)

O Headroom comprime o que é enviado à IA, para a mesma cota render mais. Na tela **IAs**:

1. Clique em **Instalar Headroom**. A versão padrão é leve; **Versão completa** baixa vários GB. O Headroom precisa do Python: se não houver um no computador, o app explica e pergunta antes. Com o seu **sim**, instala o Python (pelo uv, só para o seu usuário, sem senha de administrador) num terminal visível e segue com o Headroom. Sem o Python não é possível usar o Headroom.
2. Marque **Usar Headroom**. O app liga o proxy junto com ele.
3. Em **Passar pelo Headroom**, escolha as IAs. Funciona com Claude Code, Codex e CLIs compatíveis; Gemini e Ollama seguem direto.
4. **Ver economia** mostra quanto foi poupado.

### Usar pelo celular ou outro computador

1. Na pasta de configuração do app (veja Onde ficam seus dados, no começo deste manual), crie ou edite o arquivo `.env` e defina `ORQ_TOKEN` com uma senha longa e `ORQ_HOST=0.0.0.0` (ou o IP da sua rede privada, como o Tailscale).
2. Reinicie o app.
3. No celular, abra `http://<ip-do-computador>:4700/?token=<sua-senha>` uma vez. O navegador guarda o acesso.

Nunca abra o app para a internet sem `ORQ_TOKEN`: os agentes executam comandos na sua máquina.

## Problemas comuns

Se algo não funciona e você não sabe por quê, clique em **Gerar diagnóstico** (na tela **IAs** ou em **Ajuda**). O app cria um arquivo `.txt` em `Documentos/Singularize/diagnosticos` com tudo o que o computador está vendo: versões, pastas, onde cada IA foi encontrada, o comando que o app executa, um teste ao vivo de cada IA ligada, as tarefas com problema e os registros recentes. Senhas, tokens e chaves ficam de fora. Envie esse arquivo para quem está te ajudando. Cada chamada às IAs também fica registrada em `logs/ias.log`, na pasta de configuração do app.

Quando o **Testar** de uma IA falha, o app mostra o motivo, o comando exato, o código de saída e o que a IA respondeu. **Testar no terminal** roda o mesmo comando numa janela visível.

| O que acontece | O que fazer |
| --- | --- |
| Faixa amarela de modo simulado | Nenhuma IA real está pronta. Em **IAs**, clique em **Escolher IAs** e instale ou entre na conta de uma. |
| IA aparece como não encontrada | Se você instalou por fora, clique em **IAs → Procurar de novo neste computador**. Se ainda não aparecer, use **Instalar**. |
| Instalação de IA falhou | Leia o fim do terminal da instalação e clique em **Tentar de novo**. No Windows, o Gemini e o Codex precisam do Node.js; o app instala pelo winget se faltar. |
| Gemini mostra "This client is no longer supported… migrate to the Antigravity" | O Google desativou o Gemini CLI para contas pessoais. Em **IAs → Escolher IAs**, desmarque o Gemini CLI, marque o **Antigravity** e clique em **Entrar na conta**. |
| Claude pergunta "Do you trust this folder?" | É normal na primeira vez. Escolha **Yes, I trust this folder**. |
| **Testar** falha | Clique em **Entrar na conta** e faça login de novo. Para Ollama, confira se o modelo foi baixado. |
| Windows avisa "O Windows protegeu o computador" | Clique em **Mais informações → Executar assim mesmo**. O instalador ainda não é assinado. |
| Máquina remota pede senha ou falha no teste | Use **Acesso sem senha** uma vez. Se o erro for de endereço ou tempo esgotado, confira o destino, a porta e se a máquina está ligada. |
| Agente remoto sem o comando `orq` | Instale o Node.js 18+ na máquina remota e clique em **Testar conexão** de novo. |
| Uma IA aparece "sem cota" | O app tirou ela do rodízio por 1 hora e passou o trabalho para a reserva. **Liberar agora** em **IAs** devolve antes. |
| Agente não recebe a mensagem | A mensagem espera o agente ficar livre ou iniciar. Confira se ele está rodando e se há fio ligando os dois. |
| Agente recusa enviar mensagem | Leia o motivo no terminal dele: mensagem longa, caminho inexistente no cérebro ou falta de fio. |
| Terminais fecharam | Ao reiniciar o app, os terminais dos agentes fecham. Clique em **Iniciar** em cada um; mensagens pendentes são entregues. |
| Quero voltar como estava antes de atualizar | Em **Ajuda → Backup e atualização → Backups automáticos**, clique em **Restaurar** no backup da versão anterior. |
| Tarefa parou com erro | Leia o motivo (ele diz qual IA falhou e por quê), ajuste o que ele pede, por exemplo ligando uma IA em **IAs**, e clique em **Tentar de novo** ao lado da tarefa. |

## Glossário

- **Agente**: um terminal real com uma IA, na tela livre.
- **Avaliador**: equipe que confere a entrega contra o pedido antes de chegar a você.
- **Cérebro**: o vault do Obsidian com o que o time aprendeu.
- **Equipe**: um papel que o gestor chama numa solicitação, com uma IA principal e uma reserva.
- **Fio**: ligação entre dois agentes; só agentes ligados conversam.
- **Gestor**: quem recebe as solicitações, entende o propósito e divide o trabalho entre as equipes certas.
- **Máquina**: um computador remoto acessado por SSH, onde projetos e agentes podem rodar.
- **Modo do projeto**: Automático, Com aprovação ou Manual; diz quanto o gestor decide sozinho.
- **Projeto**: uma pasta de trabalho, neste computador ou numa máquina remota.
- **Família**: grupo de equipes do mesmo assunto; cada uma continua independente.
- **Treino**: rodadas em que cópias de uma equipe competem em casos de teste até uma atingir a meta.
- **Equipe sob medida**: equipe que o gestor criou para um projeto quando nenhuma existente servia.
- **Objetivo**: para que você usa o app (programar, pesquisar, escrever…); cada objetivo cria as equipes certas para ele.
- **Rascunho / validado**: estado de uma nota do cérebro; vira validado quando você aprova.
- **Worktree**: cópia separada do repositório para cada tarefa, numa branch própria.
