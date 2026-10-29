# Pokémon Kartenscanner

Web-App fürs Handy: Pokémon-Karten mit der Kamera scannen, mit aktuellen Cardmarket-Preisen bewerten und in einem Inventar sammeln.

**Live:** https://frozz3.github.io/pokemon-kartenscanner/

## Funktionen

- **Scan-Sessions:** Karten nacheinander scannen (Live-Kamera mit Kartenrahmen oder Fotos aus der Galerie). Die Kamera löst automatisch aus, sobald eine neue Karte ruhig im Rahmen liegt, zeigt den Preis direkt am Rahmen an und spielt einen Kassen-Sound (abschaltbar; bei stummgeschaltetem iPhone kein Ton). Am Ende zeigt die Session den Endbetrag und übernimmt alle Karten ins Inventar. Gleiche Karten werden zusammengezählt.
- **Erkennung per KI:** Claude erkennt Name, Set, Nummer, Sprache, Variante und Zustand. Dafür ist ein eigener Anthropic-API-Schlüssel nötig.
- **Manuelle Suche:** Ohne Schlüssel oder bei falscher Erkennung lässt sich jede Karte über Name und Nummer in der Datenbank suchen.
- **Echte Marktpreise:** Cardmarket-Trendpreis, Ab-Preis und Durchschnitte über 1, 7 und 30 Tage aus [TCGdex](https://tcgdex.dev), dazu der TCGplayer-Preis in USD. Reverse Holos bekommen den Reverse-Holo-Preis.
- **Inventar:** Kartenraster mit eigenem Foto und offiziellem Kartenbild, Suche, Sortierung, Detailansicht, Preise aktualisieren.
- **Duplikat-Hinweis:** Schon in der Session gescannte Karten werden in der Kamera (mit Warnton) und in der Liste markiert, ebenso Karten, die schon im Inventar sind.
- **Wertentwicklung:** Täglicher Schnappschuss des Sammlungswerts, automatische Preisaktualisierung einmal am Tag, Kurve, Veränderung über 7 und 30 Tage, Gewinner und Verlierer, Preisverlauf je Karte.
- **Set-Fortschritt:** Pro Set „47/189“ mit Fortschrittsbalken, deutsche Set- und Kartennamen mit deutschen Kartenbildern (englischer Fallback), Sets sortierbar nach Fortschritt, Wert, fehlenden Karten, Name oder Erscheinungsjahr. In der Set-Ansicht Karten nach Preis oder Nummer sortieren und nach Preisspanne filtern, mit Summe der Auswahl und Kosten zum Vervollständigen.
- **Verlauf** aller abgeschlossenen Sessions.
- **Für alle nutzbar:** Jeder kann sich selbst registrieren (Name optional), bekommt eine kurze Begrüßung und eine Schritt-für-Schritt-Hilfe für den eigenen Erkennungs-Schlüssel (wird vor dem Speichern geprüft und gilt nur für das eigene Konto). Die Oberfläche zeigt nur, was man zum Sammeln braucht; Technik-Angaben gibt es nur im Admin-Bereich.
- **Admin-Bereich** (nur für Admins, unter Einstellungen): **Nutzer** (Konten mit Karten, Sammlungswert, Scans und KI-Verbrauch; vorläufiges Passwort setzen, sperren, löschen), **Tests** (Verbindungstest, Test-Scan mit KI-Rohantwort, Preis-Abfrage, Diagnose), **Technik** (Schalter für Technik-Details in der ganzen App, Preis- und Datenstatus), **Wartung** (alle Preise neu laden, Zwischenspeicher leeren, Backup, Fehlerprotokoll).
- **Konto mit Login:** E-Mail und Passwort, Daten und Fotos dauerhaft in Supabase gespeichert und auf jedem Gerät verfügbar. **E-Mail und Passwort werden auf dem Gerät gehasht** (PBKDF2-SHA-256); in der Datenbank steht nur `e-<hash>@kartenscanner.invalid`, und Supabase speichert den Passwort-Hash zusätzlich mit bcrypt. Das echte Passwort verlässt nie das Gerät. Ältere Logins (Benutzername, unverhashtes Passwort) funktionieren weiter und werden beim Anmelden automatisch umgestellt. Daten aus der alten Version ohne Konto lassen sich beim ersten Login übernehmen.
- **Automatische Abmeldung** beim Schließen der App (abschaltbar) und nach einstellbarer Zeit ohne Aktivität (5 Min. bis 1 Std., Standard 15 Min.), mit Warnung 30 Sekunden vorher; nicht während Scans oder Preisaktualisierungen.
- **Sicherungsdatei:** Export und Import als JSON-Datei (ohne Fotos).
- **Design im iOS-Stil** mit Systemschrift, großen Titeln, die beim Scrollen in die Leiste wandern, gruppierten Listen und Einstellungen wie in der Einstellungen-App (mit Schaltern für Auto-Auslöser und Ton); **Hell, Dunkel oder Automatisch** (in den Einstellungen; Standard: wie das System).
- **Bewegung wie auf dem iPhone:** Fenster gleiten von unten herein und lassen sich nach unten wegwischen, Knöpfe federn beim Tippen, Seitenwechsel blenden weich über. Am Ende einer Session zählt der Endbetrag hoch, landet mit Kassen-Sound und einem Münzregen. Eigener Startbildschirm (hell und dunkel) für alle aktuellen iPhones. Wer in iOS „Bewegung reduzieren“ eingeschaltet hat, bekommt keine Animationen.
- **Schnell:** Die App merkt sich deine Daten auf dem Gerät und zeigt sie sofort beim Start, auch ohne Verbindung. Danach lädt sie nur, was sich seit dem letzten Mal geändert hat (einmal am Tag zur Sicherheit alles). Sessions werden gebündelt gespeichert, Preise parallel aktualisiert; gleiche Karten werden dabei nur einmal abgefragt.
- Funktioniert als installierbare Web-App (PWA), die App-Oberfläche lädt auch offline.

## Als iOS-App (Sideloading, ohne Mac)

Dieselbe App gibt es auch als echte iOS-App: eigenes Icon und Startbildschirm, kein Safari drumherum, Kamera-Erlaubnis bleibt gespeichert, Vibration beim Scannen, Löschen und am Session-Ende, Backup über das iOS-Teilen-Menü.

GitHub baut sie bei jeder Änderung automatisch auf einem Mac in der Cloud (Workflow `.github/workflows/ios-app.yml`) und legt die neueste Datei hier ab:
**https://github.com/Frozz3/pokemon-kartenscanner/releases/download/ios-latest/Kartenscanner.ipa**

Installation mit dem Windows-PC und einer kostenlosen Apple-ID:

1. **iTunes** von apple.com installieren (nicht die Microsoft-Store-Version), danach **Sideloadly** von sideloadly.io.
2. iPhone per USB anschließen, entsperren und „Vertrauen“ tippen.
3. In Sideloadly die `Kartenscanner.ipa` hineinziehen, deine Apple-ID eintragen, **Start** klicken und das Apple-ID-Passwort eingeben.
4. Auf dem iPhone: **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus** einschalten (Neustart, dann bestätigen).
5. **Einstellungen → Allgemein → VPN & Geräteverwaltung** → deine Apple-ID → **Vertrauen**.
6. App öffnen, anmelden, API-Schlüssel eintragen. Die Daten kommen wie gewohnt aus deinem Konto.

Wichtig bei einer kostenlosen Apple-ID:

- Die Signatur gilt **7 Tage**. Danach startet die App nicht mehr, bis du sie neu aufspielst (Schritt 3 mit der neuesten `.ipa`). Deine Daten bleiben dabei erhalten, weil sie in deinem Konto liegen. Mit der neuesten Datei bekommst du gleich alle Updates mit.
- Höchstens 3 selbst installierte Apps gleichzeitig.
- Die App zeigt unter Einstellungen → App ihre Version und meldet, wenn eine neuere bereitliegt.
- Mit einem bezahlten Apple-Entwicklerkonto (99 €/Jahr) gilt die Signatur 1 Jahr.

Die Web-Version unter der Live-Adresse funktioniert parallel weiter.

## Auf dem iPhone installieren

1. Die Live-Adresse in **Safari** öffnen.
2. Teilen-Symbol → **Zum Home-Bildschirm**.
3. App vom Home-Bildschirm starten, Zahnrad oben rechts → API-Schlüssel eintragen.

Auf Android: in Chrome öffnen → Menü → **App installieren**.

## API-Schlüssel (für die Erkennung per Foto)

1. In der [Anthropic Console](https://console.anthropic.com/settings/keys) einen Schlüssel erstellen und Guthaben aufladen.
2. Am besten ein monatliches Ausgabelimit setzen.
3. In der App unter Einstellungen eintragen.

Der Schlüssel wird **nur im Browser des Geräts** gespeichert (localStorage) und direkt an `api.anthropic.com` gesendet. Er steht nie im Code oder im Repository. Jeder Scan verbraucht etwas API-Guthaben; Haiku ist günstiger, Sonnet genauer.

## Daten und Login (Supabase)

Inventar, Sessions und Fotos liegen in einem eigenen, kostenlosen [Supabase](https://supabase.com)-Projekt. Jeder sieht nur seine eigenen Daten (Row Level Security). Statt deiner E-Mail-Adresse steht in der Login-Verwaltung nur ein Hash. Das ist eine Pseudonymisierung: Wer Zugriff auf die Datenbank hat und deine E-Mail-Adresse bereits kennt, könnte prüfen, ob sie dazu passt; aus dem Hash zurückrechnen lässt sie sich nicht.

Einrichtung:

1. Auf supabase.com ein Konto anlegen → **New project**, Region **Central EU (Frankfurt)**.
2. **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Authentication → URL Configuration:** Site URL `https://frozz3.github.io/pokemon-kartenscanner/`, dieselbe Adresse auch unter Redirect URLs eintragen.
4. **Project Settings → API:** Project URL und den `anon`/`publishable` Key in [`config.js`](config.js) eintragen. Den `service_role`/`secret` Key niemals verwenden.
5. **Authentication → Sign In / Providers → „Confirm email“ ausschalten** (Supabase kennt nur den Hash, eine Bestätigungs-Mail käme nie an).
6. **„Allow new users to sign up“ eingeschaltet lassen**, damit sich andere selbst registrieren können. (Soll die App privat bleiben: ausschalten.)
7. In der App registrieren. **Das älteste Konto wird automatisch Admin** (beim Ausführen von `schema.sql`, solange es noch keinen Admin gibt). Prüfen mit `select * from public.admins;`, weitere Admins mit `insert into public.admins (user_id) values ('<Konto-ID aus Authentication → Users>');`.

**Schon eingerichtet?** Nach Updates den Inhalt von `schema.sql` einfach noch einmal im SQL Editor ausführen. Das ist gefahrlos, vorhandene Daten bleiben erhalten; es ergänzt Profile, Sperren, Verbrauchszähler, Admin-Funktionen und den Zeitstempel-Trigger für den schnellen Abgleich.

Hinweis: Supabase pausiert kostenlose Projekte nach etwa einer Woche ohne Nutzung. Ein Klick auf „Restore“ im Dashboard holt das Projekt mit allen Daten zurück.

### Bestehendes Konto auf E-Mail-Hash umstellen

In der App: Einstellungen → Konto → **E-Mail-Anmeldung einrichten**. Die App rechnet den Hash auf dem Gerät aus und versucht, die Login-Kennung direkt zu ändern. Verlangt Supabase dafür eine Bestätigungs-Mail, zeigt die App stattdessen zwei SQL-Befehle zum Kopieren an (sie enthalten nur den Hash), die du im SQL Editor ausführst.

### Passwort vergessen

Ohne gespeicherte E-Mail-Adresse gibt es keinen Reset-Link. Für andere Nutzer: Admin-Bereich → Nutzer → Konto → **Vorläufiges Passwort setzen** und der Person sagen; sie ändert es danach unter Einstellungen → Passwort ändern.

Für dein eigenes Admin-Konto im SQL Editor ein vorläufiges Passwort setzen; die App akzeptiert es beim nächsten Login und stellt es sofort auf den Hash um:

```sql
update auth.users
   set encrypted_password = extensions.crypt('VORLAEUFIGES_PASSWORT', extensions.gen_salt('bf'))
 where email like 'e-%@kartenscanner.invalid';   -- bei mehreren Konten die genaue Kennung aus Authentication → Users nehmen
```

Danach in der App unter Einstellungen → **Passwort ändern** ein neues Passwort festlegen.

## Sicherheit

- Im Repository stehen keine Geheimnisse, nur der öffentliche Supabase-Schlüssel. Deine Daten schützt die Row Level Security; der Anthropic-Schlüssel bleibt auf dem Gerät und gilt nur für das Konto, mit dem er eingetragen wurde.
- **Content Security Policy** (in `index.html`): Die App lädt nur eigene Dateien und spricht nur mit Supabase, TCGdex, Anthropic und GitHub (Update-Prüfung). Eingeschleuster Code und Anfragen an fremde Server werden blockiert. Wer das kleine Inline-Skript im `<head>` ändert, muss den Hash in der Policy anpassen.
- Der App-Build nutzt nur GitHubs eigene Actions, fest auf geprüfte Versionen (Commit) gepinnt.
- Jedes Konto sieht nur seine eigenen Daten (Row Level Security). Gesperrte Konten kommen an nichts mehr heran. Admins sehen von anderen nur Zahlen (Kartenanzahl, Wert, Scans), keine Karten oder Fotos; alle Admin-Funktionen prüfen die Rechte auf dem Server.
- Offene Registrierung: Supabase begrenzt Anmeldeversuche pro IP. Wer einen Spam-Schutz will, kann unter Authentication → Attack Protection ein CAPTCHA aktivieren (braucht dann eine kleine Anpassung in der App).
- Für Sideloadly/SideStore am besten eine zweite Apple-ID nehmen, nicht die Haupt-ID.

## Technik

Reines HTML, CSS und JavaScript ohne Build-Schritt:

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst |
| `styles.css` | Gestaltung im iOS-Stil, hell und dunkel |
| `app.js` | Logik: Login, Speicher, Kamera, Erkennung, Preise, Oberfläche |
| `config.js` | Supabase-Adresse und öffentlicher Schlüssel |
| `supabase/schema.sql` | Tabellen, Zugriffsregeln und Bildspeicher |
| `supabase/username-migration.sql` | Ältere Variante: Konto auf Benutzernamen umstellen (nicht mehr nötig) |
| `vendor/supabase.js` | Supabase-Client 2.117.3 (MIT-Lizenz) |
| `sw.js` | Service Worker für Offline-Start |
| `package.json`, `capacitor.config.json` | iOS-App-Hülle (Capacitor 8) |
| `scripts/` | Web-Dateien für die App vorbereiten, Xcode-Projekt anpassen |
| `resources/` | App-Icon und Startbilder der iOS-App |
| `.github/workflows/ios-app.yml` | Baut die unsignierte `.ipa` und veröffentlicht sie als Release `ios-latest` |
| `manifest.webmanifest`, `icons/` | PWA-Angaben, App-Icons und Startbilder (`icons/splash/`) |

GitHub Pages: Settings → Pages → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.

## Hinweis

Privates Fanprojekt. Pokémon und alle Kartennamen sind Marken von Nintendo, Creatures und GAME FREAK. Preisdaten: TCGdex / Cardmarket, ohne Gewähr.
