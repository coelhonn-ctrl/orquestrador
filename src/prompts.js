const FIM = 'A última coisa da sua resposta deve ser esse JSON, sem texto depois dele.';

// Prompts curtos de propósito: o contexto vive na nota do vault e a IA lê só o que precisa.
// Quem não lê arquivos (ex.: Ollama) recebe a nota inline, porque não tem outro jeito.

const contexto = ({ tarefa, vault, ia }) => {
  const caminho = vault.caminhoNota(tarefa);
  const nota = vault.lerNota(tarefa);
  // Nota curta vai junto no pedido: a IA não depende de permissão para ler fora da pasta do projeto.
  if (!ia.capacidades?.arquivos || nota.length <= 12000) return `NOTA: ${caminho}\nConteúdo da nota (é o único contexto da tarefa):\n<<<\n${nota}\n>>>`;
  return `NOTA: ${caminho}\nLeia essa nota antes de começar. Ela é o único contexto da tarefa.`;
};

// Sub-agentes: o supervisor divide a etapa e delega. Cada sub-agente trabalha com contexto próprio
// e devolve só o resultado, então o supervisor não carrega tudo na própria conversa.
const SUBAGENTES = {
  claude: 'a ferramenta Agent (sub-agentes do Claude Code)',
  antigravity: 'os agentes do Antigravity, se estiverem disponíveis',
};
const subagentes = ({ ia, nivel }) => {
  if (!ia?.capacidades?.arquivos || ia.tipo === 'ollama' || ia.tipo === 'custom' || ia.tipo === 'simulado') return '';
  const como = SUBAGENTES[ia.tipo] ?? 'sub-agentes, se a sua ferramenta tiver';
  return `
Sub-agentes (use sempre que a etapa tiver partes que dão para fazer separadas):
- Você é o supervisor: divida a etapa em partes independentes e delegue cada uma a um sub-agente com ${como}, em paralelo.
  Ex.: pesquisar fontes diferentes, analisar arquivos ou módulos diferentes, escrever seções diferentes, revisar enquanto outro implementa.
- Dê a cada sub-agente um pedido curto e completo (o que fazer, onde, o formato da resposta) e peça só o resultado, sem o raciocínio.
- Junte os resultados, confira e só então responda. Nenhum sub-agente fala com o gestor: quem responde é você.
- ${nivel === 'rapido' ? 'Esta etapa é simples: só use sub-agentes se houver mesmo partes independentes; uma resposta direta é mais barata.' : 'Não crie sub-agente para o que dá para responder em poucas linhas.'}
`;
};

// Skills herdadas pela equipe (Central de skills). O servidor liga com definirSkills.
let skillsDe = () => '';
export const definirSkills = (fn) => {
  skillsDe = fn;
};

// Onde a equipe fica na árvore do cérebro e por onde começar a navegar.
const arvore = ({ equipe, vault }) =>
  equipe.caminho?.length ? `\nSeu caminho na árvore do cérebro: ${equipe.caminho.join(' > ')}. Mapa raiz: ${vault.caminhoMapa?.() ?? '20-areas/_mapa.md'}. Navegue por ele antes de buscar notas.\n` : '';

// Formato do aprendizado: três camadas, nunca um caso bruto como regra.
const FORMATO_APRENDIZADO = `"aprendizado":{"titulo":"nome curto do conhecimento (ou vazio se não aprendeu nada reutilizável)","conceito":"camada 1: a regra ou padrão, agnóstico ao caso (o que é e por que)","metodo":"camada 2: o passo a passo para aplicar","exemplo":"camada 3: o caso real desta tarefa que validou isso"}`;

// Formato de resposta de cada etapa. Também é usado para pedir a correção quando a IA erra o formato.
export const ESQUEMA = {
  planejar: '{"tipo":"pesquisa","complexidade":"normal","fase":"frase curta para o usuário dizendo como dividiu","criterios":["..."],"novasEquipes":[{"nome":"...","desc":"...","familia":"...","foco":"...","caminho":["Categoria","Subcategoria","Domínio","Especialidade"],"instrucoes":"prompt comportamental de base completo","requerEditar":false}],"etapas":[{"equipe":"id ou nome da equipe nova","objetivo":"...","dificuldade":"simples|media|dificil"}]}',
  executar: `{"status":"ok|pergunta|falhou","resumo":"o que foi feito, em até 3 frases","resposta":"a entrega em si, para o usuário ler na tela: o texto, a pesquisa com as fontes, ou o que mudou no código e por quê (markdown, completa, sem repetir o resumo)","arquivos":["caminhos alterados"],"pergunta":"","opcoes":[],${FORMATO_APRENDIZADO}}`,
  questionar: '{"status":"ok","resumo":"a resposta em uma frase","resposta":"a resposta completa, em markdown","arquivos":["caminhos alterados, se corrigiu algo"]}',
  analisarEquipe: '{"duplicada":{"id":"id da equipe existente","motivo":"..."} ou null,"nome":"...","desc":"o que faz, em uma frase","familia":"...","foco":"...","contextos":["palavras de quando usar"],"caminho":["Categoria","Subcategoria","Domínio","Especialidade"],"instrucoes":"...","requerEditar":false,"treino":{"recomendado":true,"nivel":"medio","motivo":"..."}}',
  teste: '{"status":"ok|falhou","tipo":"servidor|estatico|arquivos|nenhum","resumo":"o que você preparou, em 1 ou 2 frases","processos":[{"nome":"web","comando":"comando que SOBE o servidor e fica rodando","pasta":"caminho relativo à pasta do projeto, ou .","env":{"VARIAVEL":"valor"}}],"url":"http://localhost:PORTA/caminho","credenciais":[{"rotulo":"E-mail","valor":"..."}],"arquivos":["caminhos relativos para abrir (imagens, html, documentos)"],"passos":["o que o usuário deve testar, em ordem"]}',
  avaliar: '{"status":"ok|pergunta","aprovado":true,"resumo":"...","criterios":[{"texto":"...","ok":true,"obs":"o que você viu, em uma frase"}],"pergunta":"","opcoes":[]}',
};

const area = ({ equipe, vault, ia, tarefa }) => {
  const indice = vault.indiceArea(equipe.area);
  vault.usou?.({ equipe: equipe.id, area: equipe.area, tarefaId: tarefa?.id, mapa: !!equipe.caminho?.length });
  if (!indice) return '';
  const onde = ia.capacidades?.arquivos ? ` (pasta ${vault.caminhoArea(equipe.area)})` : '';
  // Os erros que o avaliador e os treinos já apontaram nesta equipe vão direto no pedido: são curtos e evitam repetir.
  const erros = vault.lerLista?.(equipe.area, `erros-comuns-${equipe.area}`)?.slice(-8) ?? [];
  return `\nConhecimento validado da sua área${onde}. Consulte só o que for útil:\n${indice}\n${erros.length ? `\nErros que esta equipe já cometeu (não repita):\n${erros.map((x) => `- ${x}`).join('\n')}\n` : ''}`;
};

// Uma linha por equipe para o gestor: família, foco, contextos e se já foi treinada.
const linhaEquipe = (e) =>
  `- ${e.id}: ${e.desc}${e.caminho?.length ? ` [árvore: ${e.caminho.join(' > ')}]` : ''}${e.familia ? ` [família ${e.familia}]` : ''}${e.foco ? ` [foco: ${e.foco}]` : ''}${e.contextos?.length ? ` [contextos: ${e.contextos.join(', ')}]` : ''}${e.treino?.nota ? ` [treinada, nota ${e.treino.nota}]` : ''}${e.requer === 'editar' ? ' [altera arquivos]' : ''}`;

export const planejar = ({ tarefa, projeto, equipes, podeCriar, vault, ia }) => `TIPO_ETAPA: planejar
Você é o GESTOR de um sistema de equipes de IA. Você não executa a tarefa: entende o propósito e monta o time certo.
Projeto: ${projeto?.nome ?? '-'} (${tarefa.cwd ?? projeto?.pasta ?? '-'})
${contexto({ tarefa, vault, ia })}

Equipes disponíveis (id: o que faz):
${equipes.length ? equipes.map(linhaEquipe).join('\n') : '(nenhuma ainda: monte o time em "novasEquipes")'}

Como decidir:
1. Primeiro classifique o pedido em "tipo": pesquisa, codigo, escrita, dados, design, operacao ou outro.
2. Use SÓ equipes cujo trabalho serve a esse propósito. Equipe que não contribui diretamente fica de fora.
   Equipes da mesma família (ex.: Segurança web, Segurança de eventos) são independentes: escolha a mais
   específica cujo foco e contextos casam com o pedido; a geral da família só quando nenhuma especializada serve.
   Pode usar mais de uma da mesma família se o pedido tiver partes diferentes.
   Ex.: uma pesquisa sobre países não usa Código, Código limpo, Debug nem Segurança.
3. Equipes que alteram arquivos só entram se o pedido exige mudar código ou arquivos do projeto.
4. O menor número de etapas que entrega bem. Uma etapa basta quando uma equipe resolve.
${podeCriar ? `5. Se nenhuma equipe existente serve bem a uma parte do trabalho, crie uma sob medida em "novasEquipes" e use o nome dela em "etapas".
   Antes, confira se alguma equipe da lista já cobre o escopo (mesmo com outro nome): se cobre, use ela.
   Nome técnico e limpo. "instrucoes" é o Prompt Comportamental de Base, obrigatório e completo: o padrão de referência
   (livro, norma ou método, ex.: Clean Code, OWASP, SOLID, CRAAP), as regras de trabalho e o formato de entrega. Nunca só um título.
   "caminho": o lugar dela na árvore do cérebro, de 3 a 5 níveis (Categoria > Subcategoria > Domínio > Especialidade).
   requerEditar só se ela precisa alterar arquivos. Crie no máximo 3 e só quando realmente faltar.` : ''}
6. "criterios" = o que o avaliador vai conferir no fim, tirado do pedido. O avaliador entra sozinho; não o inclua.
7. Para economizar, diga a "dificuldade" de cada etapa; ela escolhe o modelo de IA (simples = rápido e barato, media = padrão, dificil = o mais forte):
   - simples: resposta direta, consulta curta, ajuste pequeno e óbvio, formatação;
   - media: pesquisa com algumas fontes, texto de tamanho normal, código num ponto conhecido;
   - dificil: raciocínio longo, arquitetura, bug sem causa aparente, mudança em várias partes, análise crítica.
   Na dúvida entre duas, escolha a mais leve: se o avaliador reprovar, o app refaz no modelo forte.
8. "complexidade": "trivial" só para uma pergunta factual curta, cuja resposta cabe em uma ou duas frases (ex.: "qual a capital da Austrália?"). Trivial dispensa o avaliador. Comparações, textos, análises e qualquer código são "normal".

Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.planejar}`;

// Correção: a equipe trabalha junto com o avaliador. Recebe cada apontamento e a própria entrega; corrige o que
// procede e, se discordar de algum ponto, justifica com evidência (o avaliador decide na reconferência).
const correcaoTexto = (etapa) => {
  const pontos = (etapa.apontamentos ?? []).map((a) => `- ${a.texto}${a.obs ? `\n  O avaliador viu: ${a.obs}` : ''}`).join('\n');
  return `Esta é uma CORREÇÃO. O avaliador da equipe reprovou a sua entrega${pontos ? ' nestes pontos' : ''}:
${pontos || '(veja a nota da tarefa)'}${etapa.parecer ? `\nParecer do avaliador: ${etapa.parecer}` : ''}
${etapa.entregaAnterior ? `\nA sua entrega anterior:\n<<<\n${etapa.entregaAnterior}\n>>>\n` : ''}
Como corrigir:
1. Corrija cada ponto que procede. Mantenha o que já estava certo.
2. Se discordar de um ponto, não ignore: explique por quê, com evidência (fonte, teste, trecho do código).
3. Em "resposta", entregue a versão COMPLETA e corrigida (ela substitui a anterior para o usuário), não só o que mudou.
4. Em "resumo", diga o que corrigiu e, se for o caso, o que contestou.
`;
};

export const supervisor = ({ tarefa, projeto, equipe, etapa, indice, total, vault, ia, nivel }) => `TIPO_ETAPA: executar
EQUIPE: ${equipe.nome}
Você é o SUPERVISOR da equipe ${equipe.nome}: ${equipe.desc}
Agentes internos que você pode coordenar: ${equipe.agentes || 'nenhum'}.
Você não fala com outras equipes. O resultado delas está na nota; sua resposta vai só para o gestor.
Projeto: ${projeto?.nome ?? '-'}. Você está na pasta ${tarefa.cwd ?? projeto?.pasta ?? '-'}.
${contexto({ tarefa, vault, ia })}
${arvore({ equipe, vault })}${area({ equipe, vault, ia, tarefa })}${equipe.instrucoes ? `\nInstruções da equipe (o seu DNA, siga sempre):\n${equipe.instrucoes}\n` : ''}${skillsDe(equipe.id)}
Sua etapa (${indice + 1} de ${total}): ${etapa.objetivo}
${etapa.correcao ? correcaoTexto(etapa) : ''}${subagentes({ ia, nivel })}
Se faltar uma decisão que só o usuário pode tomar, não invente: devolva status "pergunta".
Ao terminar, responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.executar}
O aprendizado só entra no cérebro como conhecimento se tiver conceito e método gerais; um caso isolado fica só como exemplo. Não aprendeu nada reutilizável? Deixe o título vazio.`;

// Reconferência depois de uma correção: o avaliador vê o que tinha apontado e julga a correção (e as contestações).
const reconferencia = (tarefa) => {
  const ultima = tarefa.correcoes ? (tarefa.avaliacoesAnteriores ?? []).at(-1) : null;
  if (!ultima) return '';
  const falhas = (ultima.criterios ?? []).filter((c) => !c.ok);
  return `
Esta é uma RECONFERÊNCIA (correção ${tarefa.correcoes}). Na conferência anterior você apontou:
${falhas.map((c) => `- ${c.texto}${c.obs ? ` (${c.obs})` : ''}`).join('\n') || `- ${ultima.resumo}`}
A equipe corrigiu e pode ter contestado algum ponto com evidência. Confira a nova entrega: se a correção ou a contestação
procede, aprove o critério. Não repita exigência que não está no pedido nem nos critérios.
`;
};

export const avaliar = ({ tarefa, projeto, equipe, vault, ia }) => `TIPO_ETAPA: avaliar
EQUIPE: ${equipe.nome}
Você é o AVALIADOR. Confira o trabalho das equipes contra o pedido e os critérios. Não altere arquivos.
Projeto: ${projeto?.nome ?? '-'} (${tarefa.cwd ?? projeto?.pasta ?? '-'})
${contexto({ tarefa, vault, ia })}

Critérios:
${(tarefa.criterios ?? []).map((c) => `- ${c}`).join('\n') || '- Atende ao pedido'}
${reconferencia(tarefa)}
Se precisar de uma decisão do usuário, devolva status "pergunta".
"aprovado" é false se algum critério importante não foi atendido; diga em cada critério o que faltou.
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.avaliar}`;

// O usuário revisou a entrega e mandou uma pergunta ou um questionamento para uma equipe (ou para o gestor).
export const questionar = ({ tarefa, projeto, equipe, pergunta, anteriores = [], entregaDela = '', vault, ia }) => `TIPO_ETAPA: questionar
EQUIPE: ${equipe.nome}
Você é ${equipe.id === 'gestor' ? 'o GESTOR, que coordenou as equipes desta tarefa' : `o SUPERVISOR da equipe ${equipe.nome}: ${equipe.desc}`}.
Projeto: ${projeto?.nome ?? '-'}. Você está na pasta ${tarefa.cwd ?? projeto?.pasta ?? '-'}.
${contexto({ tarefa, vault, ia })}
${equipe.id === 'gestor' ? '' : `${arvore({ equipe, vault })}${area({ equipe, vault, ia, tarefa })}${skillsDe(equipe.id)}`}${equipe.instrucoes ? `\nInstruções da equipe:\n${equipe.instrucoes}\n` : ''}${entregaDela ? `\nO que ${equipe.id === 'gestor' ? 'as equipes entregaram' : 'você entregou'}:\n<<<\n${entregaDela.slice(0, 8000)}\n>>>\n` : ''}${anteriores.length ? `\nConversa anterior com o usuário:\n${anteriores.map((c) => `- Usuário: ${c.pergunta}\n  Resposta: ${String(c.resposta ?? '').slice(0, 1500)}`).join('\n')}\n` : ''}
${subagentes({ ia, nivel: 'padrao' })}
O usuário revisou a entrega e perguntou:
"${pergunta}"

Responda direto à pergunta, com base no trabalho feito. Se ele apontou um erro e você concorda, corrija (pode alterar arquivos do projeto se a sua equipe faz isso) e diga o que mudou. Se discordar, explique por quê com evidência.
Responda SOMENTE com este JSON:
{"status":"ok","resumo":"a resposta em uma frase","resposta":"a resposta completa, em markdown","arquivos":["caminhos alterados, se corrigiu algo"]}`;


// Pedido de equipe nova (pela tela de Equipes): o gestor confere duplicidade, refina o nome,
// escreve o DNA (prompt comportamental de base), escolhe o lugar na árvore e diz se precisa treinar.
export const analisarEquipe = ({ pedido, equipes }) => `TIPO_ETAPA: analisar-equipe
Você é o GESTOR. O usuário quer criar uma equipe nova. Não crie um cartão vazio: analise antes.
Pedido do usuário:
- Nome: ${pedido.nome || '-'}
- O que faz: ${pedido.desc || '-'}
- Foco: ${pedido.foco || '-'}
- Família: ${pedido.familia || '-'}
- Instruções que ele já escreveu: ${pedido.instrucoes || '-'}

Equipes que já existem:
${equipes.map((e) => `- ${e.id}: ${e.nome}: ${e.desc}${e.foco ? ` [foco: ${e.foco}]` : ''}${e.caminho?.length ? ` [árvore: ${e.caminho.join(' > ')}]` : ''}`).join('\n') || '(nenhuma)'}

Faça nesta ordem:
1. Duplicidade: se alguma equipe existente já cobre esse escopo (mesmo com outro nome), aponte em "duplicada" com o motivo. Só aponte se o escopo for realmente o mesmo.
2. Nome técnico e limpo (curto, sem "equipe de").
3. "instrucoes": o Prompt Comportamental de Base completo e obrigatório: o padrão de referência (livro, norma ou método reconhecido, ex.: Clean Code, OWASP, SOLID, CRAAP, Nielsen), as regras de trabalho em itens objetivos e o formato de entrega. Incorpore o que o usuário já escreveu. Nunca só um título.
4. "caminho": o lugar na árvore do cérebro, de 3 a 5 níveis (Categoria > Subcategoria > Domínio > Especialidade).
5. "treino": recomende treinar antes de usar quando o escopo exige alta precisão ou é muito específico; diga o nível (leve, medio, profundo) e o motivo. Se as instruções já cobrem bem, recomende começar direto.

Responda SOMENTE com este JSON:
{"duplicada":{"id":"id da equipe existente","motivo":"..."} ou null,"nome":"...","desc":"o que faz, em uma frase","familia":"...","foco":"...","contextos":["palavras de quando usar"],"caminho":["Categoria","Subcategoria","Domínio","Especialidade"],"instrucoes":"...","requerEditar":false,"treino":{"recomendado":true,"nivel":"medio","motivo":"..."}}`;

// O usuário quer testar a entrega antes de aprovar. A equipe que fez prepara tudo (dependências, build, banco,
// usuário de teste) e devolve como subir; quem sobe e mantém o servidor rodando é o app.
export const prepararTeste = ({ tarefa, projeto, equipe, vault, ia, porta, cwd }) => `TIPO_ETAPA: preparar-teste
EQUIPE: ${equipe.nome}
Você é da equipe ${equipe.nome}, que fez a entrega desta tarefa. Antes de aprovar, o usuário quer TESTAR a entrega
sem instalar nem configurar nada à mão. Prepare o ambiente de teste agora, nesta pasta: ${cwd}.
Projeto: ${projeto?.nome ?? '-'}.
Sistema deste computador: ${process.platform === 'win32' ? 'Windows (os comandos rodam no cmd.exe, não no bash)' : process.platform === 'darwin' ? 'macOS (bash/zsh)' : 'Linux (bash)'}.
${contexto({ tarefa, vault, ia })}

O que fazer:
1. Veja o que foi entregue (a nota da tarefa e os arquivos da pasta).
2. Deixe pronto para rodar: instale as dependências, gere o build se precisar, crie e popule o banco de teste
   (migrações e seed) e, se o sistema tem login, crie um usuário de teste e informe e-mail e senha.
   Use arquivos .env de desenvolvimento quando precisar; nunca coloque segredo real.
3. NÃO deixe servidor rodando e não rode comandos que nunca terminam (dev server, watch). Quem sobe é o app,
   com o comando que você devolver em "processos". Use a porta ${porta} (a variável PORT já vem com ela);
   se o projeto tem mais de uma parte (ex.: API e site), devolva um processo para cada uma, com portas diferentes
   a partir de ${porta}. Variáveis de ambiente vão no campo "env" do processo (ex.: {"DATABASE_URL":"file:./dev.db"}),
   não na frente do comando: assim o mesmo comando roda em qualquer sistema.
4. "url" é o endereço que o usuário abre no navegador para testar (o site, ou a documentação da API).
5. Se a entrega não é um servidor:
   - site estático (HTML/CSS/JS sem build): tipo "estatico" e em "arquivos" o HTML inicial;
   - imagens, documentos ou outros arquivos: tipo "arquivos" e liste os caminhos;
   - outra coisa (biblioteca, script, CLI): tipo "nenhum" e explique em "passos" como testar.
6. "passos": o roteiro de teste para o usuário, curto e em ordem (o que clicar, o que deve acontecer).
Se não der para preparar (falta algo que só o usuário tem), devolva status "falhou" e diga o que falta em "resumo".
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.teste}`;

// O ambiente de teste não subiu: a equipe recebe o erro e o log, corrige o projeto e o app tenta subir de novo.
export const corrigirTeste = ({ tarefa, projeto, equipe, vault, ia, cwd, motivo, log, processos = [] }) => `TIPO_ETAPA: questionar
EQUIPE: ${equipe.nome}
Você é da equipe ${equipe.nome}. O usuário pediu para testar a entrega desta tarefa, mas o ambiente de teste NÃO SUBIU.
Pasta do projeto: ${cwd}. Sistema: ${process.platform === 'win32' ? 'Windows (cmd.exe)' : process.platform}.
${contexto({ tarefa, vault, ia })}
O que aconteceu: ${motivo}
${processos.length ? `Comandos usados para subir:\n${processos.map((p) => `- ${p.nome}: ${p.comando}`).join('\n')}\n` : ''}
Últimas linhas do log:
<<<
${log}
>>>

Corrija o projeto para ele subir neste computador (scripts do package.json, configuração, .env de desenvolvimento,
dependência faltando, porta). Não mude o que o usuário pediu. Não deixe servidor rodando: o app sobe de novo sozinho
depois da sua correção.
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.questionar}`;

// ------------------------------------------------------------ fluxo de correção de erro (teste que não sobe)
// Triagem (gestor) → diagnóstico em paralelo (quem fez + Debug) → consenso (gestor) → correção (quem fez)
// → subir → código limpo → subir → avaliador. Cada etapa tem um papel só e regras duras.

const ESQ_TRIAGEM = '{"camada":"front|back|banco|build|dependencias|configuracao|ambiente|arquitetura","sintoma":"o que o log mostra, literal","gravidade":"bloqueante|alta|media|baixa","hipoteses":[{"causa":"...","evidencia":"trecho do log ou arquivo que sustenta","como_confirmar":"comando ou arquivo que confirma ou derruba"}],"plano":["passo de investigação objetivo"],"fluxo":{"diagnosticar_com":["id da equipe"],"corrigir_com":"id da equipe","revisar_com":["id da equipe (ou lista vazia)"],"justificativa":"por que este fluxo serve a ESTE erro"}}';
const ESQ_DIAGNOSTICO = '{"causa_raiz":"uma frase, específica","camada":"front|back|banco|build|dependencias|configuracao|ambiente|arquitetura","evidencias":["arquivo:linha, saída de comando ou trecho do log que PROVA a causa"],"arquivos":["arquivos envolvidos"],"correcao":["passo exato: arquivo + o que mudar"],"como_confirmar":["comando ou verificação que prova que ficou certo"],"confianca":80,"concorda_com_triagem":true,"observacoes":""}';
const ESQ_CONSENSO = '{"consenso":true,"causa_raiz":"...","base":"qual equipe (ou quais) tinha a evidência que decidiu","divergencias":["..."],"correcao":["passo exato: arquivo + o que mudar, na ordem"],"arquivos":["..."],"criterios":["como saber que ficou certo"],"falta_verificar":["o que ainda precisa ser checado, se não houver consenso"]}';
export const ESQUEMA_FLUXO = { triagem: ESQ_TRIAGEM, diagnostico: ESQ_DIAGNOSTICO, consenso: ESQ_CONSENSO };

const blocoErro = ({ motivo, log, processos = [] }) => `FALHA: ${motivo}
${processos.length ? `COMANDOS USADOS PARA SUBIR:\n${processos.map((p) => `- ${p.nome}: ${p.comando}`).join('\n')}\n` : ''}LOG (últimas linhas):
<<<
${log || '(sem log)'}
>>>`;
const sistema = () => (process.platform === 'win32' ? 'Windows (comandos no cmd.exe)' : process.platform === 'darwin' ? 'macOS' : 'Linux');

export const triagemErro = ({ tarefa, projeto, vault, ia, cwd, erro, equipes = [], autor = null }) => `TIPO_ETAPA: triagem-erro
Você é o GESTOR TÉCNICO. O ambiente de teste de uma entrega NÃO SUBIU. Sua função agora é SÓ A TRIAGEM:
entender o problema e organizar a investigação. Você NÃO corrige e NÃO altera arquivos.
Projeto: ${projeto?.nome ?? '-'} · pasta ${cwd} · sistema ${sistema()}.
${contexto({ tarefa, vault, ia })}
${blocoErro(erro)}

REGRAS
1. Use só evidência: o log, os arquivos da pasta e comandos de leitura. Nada de suposição sem base.
2. Separe SINTOMA (o que o log mostra, literal) de CAUSA (por que acontece).
3. Classifique a camada: front, back, banco, build, dependencias, configuracao, ambiente ou arquitetura.
4. Liste de 1 a 4 hipóteses, da mais provável para a menos, cada uma com a evidência que a sustenta e o comando
   ou arquivo que a confirma ou derruba.
5. O plano de investigação tem passos curtos e verificáveis, que as equipes vão seguir.

MONTE O FLUXO DE CORREÇÃO PARA ESTE ERRO ("fluxo"). Não existe sequência fixa: escolha só o que este problema pede.
Equipes disponíveis (id: o que faz):
${equipes.map((e) => `- ${e.id}: ${e.desc ?? e.nome}`).join('\n')}
${autor ? `Equipe que fez a entrega: ${autor.id}.` : ''}
- "diagnosticar_com": 1 a 3 equipes que investigam em paralelo, sem mexer em nada. Com 2 ou mais, você compara os
  diagnósticos depois. Inclua quem fez a entrega (conhece o código) e quem tem a especialidade do erro: Debug para
  causa raiz em código, quem entende de arquitetura para problema estrutural, de banco para dados, de infra para
  ambiente. Erro óbvio e pontual (variável de ambiente, porta, dependência faltando) pode ter UMA equipe só.
- "corrigir_com": UMA equipe aplica a correção. Normalmente quem fez; num problema estrutural, a equipe que entende
  da estrutura.
- "revisar_com": revisões depois de subir, só quando agregam. Código limpo só se a correção mexeu em lógica de
  código; não faz sentido num erro de configuração, ambiente, dependência ou estrutura. Segurança só se a correção
  toca autenticação, permissão ou dados sensíveis. Lista vazia quando não precisa.
- O avaliador sempre confere no fim; não o inclua. Use só ids da lista acima.
Responda SOMENTE com este JSON (${FIM}):
${ESQ_TRIAGEM}`;

export const diagnosticoErro = ({ tarefa, projeto, equipe, vault, ia, cwd, erro, triagem, papel, outros = [], falta = [] }) => `TIPO_ETAPA: diagnostico-erro
EQUIPE: ${equipe.nome}
Você é ${papel === 'debug' ? 'a equipe de DEBUG: especialista em achar CAUSA RAIZ e propor a correção mínima e direta' : papel === 'autor' ? 'a equipe que CONSTRUIU este projeto: você conhece as decisões e o código' : `a equipe ${equipe.nome}, chamada pela sua especialidade (${equipe.desc ?? equipe.nome}): olhe o erro por esse ângulo`}.
${outros.length || papel !== 'autor' ? 'Outras equipes podem estar diagnosticando o mesmo erro em paralelo; o gestor vai comparar os diagnósticos.' : ''}
Projeto: ${projeto?.nome ?? '-'} · pasta ${cwd} · sistema ${sistema()}.
${contexto({ tarefa, vault, ia })}
${blocoErro(erro)}

TRIAGEM DO GESTOR
${JSON.stringify(triagem, null, 2)}
${outros.length ? `\nDIAGNÓSTICOS DAS OUTRAS EQUIPES (rodada anterior)\n${outros.map((o) => `${o.equipe}: ${JSON.stringify(o.json, null, 2)}`).join('\n\n')}\nO gestor pediu que vocês verifiquem: ${falta.join('; ') || 'as divergências'}.\n` : ''}
REGRAS
1. NÃO altere nenhum arquivo nesta etapa. Só investigue: leia arquivos, rode comandos de leitura e reproduza o erro.
2. Causa raiz é o PORQUÊ, não o sintoma. "O comando falhou" não é causa; "o script start aponta para dist/main.js,
   que só existe depois do build" é causa.
3. Toda afirmação precisa de evidência concreta: arquivo:linha, saída de comando ou trecho do log. Sem evidência, não afirme.
4. Se a evidência contradiz a triagem, diga isso (concorda_com_triagem: false) e mostre por quê.
5. Proponha a correção MÍNIMA que resolve a causa, em passos exatos (arquivo + o que mudar). Nada de refatoração.
6. Diga como confirmar que ficou certo. Confiança de 0 a 100, honesta.
Responda SOMENTE com este JSON (${FIM}):
${ESQ_DIAGNOSTICO}`;

export const consensoErro = ({ tarefa, vault, ia, erro, triagem, diagnosticos, rodada }) => `TIPO_ETAPA: consenso-erro
Você é o GESTOR TÉCNICO. ${diagnosticos.length} equipes diagnosticaram o mesmo erro, de forma independente${rodada > 1 ? ', já na segunda rodada (cada uma viu o diagnóstico das outras)' : ''}.
Decida a causa raiz e escreva a ORDEM DE CORREÇÃO que a equipe autora vai executar.
${contexto({ tarefa, vault, ia })}
${blocoErro(erro)}

TRIAGEM
${JSON.stringify(triagem, null, 2)}

${diagnosticos.map((d) => `DIAGNÓSTICO: ${d.equipe} (${d.papel === 'debug' ? 'Debug' : d.papel === 'autor' ? 'equipe autora' : 'especialista'})\n${JSON.stringify(d.json, null, 2)}`).join('\n\n')}

REGRAS
1. Há consenso quando a CAUSA RAIZ é a mesma (mesmo que descrita com outras palavras) e as correções são compatíveis.
2. Divergiram: decida pela evidência mais concreta e verificável, NÃO pela confiança declarada.
${rodada > 1 ? '3. Esta é a última rodada: decida mesmo sem consenso total, pela melhor evidência. "correcao" não pode ficar vazia.' : '3. Se nenhuma evidência basta para decidir, consenso false e liste em "falta_verificar" exatamente o que cada equipe precisa checar.'}
4. A ordem de correção é mínima, em passos exatos (arquivo + o que mudar), na ordem certa, e ataca a causa, não o sintoma.
5. "criterios": como o avaliador vai saber que ficou certo (ex.: o comando X sobe sem erro, a URL Y responde).
Responda SOMENTE com este JSON (${FIM}):
${ESQ_CONSENSO}`;

export const aplicarCorrecao = ({ tarefa, projeto, equipe, vault, ia, cwd, ordem }) => `TIPO_ETAPA: questionar
EQUIPE: ${equipe.nome}
Você é a equipe que construiu este projeto. Gestor e Debug chegaram à causa raiz do erro que impedia o teste de subir.
Agora você APLICA A CORREÇÃO APROVADA. Projeto: ${projeto?.nome ?? '-'} · pasta ${cwd} · sistema ${sistema()}.
${contexto({ tarefa, vault, ia })}

ORDEM DE CORREÇÃO (aprovada)
Causa raiz: ${ordem.causa_raiz}
Passos:
${(ordem.correcao ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n')}
Arquivos: ${(ordem.arquivos ?? []).join(', ') || '(veja os passos)'}
Critérios de pronto: ${(ordem.criterios ?? []).join('; ') || 'o ambiente sobe sem erro'}

REGRAS
1. Aplique EXATAMENTE os passos, na ordem. Mudança mínima.
2. Não refatore, não renomeie, não mude o comportamento que o usuário pediu, não mexa em arquivos fora da ordem
   (a não ser que um passo exija, e aí diga qual e por quê).
3. Confira os critérios de pronto com comandos que terminam (build, testes, rodar e encerrar). NÃO deixe servidor rodando.
4. Se um passo se mostrar errado ou impossível, PARE e explique em "resumo", com a evidência.
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.questionar}`;

export const limparCodigo = ({ tarefa, projeto, equipe, vault, ia, cwd, arquivos, ordem }) => `TIPO_ETAPA: questionar
EQUIPE: ${equipe.nome}
Você é a equipe de CÓDIGO LIMPO. Uma correção acabou de ser aplicada e o ambiente subiu. Revise SÓ o que foi mexido.
Projeto: ${projeto?.nome ?? '-'} · pasta ${cwd}.
${contexto({ tarefa, vault, ia })}
Correção aplicada: ${ordem.causa_raiz}
Arquivos alterados: ${arquivos.join(', ') || '(veja a nota da tarefa)'}

REGRAS
1. Só nesses arquivos. Nomes claros, sem duplicação, funções curtas, sem código morto nem comentário enganoso.
2. NÃO mude comportamento, assinatura pública, rotas, contratos de API, nem configuração de ambiente.
3. Se já estiver limpo, não mude nada e diga isso.
4. Confira com build ou testes que terminam. NÃO deixe servidor rodando.
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.questionar}`;

export const avaliarCorrecao = ({ tarefa, vault, ia, erro, triagem, ordem, correcao, limpeza, subiu }) => `TIPO_ETAPA: avaliar
EQUIPE: Avaliador
Você é o AVALIADOR. Confira se o fluxo de correção foi coerente e se o resultado está 100% antes de devolver ao usuário.
${contexto({ tarefa, vault, ia })}
${blocoErro(erro)}
TRIAGEM: ${JSON.stringify(triagem)}
CAUSA RAIZ E ORDEM DE CORREÇÃO: ${JSON.stringify(ordem)}
O QUE A EQUIPE CORRIGIU: ${correcao}
LIMPEZA DE CÓDIGO: ${limpeza || '(não houve)'}
AMBIENTE DE TESTE AGORA: ${subiu}

Confira, um por um:
1. A causa raiz foi demonstrada com evidência (não é palpite)?
2. A correção ataca a causa, não só o sintoma?
3. A correção é mínima e não mudou o que o usuário pediu?
4. A limpeza não alterou comportamento?
5. O ambiente subiu e responde (se possível, abra a URL ou rode o comando de verificação)?
"aprovado" só é true se os 5 estiverem ok.
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.avaliar}`;

export const revisarCorrecao = ({ tarefa, projeto, equipe, vault, ia, cwd, arquivos, ordem }) => `TIPO_ETAPA: questionar
EQUIPE: ${equipe.nome}
Você é a equipe ${equipe.nome} (${equipe.desc ?? ''}). Uma correção acabou de ser aplicada e o ambiente subiu.
O gestor pediu a sua revisão, no SEU foco, só do que foi mexido. Projeto: ${projeto?.nome ?? '-'} · pasta ${cwd}.
${contexto({ tarefa, vault, ia })}
Correção aplicada: ${ordem.causa_raiz}
Passos: ${(ordem.correcao ?? []).join(' | ')}
Arquivos alterados: ${arquivos.join(', ') || '(veja a nota da tarefa)'}

REGRAS
1. Revise só esses arquivos e só no seu foco. Corrija o que for problema real no seu foco; não reescreva o resto.
2. NÃO mude o comportamento que o usuário pediu nem a correção que resolveu o erro.
3. Se estiver tudo certo no seu foco, não mude nada e diga isso.
4. Confira com comandos que terminam (build, testes). NÃO deixe servidor rodando.
Responda SOMENTE com este JSON (${FIM}):
${ESQUEMA.questionar}`;
