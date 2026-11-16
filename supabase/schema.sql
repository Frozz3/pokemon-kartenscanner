-- Pokémon Kartenscanner: Datenbank und Bildspeicher für EIN Konto (die App gehört einer Person)
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und einmal ausführen ("Run").
-- Das Skript kann gefahrlos mehrfach ausgeführt werden; die Sammlung bleibt erhalten.

-- ========== Tabellen ==========
-- Jede Zeile gehört genau einem Konto (user_id), der Inhalt liegt als JSON in "data".
create table if not exists public.cards (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.sessions (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.items (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- history: ein Schnappschuss pro Tag für die Wertentwicklung (id = Datum, z. B. 2026-10-26).
create table if not exists public.history (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- Ältere Installationen: Schlüssel war nur "id". Dann scheitert ein Import in ein zweites Konto, solange das
-- erste Konto dieselben Einträge noch hat. Hier auf (user_id, id) umstellen (einmalig, Daten bleiben erhalten).
do $$ declare t text; cn text; begin
  foreach t in array array['cards','sessions','items'] loop
    select conname into cn from pg_constraint
     where conrelid = format('public.%I', t)::regclass and contype = 'p' and cardinality(conkey) = 1;
    if cn is not null then
      execute format('alter table public.%I drop constraint %I', t, cn);
      execute format('alter table public.%I add primary key (user_id, id)', t);
    end if;
  end loop;
end $$;
create index if not exists cards_user_idx on public.cards (user_id);
create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists items_user_idx on public.items (user_id);

-- Profil des Kontos: Anzeigename. Geschrieben wird nur über die Funktion me() unten.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
-- Besitzer der App: darf ältere Foto-Ordner lesen (Werkzeuge → Wartung → Sammlung übernehmen).
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Nicht mehr gebraucht, seit die App nur noch ein Konto hat: Nutzerverwaltung und Verbrauchszählung.
drop function if exists public.admin_users();
drop function if exists public.admin_set_blocked(uuid, boolean);
drop function if exists public.admin_set_password(uuid, text);
drop function if exists public.admin_delete_user(uuid);
drop function if exists public.track_usage(integer, integer, integer);
drop table if exists public.usage;

-- ========== Hilfsfunktionen ==========
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
create or replace function public.is_blocked() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.blocked from public.profiles p where p.user_id = (select auth.uid())), false);
$$;

-- ========== Zugriffsregeln (Row Level Security) ==========
-- Angemeldete Nutzer sehen und ändern nur ihre eigenen Zeilen; gesperrte Konten gar nichts.
alter table public.cards enable row level security;
alter table public.sessions enable row level security;
alter table public.items enable row level security;
alter table public.history enable row level security;
alter table public.profiles enable row level security;
alter table public.admins enable row level security;

drop policy if exists "own cards" on public.cards;
create policy "own cards" on public.cards for all to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_blocked()))
  with check (user_id = (select auth.uid()) and not (select public.is_blocked()));
drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_blocked()))
  with check (user_id = (select auth.uid()) and not (select public.is_blocked()));
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_blocked()))
  with check (user_id = (select auth.uid()) and not (select public.is_blocked()));
drop policy if exists "own history" on public.history;
create policy "own history" on public.history for all to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_blocked()))
  with check (user_id = (select auth.uid()) and not (select public.is_blocked()));
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke all on public.admins from anon, authenticated;

-- ========== Bildspeicher ==========
-- Privater Speicher für die Kartenfotos (max. 5 MB pro Bild, nur JPEG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Fotos liegen unter <user-id>/<bild-id>.jpg; jeder darf nur seinen eigenen Ordner nutzen.
-- Der Besitzer darf auch ältere Ordner lesen und löschen (Sammlung eines früheren Kontos übernehmen).
drop policy if exists "own images select" on storage.objects;
create policy "own images select" on storage.objects for select to authenticated
  using (bucket_id = 'card-images' and (
    ((storage.foldername(name))[1] = (select auth.uid())::text and not (select public.is_blocked()))
    or (select public.is_admin())));
drop policy if exists "own images insert" on storage.objects;
create policy "own images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.is_blocked()));
drop policy if exists "own images update" on storage.objects;
create policy "own images update" on storage.objects for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.is_blocked()));
drop policy if exists "own images delete" on storage.objects;
create policy "own images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'card-images' and (
    ((storage.foldername(name))[1] = (select auth.uid())::text and not (select public.is_blocked()))
    or (select public.is_admin())));

-- ========== Schneller Abgleich ==========
-- Der Server stempelt jede Änderung mit seiner Uhrzeit; die App lädt nur, was sich seit dem letzten Mal geändert hat.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['cards','sessions','items','history'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('create index if not exists %I on public.%I (user_id, updated_at)', t || '_user_updated_idx', t);
  end loop;
end $$;

-- ========== Funktionen für die App ==========
-- Beim Anmelden: Profil anlegen, optional den Namen setzen; liefert Name und ob das Konto Besitzer ist.
create or replace function public.me(p_name text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  nm text := nullif(left(btrim(coalesce(p_name, '')), 40), '');
  r public.profiles;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- Das erste Konto wird Besitzer (auch wenn es erst nach dem Ausführen dieses Skripts angelegt wurde).
  insert into public.admins (user_id) select uid where not exists (select 1 from public.admins) on conflict do nothing;
  insert into public.profiles (user_id, name, last_seen) values (uid, nm, now())
  on conflict (user_id) do update set last_seen = now(), name = coalesce(nm, public.profiles.name)
  returning * into r;
  return json_build_object('name', r.name, 'blocked', r.blocked, 'since', r.created_at,
    'admin', exists (select 1 from public.admins a where a.user_id = uid));
end $$;

revoke all on function public.me(text), public.is_admin(), public.is_blocked() from public, anon;
grant execute on function public.me(text), public.is_admin(), public.is_blocked() to authenticated;

-- ========== Nur ein Konto ==========
-- Die App fragt beim Start, ob es schon ein Konto gibt: Wenn nicht, richtet sie es ein, sonst zeigt sie die Anmeldung.
create or replace function public.setup_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from auth.users);
$$;
revoke all on function public.setup_open() from public;
grant execute on function public.setup_open() to anon, authenticated;

-- Sobald es ein Konto gibt, lehnt der Server jedes weitere ab (auch wenn jemand die App umgeht).
-- Neues Konto statt des alten? Erst das alte unter Authentication → Users löschen.
create or replace function public.only_one_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'Diese App hat schon ein Konto.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.only_one_account() from public, anon, authenticated;
drop trigger if exists only_one_account on auth.users;
create trigger only_one_account before insert on auth.users
  for each row execute function public.only_one_account();

-- ========== Besitzer ==========
-- Solange es noch keinen gibt, wird das älteste Konto Besitzer (normalerweise deins).
-- Prüfen: select * from public.admins;  Ändern: insert into public.admins (user_id) values ('<Konto-ID>');
insert into public.admins (user_id)
select id from auth.users where not exists (select 1 from public.admins) order by created_at limit 1
on conflict do nothing;
