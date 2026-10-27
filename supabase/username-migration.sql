-- Pokémon Kartenscanner: bestehendes Konto von E-Mail auf Benutzernamen umstellen.
-- Danach steht deine echte E-Mail-Adresse nirgends mehr in der Datenbank, nur noch
-- "u-<SHA-256-Hash des Benutzernamens>@kartenscanner.invalid".
--
-- 1. Unten deinen gewünschten Benutzernamen und deine aktuelle E-Mail eintragen.
--    Benutzername: 3–32 Zeichen, nur a–z, 0–9, Punkt, Minus, Unterstrich.
-- 2. Im Supabase "SQL Editor" einfügen und "Run" klicken.
-- 3. In der App ab jetzt mit Benutzername + bisherigem Passwort anmelden.

do $$
declare
  v_username text := lower(trim('DEIN_BENUTZERNAME'));
  v_old      text := lower(trim('deine.alte@email.de'));
  v_new      text;
  v_id       uuid;
begin
  if v_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'Ungültiger Benutzername: 3–32 Zeichen, nur a–z, 0–9, Punkt, Minus, Unterstrich.';
  end if;

  -- Gleiche Formel wie in app.js (loginIdOf)
  v_new := 'u-' || encode(extensions.digest('kartenscanner:' || v_username, 'sha256'), 'hex') || '@kartenscanner.invalid';

  select id into v_id from auth.users where lower(email) = v_old;
  if v_id is null then
    raise exception 'Kein Konto mit der E-Mail % gefunden.', v_old;
  end if;
  if exists (select 1 from auth.users where lower(email) = v_new) then
    raise exception 'Dieser Benutzername ist schon vergeben.';
  end if;

  -- Login-Kennung ersetzen und Kopien der E-Mail aus den Metadaten entfernen
  update auth.users
     set email = v_new,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'email',
         email_change = '', email_change_token_new = '', email_change_token_current = ''
   where id = v_id;

  update auth.identities
     set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_new)),
         provider_id = case when lower(provider_id) = v_old then v_new else provider_id end
   where user_id = v_id;

  -- Alte Einträge, die die E-Mail noch enthalten (Protokoll, offene Einmal-Links)
  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload::text ilike $1' using '%' || v_old || '%';
  end if;
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using v_id;
  end if;

  raise notice 'Fertig. Melde dich in der App mit dem Benutzernamen "%" an.', v_username;
end $$;

-- Kontrolle: hier darf keine echte E-Mail-Adresse mehr auftauchen.
select id, email, raw_user_meta_data from auth.users;
