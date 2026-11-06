// Telas de treinamento de equipes: configurar (nível, meta, treinador), revisar casos, acompanhar e resultado.

const ESTADOS = {
  'gerando-casos': ['acento', 'criando casos de teste'],
  revisar: ['espera', 'revise os casos'],
  treinando: ['acento', 'treinando'],
  'provando-ias': ['acento', 'prova das IAs'],
  concluido: ['ok', 'concluído'],
  falhou: ['erro', 'parou com erro'],
  cancelado: ['erro', 'cancelado'],
  interrompido: ['espera', 'interrompido'],
  pausado: ['espera', 'sem cota: continua sozinho'],
};

// Altura da caixa de texto para caber o texto todo (sem rolagem dentro da caixa).
const linhas = (texto, porLinha) => Math.max(1, Math.ceil(String(texto ?? '').length / porLinha));

const estimar = ({ copias, rodadas, casos, confirmacoes = 1 }) => {
  // + a prova da IA reserva no fim (casos + 1 nota) + as confirmações da nota vencedora.
  const chamadas = 1 + rodadas * (copias * casos + copias + 1) + casos + 1 + confirmacoes * (casos + 1);
  return { chamadas, minutos: Math.max(1, Math.round((chamadas * 25) / 60)), tokensMil: Math.round((chamadas * 4000) / 1000) };
};

const OBJETIVO_PROFESSOR =
  'Ensinar equipes de IA como um bom professor: criar casos de teste realistas, variados e difíceis na medida certa, com critérios objetivos; dar notas justas e coerentes dizendo o que faltou; e reescrever instruções que corrigem a causa das falhas.';

export const criarTelasTreino = ({ S, $, esc, api, toast, ajuda }) => {
  const equipe = (id) => S.d.equipes.find((e) => e.id === id);
  const iaNome = (id) => S.d.ias.find((i) => i.id === id)?.nome ?? id ?? '—';
  const iasLigadas = () => S.d.ias.filter((i) => i.ativa && !['shell'].includes(i.tipo));

  // ---------------------------------------------------------------- configurar um treino novo

  const telaTreinar = {
    montar(equipeId) {
      const e = equipe(equipeId);
      if (!e) {
        $('#app').innerHTML = '<div class="pagina"><p class="vazio">Equipe não encontrada. <a href="#/equipes">Voltar para Equipes</a></p></div>';
        return;
      }
      this.e = e;
      this.nivel = 'medio';
      this.custom = { ...S.d.niveisTreino.medio };
      const treinador = equipe('treinador');
      const professor = e.id === 'treinador';
      // No treino do Treinador, quem prepara a prova e corrige é outra IA (a do Avaliador, de preferência).
      const ligadas = professor ? iasLigadas().filter((i) => i.id !== e.principal) : iasLigadas();
      const preferida = professor ? equipe('avaliador')?.principal : treinador?.principal;
      $('#app').innerHTML = `<div class="pagina treino">
        <a href="#/equipes" class="link" style="align-self:flex-start">← Equipes</a>
        <div class="empilha" style="gap:8px">
          <span class="dica">${e.familia ? `Família ${esc(e.familia)}` : 'Equipe'} · responde com ${esc(iaNome(e.principal))}</span>
          <h1 class="titulo" style="font-size:44px">Treinar ${esc(e.nome)}</h1>
          <p class="intro">${
            professor
              ? 'Aqui o Treinador vira aluno, como um professor sendo formado para ensinar. Outra IA prepara uma prova com tarefas de ensino (criar casos de teste, dar notas a respostas, corrigir instruções que falharam). Cópias do Treinador fazem a prova, e o método vencedor passa a guiar todos os próximos treinos de equipes.'
              : 'O Treinador cria casos de teste para o foco que você der. Depois, cópias desta equipe com instruções diferentes respondem a esses casos, recebem nota, e a melhor vira base da rodada seguinte. Quando uma cópia atinge a meta, ela vira a versão oficial da equipe.'
          }</p>
          <p class="dica" style="font-size:14px;line-height:1.5;margin:0">No fim, as IAs da equipe fazem a mesma prova: a principal precisa da meta e a reserva da nota mínima dela. Se a reserva for melhor que a principal, ela é promovida e a principal vira reserva. Se a reserva não passar, outras IAs ligadas tentam a vaga.</p>
        </div>
        <form class="empilha" style="gap:22px" data-form="treinar">
          <div class="grupo"><label for="tr-obj">Em que esta equipe deve ficar excelente? ${ajuda('Seja específico: o tipo de assunto, de pedido e de resposta. Ex.: "segurança de eventos noturnos: controle de acesso, lotação, brigada, plano de evacuação" ou "pesquisa política no Brasil com fontes oficiais".')}</label>
            <textarea class="campo" id="tr-obj" name="objetivo" rows="3" required placeholder="Ex.: segurança de aplicações web: OWASP Top 10, autenticação, APIs e segredos">${esc(professor ? OBJETIVO_PROFESSOR : e.foco || e.desc || '')}</textarea></div>

          <fieldset class="tr-niveis" style="border:none;margin:0;padding:0">
            <legend class="rotulo" style="margin-bottom:12px;color:var(--texto)">Nível do treino ${ajuda('Quanto mais cópias, rodadas e casos, melhor tende a ficar, e mais da sua cota gasta. As chamadas são o máximo: o treino para antes se atingir a meta.')}</legend>
            <div class="tr-grade" id="tr-niveis"></div>
            <div id="tr-custom"></div>
          </fieldset>

          <div class="tr-linha">
            <div class="grupo" style="flex:1 1 220px"><label for="tr-meta">Meta da IA principal ${ajuda('Nota mínima para a cópia virar a equipe oficial e para a IA principal continuar no posto.')}</label>
              <div style="display:flex;align-items:center;gap:14px"><input type="range" id="tr-meta" name="meta" min="50" max="100" step="5" value="80" style="flex:1"><span class="serif" style="font-size:28px" id="tr-meta-v">80</span></div></div>
            <div class="grupo" style="flex:1 1 220px"><label for="tr-meta-r">Nota mínima da reserva ${ajuda('A IA reserva faz a mesma prova no fim. Abaixo disso, outras IAs ligadas tentam a vaga.')}</label>
              <div style="display:flex;align-items:center;gap:14px"><input type="range" id="tr-meta-r" name="metaReserva" min="40" max="100" step="5" value="70" style="flex:1"><span class="serif" style="font-size:28px" id="tr-meta-r-v">70</span></div></div>
            <div class="grupo" style="flex:1 1 220px"><label for="tr-ia">${professor ? 'IA que prepara a prova e corrige' : 'IA do Treinador'} ${ajuda(professor ? 'Precisa ser outra IA, diferente da que o Treinador usa, para ninguém dar nota a si mesmo.' : 'Ela cria os casos, escreve as cópias e dá as notas. Use a mais forte que você tem (ex.: Claude).')}</label>
              <select class="campo" id="tr-ia" name="treinadorIA">${ligadas.map((i) => `<option value="${esc(i.id)}" ${i.id === preferida ? 'selected' : ''}>${esc(i.nome)}${i.problema ? ' (com problema)' : ''}</option>`).join('')}</select>
              ${professor && !ligadas.length ? '<span class="dica">Só há uma IA ligada: ela vai corrigir a si mesma. Ligue outra em IAs para uma nota justa.</span>' : ''}</div>
          </div>
          <fieldset class="tr-linha" style="border:none;margin:0;padding:0">
            <legend class="rotulo" style="margin-bottom:12px;color:var(--texto)">Limites do treino ${ajuda('O treino respeita estes limites. Perto do fim do tempo ou do orçamento, ele não começa outra rodada: guarda a melhor versão e documenta no cérebro. Se o orçamento de tokens acabar, aplica o melhor que conseguiu (se for melhor que a versão atual da equipe).')}</legend>
            <div class="grupo" style="flex:1 1 180px"><label for="tr-lim-min">Tempo máximo (min) ${ajuda('0 = sem limite de tempo.')}</label><input class="campo" type="number" id="tr-lim-min" name="limiteMin" min="0" max="600" value="60"></div>
            <div class="grupo" style="flex:1 1 180px"><label for="tr-lim-tok">Orçamento (mil tokens) ${ajuda('Teto de tokens estimados do treino inteiro. Sugerido: 1,5× o previsto para o nível.')}</label><input class="campo" type="number" id="tr-lim-tok" name="limiteTokensMil" min="0" max="100000" value="0"></div>
            <div class="grupo" style="flex:1 1 180px"><label for="tr-conf">Confirmações da nota ${ajuda('A meta não vale por um pico isolado: a cópia vencedora responde aos casos de novo esse número de vezes e precisa ficar na meta em todas.')}</label><input class="campo" type="number" id="tr-conf" name="confirmacoes" min="0" max="3" value="1"></div>
          </fieldset>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <span class="dica" id="tr-resumo"></span>
            <div class="cresce"></div>
            <a class="btn texto" href="#/equipes">Cancelar</a>
            <button class="btn" type="submit" ${ligadas.length || professor ? '' : 'disabled'}>${professor ? 'Preparar a prova' : 'Criar casos de teste'}</button>
          </div>
          ${ligadas.length || professor ? '' : '<p class="dica erro">Nenhuma IA ligada. Ligue uma em IAs.</p>'}
        </form>
      </div>`;
      this.render();
      $('#tr-meta').addEventListener('input', (ev) => ($('#tr-meta-v').textContent = ev.target.value));
      $('#tr-meta-r').addEventListener('input', (ev) => ($('#tr-meta-r-v').textContent = ev.target.value));
      for (const id of ['#tr-lim-min', '#tr-lim-tok']) $(id).addEventListener('input', (ev) => (ev.target.dataset.mexido = '1'));
      $('#tr-conf').addEventListener('input', () => this.resumo());
      $('#app').addEventListener('input', this.aoDigitar);
    },
    aoDigitar(ev) {
      const k = ev.target.dataset?.tr;
      if (!k) return;
      telaTreinar.custom[k] = Number(ev.target.value);
      telaTreinar.resumo();
    },
    valores() {
      return this.nivel === 'personalizado' ? this.custom : S.d.niveisTreino[this.nivel];
    },
    resumo() {
      const conf = Number($('#tr-conf')?.value ?? 1);
      const v = { ...this.valores(), confirmacoes: conf };
      const est = estimar(v);
      // Ao trocar de nível, os limites sugeridos acompanham (até você mexer neles).
      const lim = $('#tr-lim-min');
      if (lim && !lim.dataset.mexido) lim.value = this.valores().limiteMin ?? Math.max(20, Math.round(est.minutos * 1.5));
      const tok = $('#tr-lim-tok');
      if (tok && !tok.dataset.mexido) tok.value = Math.round(est.tokensMil * 1.5);
      const el = $('#tr-resumo');
      if (el) el.innerHTML = `Este treino: até <b>${est.chamadas} chamadas</b> à IA (~${est.tokensMil} mil tokens), cerca de <b>${est.minutos} min</b>. Para antes se atingir a meta de forma estável.`;
      const c = $('#tr-custom-est');
      if (c) c.textContent = `≈ ${est.chamadas} chamadas · ~${est.minutos} min`;
    },
    render() {
      const cards = [...Object.entries(S.d.niveisTreino), ['personalizado', { nome: 'Personalizado' }]];
      $('#tr-niveis').innerHTML = cards
        .map(([k, n]) => {
          const on = this.nivel === k;
          const est = k === 'personalizado' ? null : n;
          return `<button type="button" class="tr-nivel" data-acao="tr-nivel" data-nivel="${k}" aria-pressed="${on}">
            <span class="serif" style="font-size:22px">${esc(n.nome)}</span>
            ${est ? `<span class="dica">${n.copias} cópias · até ${n.rodadas} rodadas · ${n.casos} casos</span><span class="tr-custo">≈ ${est.chamadas} chamadas · ~${est.minutos} min</span>` : '<span class="dica">Você escolhe cópias, rodadas e casos.</span>'}
          </button>`;
        })
        .join('');
      $('#tr-custom').innerHTML =
        this.nivel === 'personalizado'
          ? `<div class="tr-linha" style="margin-top:14px">
          ${[
            ['copias', 'Cópias por rodada', 1, 6, 'Quantas versões da equipe competem em cada rodada.'],
            ['rodadas', 'Rodadas no máximo', 1, 8, 'Cada rodada parte da melhor cópia da anterior.'],
            ['casos', 'Casos de teste', 2, 12, 'Quantas perguntas cada cópia responde.'],
          ]
            .map(([k, rot, min, max, dica]) => `<div class="grupo" style="flex:1 1 180px"><label for="tr-${k}">${rot} ${ajuda(dica)}</label><input class="campo" type="number" id="tr-${k}" min="${min}" max="${max}" value="${this.custom[k]}" data-tr="${k}"></div>`)
            .join('')}
          <span class="tr-custo" id="tr-custom-est" style="align-self:flex-end;padding-bottom:12px"></span></div>`
          : '';
      this.resumo();
    },
    desmontar() {
      $('#app').removeEventListener('input', this.aoDigitar);
    },
  };

  // ---------------------------------------------------------------- um treino (casos, progresso, resultado)

  const telaTreino = {
    montar(id) {
      this.id = id;
      this.redesenhar(true);
    },
    // A tela só se redesenha quando este treino muda (evento "treino"), não a cada evento do app.
    atualizar() {},
    t() {
      return S.d.treinos.find((x) => x.id === this.id);
    },
    redesenhar(forcar) {
      const t = this.t();
      const caixa = $('#app');
      const abertos = new Set([...caixa.querySelectorAll('details[open][data-chave]')].map((d) => d.dataset.chave));
      if (!t) {
        caixa.innerHTML = '<div class="pagina"><p class="vazio">Treino não encontrado. <a href="#/equipes">Voltar para Equipes</a></p></div>';
        return;
      }
      // Não redesenha enquanto a pessoa edita os casos.
      if (!forcar && t.estado === 'revisar' && caixa.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
      const e = equipe(t.equipeId);
      const [cor, rotulo] = ESTADOS[t.estado] ?? ['espera', t.estado];
      const est = estimar({ copias: t.copias, rodadas: t.rodadas, casos: t.listaCasos?.length || t.casos });
      caixa.innerHTML = `<div class="pagina treino">
        <a href="#/equipes" class="link" style="align-self:flex-start">← Equipes</a>
        <div class="empilha" style="gap:8px">
          <span class="dica">${esc(t.id)} · ${t.copias} cópias · até ${t.rodadas} rodadas · meta ${t.meta}/100 (reserva ${t.metaReserva ?? 70}) · ${t.professor ? 'prova e notas' : 'treinador'}: ${esc(iaNome(t.treinadorIA))} · ${t.chamadas ?? 0} chamadas feitas · ~${Math.round((t.tokens ?? 0) / 1000)}${t.limiteTokensMil ? ` de ${t.limiteTokensMil}` : ''} mil tokens${t.limiteMin ? ` · limite ${t.limiteMin} min` : ''} · nota confirmada ${t.confirmacoes ?? 0}× · <a href="#/comunicacao/${esc(t.id)}">Ver comunicação</a></span>
          <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap"><h1 class="titulo" style="font-size:40px">Treino de ${esc(e?.nome ?? t.equipeNome)}</h1><span class="selo ${cor}">${rotulo}</span></div>
          <p class="intro" style="margin:0">${esc(t.objetivo)}</p>
        </div>
        ${this.corpo(t, est)}
        ${this.log(t)}
      </div>`;
      for (const d of caixa.querySelectorAll('details[data-chave]')) if (abertos.has(d.dataset.chave)) d.open = true;
    },

    corpo(t, est) {
      if (t.estado === 'gerando-casos') return `<p class="aviso">O Treinador está criando ${t.casos} casos de teste para este foco. Leva um ou dois minutos.</p><button type="button" class="btn texto" data-acao="tr-cancelar" data-id="${t.id}" style="align-self:flex-start">Cancelar</button>`;
      if (['revisar', 'falhou', 'cancelado', 'interrompido', 'pausado'].includes(t.estado) && !t.historico?.length) return this.revisar(t, est);
      return this.progresso(t);
    },

    revisar(t, est) {
      const erro =
        t.estado === 'falhou'
          ? `<p class="aviso erro">Parou: ${esc(t.erro ?? '')}</p>`
          : t.estado === 'pausado'
            ? `<p class="aviso">Todas as IAs ficaram sem cota. O treino continua sozinho às ${t.retomarEm ? new Date(t.retomarEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}.</p>`
            : '';
      return `${erro}
        <div class="empilha" style="gap:6px"><h2 class="titulo" style="font-size:28px">Casos de teste</h2>
        <p class="dica" style="font-size:14px">É assim que o treino mede se a equipe ficou boa. Ajuste o que quiser: cada caso é um pedido e, embaixo, um critério por linha do que uma resposta boa precisa ter.</p></div>
        <div class="tr-casos">${(t.listaCasos ?? [])
          .map(
            (c, i) => `<div class="tr-caso" data-caso="${i}">
            <div style="display:flex;align-items:center;gap:10px"><span class="rotulo">Caso ${i + 1}</span><div class="cresce"></div><button type="button" class="link mudo" data-acao="tr-caso-remover" data-i="${i}">Remover</button></div>
            <textarea class="campo tr-auto" rows="${linhas(c.pedido, 120)}" data-campo="pedido" aria-label="Pedido do caso ${i + 1}">${esc(c.pedido)}</textarea>
            <label class="dica">Critérios (um por linha)</label>
            <textarea class="campo mono tr-auto" rows="${c.criterios.reduce((n, x) => n + linhas(x, 110), 0)}" data-campo="criterios" aria-label="Critérios do caso ${i + 1}" style="font-size:13px">${esc(c.criterios.join('\n'))}</textarea>
          </div>`,
          )
          .join('')}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn contorno pequeno" data-acao="tr-caso-novo">+ Adicionar caso</button>
          <button type="button" class="link" data-acao="tr-gerar" data-id="${t.id}">Pedir outros casos ao Treinador</button>
          <div class="cresce"></div>
          <span class="dica">Até <b>${est.chamadas} chamadas</b> · ~${est.minutos} min</span>
          <button type="button" class="link mudo" data-acao="tr-remover" data-id="${t.id}">Descartar</button>
          <button type="button" class="btn" data-acao="tr-comecar" data-id="${t.id}" ${t.listaCasos?.length ? '' : 'disabled'}>Começar o treino</button>
        </div>`;
    },

    progresso(t) {
      const melhor = t.melhor;
      const barra = (n) => `<span class="tr-barra"><span style="width:${n ?? 0}%;background:${(n ?? 0) >= t.meta ? 'var(--ok)' : 'var(--acento)'}"></span><i style="left:${t.meta}%"></i></span>`;
      const rodadas = (t.historico ?? [])
        .map(
          (r) => `<div class="tr-rodada">
          <span class="rotulo">Rodada ${r.n}</span>
          <div class="tr-copias">${r.copias
            .map((c) => {
              const vencedora = melhor?.id === c.id;
              return `<details class="tr-copia ${vencedora ? 'vencedora' : ''}" data-chave="${esc(c.id)}">
                <summary><span style="flex:1 1 auto"><b>${esc(c.id)}</b> · ${esc(c.nome)}${vencedora ? ' <span class="selo ok">melhor</span>' : ''}</span>
                <span class="serif" style="font-size:22px">${c.media ?? (c.progresso ? `<span class="dica">respondendo ${esc(c.progresso)}</span>` : '<span class="dica">na fila</span>')}${c.confirmacoes?.length ? `<span class="dica" style="font-size:12px;margin-left:8px" data-dica="Notas quando respondeu de novo para confirmar.">${c.estavel ? 'confirmada' : 'instável'}: ${c.confirmacoes.join(', ')}</span>` : ''}</span></summary>
                ${barra(c.media)}
                <pre class="nota" style="white-space:pre-wrap;font-size:12px;margin:8px 0 0">${esc(c.instrucoes)}</pre>
                ${(c.notas ?? []).map((n) => `<p class="dica" style="margin:6px 0 0"><b>Caso ${n.caso}: ${n.nota}</b>${n.falta ? ` · faltou: ${esc(n.falta)}` : ''}</p>`).join('')}
              </details>`;
            })
            .join('')}</div>
        </div>`,
        )
        .join('');
      let topo = '';
      if (t.estado === 'provando-ias') topo = `<div class="aviso">Prova das IAs: a reserva (e, se precisar, outras IAs) responde aos casos com as instruções vencedoras.</div>`;
      else if (t.estado === 'treinando') topo = `<div class="aviso" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">Rodada ${t.rodadaAtual ?? 1} de ${t.rodadas}${melhor ? ` · melhor até agora: ${melhor.media}/100` : ''}<div class="cresce"></div><button type="button" class="btn texto pequeno" data-acao="tr-cancelar" data-id="${t.id}">Cancelar</button></div>`;
      else if (t.estado === 'concluido')
        topo = `<div class="tr-resultado ${t.atingiu ? 'ok' : ''}">
          <div class="empilha" style="gap:4px"><span class="rotulo">${t.atingiu ? 'Meta atingida de forma estável' : t.parada ? `Parou por ${t.parada === 'tempo' ? 'limite de tempo' : 'orçamento de tokens'}` : melhor?.media >= t.meta ? 'Meta atingida só como pico (instável)' : 'Meta não atingida'}</span><span class="serif" style="font-size:48px;line-height:1">${melhor?.media ?? '-'}<span class="dica" style="font-size:18px">/100 · meta ${t.meta}</span></span>
          <span class="dica">${t.aplicado ? `Aplicada à equipe ${esc(t.equipeNome)}. As próximas tarefas já usam estas instruções.` : 'Ainda não aplicada à equipe.'}</span></div>
          <div class="cresce"></div>
          ${t.aplicado ? `<button type="button" class="btn texto" data-acao="tr-desfazer" data-equipe="${t.equipeId}">Desfazer (voltar à versão anterior)</button>` : `<button type="button" class="btn" data-acao="tr-aplicar" data-id="${t.id}">Aplicar à equipe mesmo assim</button>`}
          <a class="btn contorno" href="#/treinar/${esc(t.equipeId)}">Treinar de novo</a>
        </div>`;
      else if (['falhou', 'interrompido', 'cancelado', 'pausado'].includes(t.estado))
        topo = `<div class="aviso ${t.estado === 'falhou' ? 'erro' : ''}" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${t.estado === 'falhou' ? `Parou: ${esc(t.erro ?? '')}` : t.estado === 'interrompido' ? 'O app fechou durante o treino.' : t.estado === 'pausado' ? `Sem cota em todas as IAs. Continua sozinho às ${t.retomarEm ? new Date(t.retomarEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}.` : 'Cancelado.'}<div class="cresce"></div>${melhor ? `<button type="button" class="btn texto pequeno" data-acao="tr-aplicar" data-id="${t.id}">Aplicar a melhor (${melhor.media})</button>` : ''}<button type="button" class="btn pequeno" data-acao="tr-continuar" data-id="${t.id}">Continuar de onde parou</button></div>`;
      return `${topo}${this.provaIAs(t)}${rodadas || '<p class="dica">Criando as primeiras cópias…</p>'}`;
    },

    // Nota de cada IA com as instruções vencedoras, e quem ficou de principal e de reserva.
    provaIAs(t) {
      const p = t.provaIAs;
      if (!p?.resultados?.length) return '';
      const papel = (r) => (r.ia === p.principal ? 'principal' : r.ia === p.reserva ? 'reserva' : 'fora');
      const exigido = (r) => (papel(r) === 'principal' ? t.meta : t.metaReserva ?? 70);
      return `<div class="empilha" style="gap:8px"><h2 class="titulo" style="font-size:26px">Prova das IAs</h2>
        ${p.promovida ? `<p class="aviso">${esc(iaNome(p.promovida))} foi melhor que a principal e ${t.aplicado ? 'foi promovida a IA principal' : 'será promovida quando o treino for aplicado'}.</p>` : ''}
        <div class="tr-ias">${p.resultados
          .map((r) => `<div><b style="flex:1">${esc(r.nome)}</b><span class="dica">${r.papel === 'candidata' ? 'tentou a vaga' : `era ${r.papel}`} → <b>${papel(r)}</b></span><span class="serif" style="font-size:22px;color:${r.media >= exigido(r) ? 'var(--ok)' : '#f08a80'}">${r.media}</span><span class="dica">/ ${papel(r) === 'fora' ? '-' : exigido(r)}</span></div>`)
          .join('')}</div>
        ${p.reservaOk ? '' : p.resultados.length === 1 ? '<p class="dica">Só há uma IA ligada para esta equipe, então não houve reserva para provar. Ligue outra IA em IAs.</p>' : `<p class="dica">Nenhuma IA chegou a ${t.metaReserva ?? 70} para ser a reserva. Ligue outra IA ou treine de novo.</p>`}</div>`;
    },

    log(t) {
      if (!t.log?.length) return '';
      return `<details class="tr-log" data-chave="log"><summary class="link">Registro do treino (${t.log.length})</summary><ul>${[...t.log]
        .reverse()
        .slice(0, 80)
        .map((l) => `<li class="${l.tipo}"><span class="dica">${new Date(l.em).toLocaleTimeString('pt-BR')}</span> ${esc(l.texto)}</li>`)
        .join('')}</ul></details>`;
    },

    // Lê os casos da tela (para salvar antes de começar ou de remover/adicionar).
    casosDaTela() {
      return [...document.querySelectorAll('.tr-caso')].map((el) => ({
        pedido: el.querySelector('[data-campo="pedido"]').value,
        criterios: el.querySelector('[data-campo="criterios"]').value.split('\n'),
      }));
    },
  };

  // ---------------------------------------------------------------- ações

  const salvarCasos = async (casos) => {
    const t = await api('PUT', `/api/treinos/${telaTreino.id}/casos`, { casos });
    const i = S.d.treinos.findIndex((x) => x.id === t.id);
    if (i >= 0) S.d.treinos[i] = t;
    telaTreino.redesenhar(true);
  };

  const acoes = {
    'tr-nivel': (b) => {
      telaTreinar.nivel = b.dataset.nivel;
      if (b.dataset.nivel === 'personalizado') telaTreinar.custom = { ...(telaTreinar.custom ?? S.d.niveisTreino.medio) };
      telaTreinar.render();
    },
    'tr-caso-remover': (b) => salvarCasos(telaTreino.casosDaTela().filter((_, i) => i !== Number(b.dataset.i))),
    'tr-caso-novo': () => salvarCasos([...telaTreino.casosDaTela(), { pedido: 'Novo pedido de exemplo', criterios: ['O que uma boa resposta precisa ter'] }]),
    'tr-gerar': async (b) => {
      await api('POST', `/api/treinos/${b.dataset.id}/gerar-casos`);
      toast('Pedindo novos casos ao Treinador.');
    },
    'tr-comecar': async (b) => {
      await api('PUT', `/api/treinos/${b.dataset.id}/casos`, { casos: telaTreino.casosDaTela() });
      await api('POST', `/api/treinos/${b.dataset.id}/comecar`);
      toast('Treino começou. Você pode sair desta tela: ele continua rodando.');
    },
    'tr-cancelar': (b) => api('POST', `/api/treinos/${b.dataset.id}/cancelar`),
    'tr-continuar': (b) => api('POST', `/api/treinos/${b.dataset.id}/continuar`),
    'tr-aplicar': async (b) => {
      await api('POST', `/api/treinos/${b.dataset.id}/aplicar`);
      toast('Instruções aplicadas à equipe.');
    },
    'tr-desfazer': async (b) => {
      await api('POST', `/api/equipes/${b.dataset.equipe}/desfazer-treino`);
      toast('A equipe voltou para as instruções anteriores.');
    },
    'tr-remover': async (b) => {
      if (!confirm('Descartar este treino?')) return;
      await api('DELETE', `/api/treinos/${b.dataset.id}`);
      location.hash = '#/equipes';
    },
  };

  const enviarTreinar = async (form) => {
    const v = telaTreinar.valores();
    const dados = new FormData(form);
    const t = await api('POST', `/api/equipes/${telaTreinar.e.id}/treinos`, {
      objetivo: dados.get('objetivo'),
      nivel: telaTreinar.nivel,
      copias: v.copias,
      rodadas: v.rodadas,
      casos: v.casos,
      meta: Number(dados.get('meta')),
      metaReserva: Number(dados.get('metaReserva')),
      limiteMin: Number(dados.get('limiteMin')),
      limiteTokensMil: Number(dados.get('limiteTokensMil')),
      confirmacoes: Number(dados.get('confirmacoes')),
      treinadorIA: dados.get('treinadorIA'),
    });
    if (!S.d.treinos.some((x) => x.id === t.id)) S.d.treinos.push(t);
    location.hash = `#/treino/${t.id}`;
  };

  return { telaTreinar, telaTreino, acoes, enviarTreinar };
};
