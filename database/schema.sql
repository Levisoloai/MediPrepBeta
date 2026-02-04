
-- 1. PROFILES
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  avatar_url text,
  subscription_status text default 'inactive', -- 'active', 'inactive', 'past_due'
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 1b. ADMIN USERS (Beta analytics access)
create table if not exists admin_users (
  user_id uuid references profiles(id) on delete cascade primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. SUBJECTS
create table if not exists subjects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. STUDY FILES (PDFs/Images metadata)
create table if not exists study_files (
  id uuid default gen_random_uuid() primary key,
  subject_id uuid references subjects(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  file_name text not null,
  file_type text not null, -- 'lecture' or 'blueprint'
  storage_path text not null,
  mime_type text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. BLUEPRINT SESSIONS (Saved breakdowns)
create table if not exists blueprint_sessions (
  subject_id uuid references subjects(id) on delete cascade primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  breakdown_data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 5. QUESTIONS (Bank)
create table if not exists questions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  subject_id uuid references subjects(id) on delete set null,
  question_text text not null,
  question_type text not null,
  difficulty text,
  options jsonb, -- Array of strings
  correct_answer text not null,
  explanation text,
  study_concepts text[],
  card_style text default 'BASIC',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. SRS PROGRESS (Spaced Repetition)
create table if not exists srs_progress (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  question_id uuid references questions(id) on delete cascade unique not null,
  interval float default 0,
  repetition integer default 0,
  ease_factor float default 2.5,
  learning_step integer default 0,
  next_review_date timestamp with time zone default timezone('utc'::text, now()) not null,
  last_reviewed_date timestamp with time zone,
  attempts integer default 0,
  correct_count integer default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 7. CONCEPT MASTERY (Analytics)
create table if not exists concept_mastery (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  concept text not null,
  total_attempts integer default 0,
  correct_attempts integer default 0,
  last_tested_date timestamp with time zone default timezone('utc'::text, now()),
  unique(user_id, concept)
);

-- 8. STUDY PLANS (Persistent Calendar/Schedule)
create table if not exists study_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  subject_id uuid references subjects(id) on delete cascade,
  plan_name text,
  items jsonb not null, -- Array of StudyPlanItem
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 9. QUESTION FEEDBACK (Beta QA)
create table if not exists question_feedback (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  question_id text not null,
  kind text not null check (kind in ('rating','bug')),
  rating smallint,
  tags text[],
  comment text,
  selected_option text,
  is_correct boolean,
  time_spent_ms integer,
  payload jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (user_id, question_id, kind)
);

-- 10. STUDY GUIDE CACHE (Prefab Questions)
create table if not exists study_guide_cache (
  guide_hash text primary key,
  guide_title text,
  items jsonb not null,
  questions jsonb not null,
  model text,
  prompt_version text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS POLICIES
alter table profiles enable row level security;
alter table admin_users enable row level security;
alter table subjects enable row level security;
alter table study_files enable row level security;
alter table blueprint_sessions enable row level security;
alter table questions enable row level security;
alter table srs_progress enable row level security;
alter table concept_mastery enable row level security;
alter table study_plans enable row level security;
alter table question_feedback enable row level security;
alter table study_guide_cache enable row level security;

-- Simple All-in-one policies for demo
-- Dropping existing policies first ensures the script is idempotent and fixes "policy already exists" errors.

drop policy if exists "Users manage own profiles" on profiles;
create policy "Users manage own profiles" on profiles for all using (auth.uid() = id);

drop policy if exists "Users manage own admin access" on admin_users;
create policy "Users manage own admin access" on admin_users for select using (auth.uid() = user_id);

drop policy if exists "Users manage own subjects" on subjects;
create policy "Users manage own subjects" on subjects for all using (auth.uid() = user_id);

drop policy if exists "Users manage own files" on study_files;
create policy "Users manage own files" on study_files for all using (auth.uid() = user_id);

drop policy if exists "Users manage own blueprints" on blueprint_sessions;
create policy "Users manage own blueprints" on blueprint_sessions for all using (auth.uid() = user_id);

drop policy if exists "Users manage own questions" on questions;
create policy "Users manage own questions" on questions for all using (auth.uid() = user_id);

drop policy if exists "Users manage own srs" on srs_progress;
create policy "Users manage own srs" on srs_progress for all using (auth.uid() = user_id);

drop policy if exists "Users manage own mastery" on concept_mastery;
create policy "Users manage own mastery" on concept_mastery for all using (auth.uid() = user_id);

drop policy if exists "Users manage own study plans" on study_plans;
create policy "Users manage own study plans" on study_plans for all using (auth.uid() = user_id);

drop policy if exists "Users view own or admin feedback" on question_feedback;
drop policy if exists "Users insert own feedback" on question_feedback;
drop policy if exists "Users update own feedback" on question_feedback;
drop policy if exists "Users delete own feedback" on question_feedback;

create policy "Users view own or admin feedback" on question_feedback
  for select
  using (
    auth.uid() = user_id
    or exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  );

create policy "Users insert own feedback" on question_feedback
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own feedback" on question_feedback
  for update
  using (auth.uid() = user_id);

create policy "Users delete own feedback" on question_feedback
  for delete
  using (auth.uid() = user_id);

drop policy if exists "Users read study guide cache" on study_guide_cache;
drop policy if exists "Admins manage study guide cache" on study_guide_cache;

create policy "Users read study guide cache" on study_guide_cache
  for select
  using (auth.uid() is not null);

create policy "Admins manage study guide cache" on study_guide_cache
  for all
  using (
    exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  )
  with check (
    exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  );

-- Deep dive prefab cache (admin write, user read)
create table if not exists deep_dive_cache (
  topic_key text primary key,
  topic_context text not null,
  concept text not null,
  lesson_content text not null,
  quiz jsonb not null,
  model text,
  created_at timestamptz default now()
);

-- 11. GOLD QUESTIONS (Clinician-reviewed set)
create table if not exists gold_questions (
  id uuid default gen_random_uuid() primary key,
  module text not null,
  question jsonb not null,
  status text not null default 'draft',
  author_id uuid references profiles(id) on delete set null,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz default now()
);

alter table gold_questions enable row level security;

drop policy if exists "Users read gold questions" on gold_questions;
drop policy if exists "Admins manage gold questions" on gold_questions;

create policy "Users read gold questions" on gold_questions
  for select
  using (auth.uid() is not null);

create policy "Admins manage gold questions" on gold_questions
  for all
  using (
    exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  )
  with check (
    exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  );

-- 12. USER SEEN QUESTIONS (Deduping)
create table if not exists user_seen_questions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  module text not null,
  source_type text,
  question_id text,
  fingerprint text not null,
  created_at timestamptz default now(),
  unique (user_id, module, fingerprint)
);

alter table user_seen_questions enable row level security;

drop policy if exists "Users read own seen questions" on user_seen_questions;
drop policy if exists "Users insert own seen questions" on user_seen_questions;

create policy "Users read own seen questions" on user_seen_questions
  for select
  using (auth.uid() = user_id);

create policy "Users insert own seen questions" on user_seen_questions
  for insert
  with check (auth.uid() = user_id);

alter table deep_dive_cache enable row level security;

drop policy if exists "Users read deep dive cache" on deep_dive_cache;
drop policy if exists "Admins manage deep dive cache" on deep_dive_cache;

create policy "Users read deep dive cache" on deep_dive_cache
  for select
  using (auth.uid() is not null);

create policy "Admins manage deep dive cache" on deep_dive_cache
  for all
  using (
    exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  )
  with check (
    exists (select 1 from admin_users where admin_users.user_id = auth.uid())
  );
