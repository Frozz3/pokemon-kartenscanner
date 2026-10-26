-- Pokémon Kartenscanner: Datenbank und Bildspeicher
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und einmal ausführen ("Run").
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.

-- Tabellen: jede Zeile gehört genau einem Konto (user_id), der Inhalt liegt als JSON in "data".
create table if not exists public.cards (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.items (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists cards_user_idx on public.cards (user_id);
create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists items_user_idx on public.items (user_id);

-- Row Level Security: angemeldete Nutzer sehen und ändern nur ihre eigenen Zeilen.
alter table public.cards enable row level security;
alter table public.sessions enable row level security;
alter table public.items enable row level security;

drop policy if exists "own cards" on public.cards;
create policy "own cards" on public.cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Privater Bildspeicher für die Kartenfotos (max. 5 MB pro Bild, nur JPEG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Fotos liegen unter <user-id>/<bild-id>.jpg; jeder darf nur seinen eigenen Ordner nutzen.
drop policy if exists "own images select" on storage.objects;
create policy "own images select" on storage.objects for select to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own images insert" on storage.objects;
create policy "own images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own images update" on storage.objects;
create policy "own images update" on storage.objects for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own images delete" on storage.objects;
create policy "own images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
