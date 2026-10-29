-- Pokémon Kartenscanner: Datenbank, Bildspeicher, Nutzerverwaltung
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und einmal ausführen ("Run").
-- Das Skript kann gefahrlos mehrfach ausgeführt werden; vorhandene Daten bleiben erhalten.

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

-- Profil je Konto: Anzeigename, Sperre, zuletzt aktiv. Nutzer lesen nur ihr eigenes Profil;
-- geschrieben wird ausschließlich über die Funktionen unten (eine Sperre kann sich niemand selbst aufheben).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
-- Wer den Admin-Bereich sieht. Kein Zugriff aus der App, nur über die Funktionen unten.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
-- Verbrauch: Scans und KI-Tokens pro Konto und Tag (jeder nutzt seinen eigenen API-Schlüssel).
create table if not exists public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  scans integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

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
alter table public.usage enable row level security;

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
drop policy if exists "own usage read" on public.usage;
create policy "own usage read" on public.usage for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.profiles, public.usage from anon, authenticated;
revoke all on public.admins from anon, authenticated;

-- ========== Bildspeicher ==========
-- Privater Speicher für die Kartenfotos (max. 5 MB pro Bild, nur JPEG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Fotos liegen unter <user-id>/<bild-id>.jpg; jeder darf nur seinen eigenen Ordner nutzen.
-- Admins dürfen alle Fotos lesen (zum Wiederherstellen eines Kontos) und löschen (zum Entfernen eines Kontos).
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
-- Beim Anmelden: Profil anlegen bzw. "zuletzt aktiv" setzen, optional den Namen; liefert Name, Sperre, Admin.
create or replace function public.me(p_name text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  nm text := nullif(left(btrim(coalesce(p_name, '')), 40), '');
  r public.profiles;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.profiles (user_id, name, last_seen) values (uid, nm, now())
  on conflict (user_id) do update set last_seen = now(), name = coalesce(nm, public.profiles.name)
  returning * into r;
  return json_build_object('name', r.name, 'blocked', r.blocked, 'since', r.created_at,
    'admin', exists (select 1 from public.admins a where a.user_id = uid));
end $$;

-- Nach jedem Scan: Verbrauch hochzählen (nur für das eigene Konto, mit Obergrenzen gegen Unsinn).
create or replace function public.track_usage(p_scans integer, p_in integer, p_out integer) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null or public.is_blocked() then return; end if;
  insert into public.usage (user_id, day, scans, input_tokens, output_tokens)
  values (uid, current_date, greatest(0, least(coalesce(p_scans, 0), 50)), greatest(0, least(coalesce(p_in, 0), 2000000)), greatest(0, least(coalesce(p_out, 0), 200000)))
  on conflict (user_id, day) do update set
    scans = public.usage.scans + excluded.scans,
    input_tokens = public.usage.input_tokens + excluded.input_tokens,
    output_tokens = public.usage.output_tokens + excluded.output_tokens;
end $$;

-- ========== Admin-Funktionen (prüfen selbst, ob der Aufrufer Admin ist) ==========
create or replace function public.admin_users() returns table (
  user_id uuid, login text, name text, created_at timestamptz, last_sign_in_at timestamptz, last_seen timestamptz,
  blocked boolean, admin boolean, cards bigint, card_qty bigint, sessions bigint, value numeric,
  scans bigint, scans_30d bigint, input_tokens bigint, output_tokens bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, p.name, u.created_at, u.last_sign_in_at, p.last_seen,
    coalesce(p.blocked, false),
    exists (select 1 from public.admins a where a.user_id = u.id),
    (select count(*) from public.cards c where c.user_id = u.id)::bigint,
    (select coalesce(sum(case when jsonb_typeof(c.data->'qty') = 'number' then (c.data->>'qty')::numeric else 1 end), 0) from public.cards c where c.user_id = u.id)::bigint,
    (select count(*) from public.sessions s where s.user_id = u.id and s.data->>'status' = 'done')::bigint,
    (select coalesce(sum(case when jsonb_typeof(c.data->'priceEur') = 'number'
        then (c.data->>'priceEur')::numeric * (case when jsonb_typeof(c.data->'qty') = 'number' then (c.data->>'qty')::numeric else 1 end) else 0 end), 0)
       from public.cards c where c.user_id = u.id)::numeric(12,2),
    (select coalesce(sum(x.scans), 0) from public.usage x where x.user_id = u.id)::bigint,
    (select coalesce(sum(x.scans), 0) from public.usage x where x.user_id = u.id and x.day > current_date - 30)::bigint,
    (select coalesce(sum(x.input_tokens), 0) from public.usage x where x.user_id = u.id)::bigint,
    (select coalesce(sum(x.output_tokens), 0) from public.usage x where x.user_id = u.id)::bigint
  from auth.users u left join public.profiles p on p.user_id = u.id
  order by u.created_at;
end $$;

-- Konto sperren/entsperren. Sperren beendet auch die laufenden Anmeldungen des Kontos.
create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'Du kannst dein eigenes Konto nicht sperren.'; end if;
  insert into public.profiles (user_id, blocked) values (p_user, coalesce(p_blocked, false))
  on conflict (user_id) do update set blocked = excluded.blocked;
  if p_blocked and to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end $$;

-- Vorläufiges Passwort setzen (die App schickt es bereits gehasht, wie beim Login).
create or replace function public.admin_set_password(p_user uuid, p_hash text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_hash is null or length(p_hash) < 20 then raise exception 'Ungültiges Passwort.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_hash, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then raise exception 'Konto nicht gefunden.'; end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end $$;

-- Konto mit allen Daten löschen (die App entfernt vorher die Fotos des Kontos).
create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'Du kannst dein eigenes Konto hier nicht löschen.'; end if;
  delete from auth.users where id = p_user;
  if not found then raise exception 'Konto nicht gefunden.'; end if;
end $$;

revoke all on function public.me(text), public.track_usage(integer, integer, integer), public.admin_users(),
  public.admin_set_blocked(uuid, boolean), public.admin_set_password(uuid, text), public.admin_delete_user(uuid),
  public.is_admin(), public.is_blocked() from public, anon;
grant execute on function public.me(text), public.track_usage(integer, integer, integer), public.admin_users(),
  public.admin_set_blocked(uuid, boolean), public.admin_set_password(uuid, text), public.admin_delete_user(uuid),
  public.is_admin(), public.is_blocked() to authenticated;

-- ========== Erster Admin ==========
-- Solange es noch keinen Admin gibt, wird das älteste Konto Admin (normalerweise deins).
-- Prüfen: select * from public.admins;  Ändern: insert into public.admins (user_id) values ('<Konto-ID>');
insert into public.admins (user_id)
select id from auth.users where not exists (select 1 from public.admins) order by created_at limit 1
on conflict do nothing;
