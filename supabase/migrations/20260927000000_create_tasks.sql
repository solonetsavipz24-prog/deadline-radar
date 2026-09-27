create extension if not exists "pgcrypto";

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  subject text not null check (char_length(trim(subject)) between 1 and 100),
  due_at timestamptz not null,
  description text not null default '',
  link text not null default '' check (link = '' or link ~* '^https?://'),
  status text not null default 'todo' check (status in ('todo', 'progress', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  repeat_rule text not null default 'none' check (repeat_rule in ('none', 'daily', 'weekly', 'monthly')),
  repeat_day smallint check (repeat_day between 1 and 31),
  remind boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_due_at_idx on public.tasks (user_id, due_at);
alter table public.tasks enable row level security;

drop policy if exists "Users can view their own tasks" on public.tasks;
create policy "Users can view their own tasks"
  on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own tasks" on public.tasks;
create policy "Users can create their own tasks"
  on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own tasks" on public.tasks;
create policy "Users can update their own tasks"
  on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own tasks" on public.tasks;
create policy "Users can delete their own tasks"
  on public.tasks for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_task_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_task_updated_at();

grant usage on schema public to authenticated;
revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;
