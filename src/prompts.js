// Prompts curtos de propósito: o contexto vive na nota do vault e a IA lê só o que precisa.
// Quem não lê arquivos (ex.: Ollama) recebe a nota inline, porque não tem outro jeito.

const contexto = ({ tarefa, vault, ia }) => {
  const caminho = vault.caminhoNota(tarefa);
  const nota = vault.lerNota(tarefa);
  // Nota curta vai junto no pedido: a IA não depende de permissão para ler fora da pasta do projeto.
  if (!ia.capacidades?.arquivos || nota.length <= 12000) return `NOTA: ${caminho}\nConteúdo da nota (é o único contexto da tarefa):\n<<<\n${nota}\n>>>`;
  return `NOTA: ${caminho}\nLeia essa nota antes de começar. Ela é o único contexto da tarefa.`;
};

const area = ({ equipe, vault, ia }) => {
  const indice = vault.indiceArea(equipe.area);
  if (!indice) return '';
  const onde = ia.capacidades?.arquivos ? ` (pasta ${vault.caminhoArea(equipe.area)})` : '';
  return `\nConhecimento validado da sua área${onde}. Consulte só o que for útil:\n${indice}\n`;
};

// Uma linha por equipe para o gestor: família, foco, contextos e se já foi treinada.
const linhaEquipe = (e) =>
  `- ${e.id}: ${e.desc}${e.familia ? ` [família ${e.familia}]` : ''}${e.foco ? ` [foco: ${e.foco}]` : ''}${e.contextos?.length ? ` [contextos: ${e.contextos.join(', ')}]` : ''}${e.treino?.nota ? ` [treinada, nota ${e.treino.nota}]` : ''}${e.requer === 'editar' ? ' [altera arquivos]' : ''}`;

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
${podeCriar ? `5. Se nenhuma equipe existente serve bem a uma parte do trabalho, crie uma sob medida em "novasEquipes"
   (nome curto, o que faz, família se ela pertence a uma, foco, instruções objetivas, requerEditar só se ela precisa alterar arquivos) e use o nome dela em "etapas".
   Crie no máximo 3 e só quando realmente faltar; prefira reutilizar.` : ''}
6. "criterios" = o que o avaliador vai conferir no fim, tirado do pedido. O avaliador entra sozinho; não o inclua.

Responda SOMENTE com este JSON:
{"tipo":"pesquisa","fase":"frase curta para o usuário dizendo como dividiu","criterios":["..."],"novasEquipes":[{"nome":"...","desc":"...","familia":"...","foco":"...","instrucoes":"...","requerEditar":false}],"etapas":[{"equipe":"id ou nome da equipe nova","objetivo":"..."}]}`;

export const supervisor = ({ tarefa, projeto, equipe, etapa, indice, total, vault, ia }) => `TIPO_ETAPA: executar
EQUIPE: ${equipe.nome}
Você é o SUPERVISOR da equipe ${equipe.nome}: ${equipe.desc}
Agentes internos que você pode coordenar: ${equipe.agentes || 'nenhum'}.
Você não fala com outras equipes. O resultado delas está na nota; sua resposta vai só para o gestor.
Projeto: ${projeto?.nome ?? '-'}. Você está na pasta ${tarefa.cwd ?? projeto?.pasta ?? '-'}.
${contexto({ tarefa, vault, ia })}
${area({ equipe, vault, ia })}${equipe.instrucoes ? `\nInstruções da equipe:\n${equipe.instrucoes}\n` : ''}
Sua etapa (${indice + 1} de ${total}): ${etapa.objetivo}

Se faltar uma decisão que só o usuário pode tomar, não invente: devolva status "pergunta".
Ao terminar, responda SOMENTE com este JSON:
{"status":"ok|pergunta|falhou","resumo":"o que foi feito, em até 3 frases","arquivos":["caminhos alterados"],"pergunta":"","opcoes":[],"aprendizado":"padrão reutilizável que funcionou de fato (ou vazio)"}`;

export const avaliar = ({ tarefa, projeto, equipe, vault, ia }) => `TIPO_ETAPA: avaliar
EQUIPE: ${equipe.nome}
Você é o AVALIADOR. Confira o trabalho das equipes contra o pedido e os critérios. Não altere arquivos.
Projeto: ${projeto?.nome ?? '-'} (${tarefa.cwd ?? projeto?.pasta ?? '-'})
${contexto({ tarefa, vault, ia })}

Critérios:
${(tarefa.criterios ?? []).map((c) => `- ${c}`).join('\n') || '- Atende ao pedido'}

Se precisar de uma decisão do usuário, devolva status "pergunta".
Responda SOMENTE com este JSON:
{"status":"ok|pergunta","aprovado":true,"resumo":"...","criterios":[{"texto":"...","ok":true}],"pergunta":"","opcoes":[]}`;
