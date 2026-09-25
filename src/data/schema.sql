-- JVLN Intelligence: server-side schema for calibration and norming.
-- Not used by the client in this version (sessions stay on the device).
-- Designed for PostgreSQL / Supabase. No personal data is required.

create table participant (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  age_band text check (age_band in ('16-24','25-34','35-44','45-54','55-64','65+')),
  english_background text check (english_background in ('native','fluent','learner')),
  consent_version text not null
);

create table domain (
  id text primary key,
  name text not null,
  status text not null check (status in ('core','performance','metrics','experimental'))
);

create table paradigm (
  id text primary key,
  domain_id text not null references domain(id),
  grp text not null check (grp in ('core','performance','creativity','applied')),
  kind text not null check (kind in ('items','procedure')),
  version int not null
);

create table facet (
  id text primary key,
  paradigm_id text not null references paradigm(id)
);

create table test_form (
  id text primary key,
  mode text not null check (mode in ('quick','core','full','single')),
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create table experiment (
  id text primary key,
  description text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table session (
  id text primary key,
  participant_id uuid references participant(id),
  test_form_id text references test_form(id),
  experiment_id text references experiment(id),
  seed bigint not null,
  mode text not null,
  attempt int not null default 1,
  input text not null check (input in ('mouse','touch')),
  viewport text not null,
  browser text not null,
  reduced_motion boolean not null,
  status text not null check (status in ('active','complete','abandoned')),
  created_at timestamptz not null,
  completed_at timestamptz
);

-- Generated items are stored when administered so the exact instance can be reviewed.
create table item (
  id text primary key,
  paradigm_id text not null references paradigm(id),
  facet text not null,
  version int not null,
  level numeric not null,
  source jsonb not null,
  features jsonb not null,
  content jsonb not null,
  key jsonb not null,
  active boolean not null default true,
  exposure_count int not null default 0
);

create table item_parameter (
  item_or_level text not null,         -- item id for authored items, "paradigm:Lk" or feature model id for generators
  version int not null,
  a numeric not null,
  b numeric not null,
  c numeric not null,
  calibration text not null check (calibration in ('provisional','calibrated')),
  sample_size int,
  estimated_at timestamptz not null default now(),
  primary key (item_or_level, version)
);

create table response (
  id bigserial primary key,
  session_id text not null references session(id),
  item_id text not null references item(id),
  step_id text not null unique,
  issued_at timestamptz not null,
  answered_at timestamptz not null,
  response jsonb not null,
  correct boolean not null,
  rt_ms int not null,
  timed_out boolean not null,
  rapid boolean not null,
  excluded text,
  confidence numeric check (confidence between 0 and 1),
  parameter_version int not null
);

create table procedure_result (
  session_id text not null references session(id),
  paradigm_id text not null references paradigm(id),
  config jsonb not null,
  result jsonb not null,
  metrics jsonb not null,
  primary key (session_id, paradigm_id)
);

create table ability_estimate (
  session_id text not null references session(id),
  scope text not null,                 -- 'general', 'domain:<id>', 'paradigm:<id>'
  theta numeric not null,
  se numeric not null,
  n int not null,
  method text not null default 'EAP N(0,1.25^2)',
  parameter_version int not null,
  primary key (session_id, scope, parameter_version)
);

create table norm (
  id text primary key,
  scope text not null,
  population text not null,
  age_band text,
  sample_size int not null,
  table_data jsonb not null,           -- theta -> percentile mapping
  published_at timestamptz
);

create table score (
  session_id text not null references session(id),
  scope text not null,
  norm_id text references norm(id),
  rank text,
  percentile numeric,
  primary key (session_id, scope)
);

create table event (
  id bigserial primary key,
  session_id text not null references session(id),
  at timestamptz not null,
  type text not null,
  detail text
);

create index response_item_idx on response(item_id);
create index response_session_idx on response(session_id);
