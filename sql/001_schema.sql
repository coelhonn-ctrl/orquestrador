-- Cada coleção guarda o documento em JSONB; os campos mais consultados têm índice.
create table if not exists orq_projetos (
  id text primary key,
  dados jsonb not null,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);

create table if not exists orq_equipes (like orq_projetos including all);
create table if not exists orq_ias (like orq_projetos including all);
create table if not exists orq_tarefas (like orq_projetos including all);
create table if not exists orq_ajustes (like orq_projetos including all);
create table if not exists orq_agentes (like orq_projetos including all);
create table if not exists orq_mensagens (like orq_projetos including all);
create table if not exists orq_canvas (like orq_projetos including all);
create table if not exists orq_maquinas (like orq_projetos including all);

create index if not exists orq_tarefas_estado on orq_tarefas ((dados ->> 'estado'));
create index if not exists orq_tarefas_projeto on orq_tarefas ((dados ->> 'projetoId'));

create table if not exists orq_sequencias (
  nome text primary key,
  valor bigint not null
);
create table if not exists orq_treinos (like orq_projetos including all);
