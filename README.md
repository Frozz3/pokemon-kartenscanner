# Pokémon Kartenscanner

App fürs iPhone: Pokémon-Karten mit der Kamera scannen, mit aktuellen Cardmarket-Preisen bewerten und in einem Inventar sammeln. Jede App gehört **einer Person**: ein Konto, einmal anmelden, danach bleibt man angemeldet. Wer sie auch nutzen will, baut sich eine **eigene Instanz** mit eigenem Server und eigener App bauen, ohne Code zu ändern (siehe [Eigene Instanz](#eigene-instanz-selbst-hosten)).

## Funktionen

- **Scan-Sessions:** Karten nacheinander scannen (Live-Kamera mit Kartenrahmen oder Fotos aus der Galerie). Die Kamera löst automatisch aus, sobald eine neue Karte ruhig im Rahmen liegt, zeigt den Preis direkt am Rahmen an und spielt einen Kassen-Sound (abschaltbar; bei stummgeschaltetem iPhone kein Ton). Am Ende zeigt die Session den Endbetrag und übernimmt alle Karten ins Inventar. Gleiche Karten werden zusammengezählt.
- **Erkennung per KI:** Claude erkennt Name, Set, Nummer, Sprache, Variante und Zustand. Dafür ist ein eigener Anthropic-API-Schlüssel nötig.
- **Manuelle Suche:** Ohne Schlüssel oder bei falscher Erkennung lässt sich jede Karte über Name und Nummer in der Datenbank suchen.
- **Echte Marktpreise:** Cardmarket-Trendpreis, Ab-Preis und Durchschnitte über 1, 7 und 30 Tage aus [TCGdex](https://tcgdex.dev), dazu der TCGplayer-Preis in USD. Reverse Holos bekommen den Reverse-Holo-Preis.
- **Aufbau:** Drei Bereiche in der Leiste unten: **Sammlung** (umschaltbar zwischen Karten und Sets), ein großer **Scan-Knopf** in der Mitte und **Wert & Verlauf**. Die App startet in der Sammlung.
- **Inventar:** Kartenraster mit eigenem Foto und offiziellem Kartenbild, Suche, Sortierung, Detailansicht, Preise aktualisieren.
- **Duplikat-Hinweis:** Schon in der Session gescannte Karten werden in der Kamera (mit Warnton) und in der Liste markiert, ebenso Karten, die schon im Inventar sind.
- **Wertentwicklung:** Täglicher Schnappschuss des Sammlungswerts, automatische Preisaktualisierung einmal am Tag, Kurve, Veränderung über 7 und 30 Tage, Gewinner und Verlierer, Preisverlauf je Karte.
- **Set-Fortschritt:** Pro Set „47/189“ mit Fortschrittsbalken, deutsche Set- und Kartennamen mit deutschen Kartenbildern (englischer Fallback), Sets sortierbar nach Fortschritt, Wert, fehlenden Karten, Name oder Erscheinungsjahr. In der Set-Ansicht Karten nach Preis oder Nummer sortieren und nach Preisspanne filtern, mit Summe der Auswahl und Kosten zum Vervollständigen.
- **Verlauf** aller abgeschlossenen Sessions.
- **Ein Konto pro App:** Beim allerersten Start richtet man das Konto ein, danach lehnt der Server jedes weitere ab. Auf jedem Gerät meldet man sich einmal an und bleibt angemeldet, bis man selbst „Abmelden“ tippt. Eine kurze Begrüßung und eine Schritt-für-Schritt-Hilfe für den Erkennungs-Schlüssel (wird vor dem Speichern geprüft) führen durch den Start.
- **Werkzeuge** (Einstellungen → Werkzeuge): **Tests** (Verbindungstest, Test-Scan mit KI-Rohantwort, Preis-Abfrage, Diagnose), **Technik** (Schalter für Technik-Details in der ganzen App, Preis- und Datenstatus), **Wartung** (alle Preise neu laden, Zwischenspeicher leeren, Backup, Sammlung eines früheren Kontos übernehmen, Fehlerprotokoll). Es gibt keine Nutzerverwaltung und keine Verbrauchszählung auf dem Server.
- **Konto mit Login:** E-Mail und Passwort, Daten und Fotos dauerhaft in Supabase gespeichert und auf jedem Gerät verfügbar. **E-Mail und Passwort werden auf dem Gerät gehasht** (PBKDF2-SHA-256); in der Datenbank steht nur `e-<hash>@kartenscanner.invalid`, und Supabase speichert den Passwort-Hash zusätzlich mit bcrypt. Das echte Passwort verlässt nie das Gerät. Ältere Logins (Benutzername, unverhashtes Passwort) funktionieren weiter und werden beim Anmelden automatisch umgestellt. Daten aus der alten Version ohne Konto lassen sich beim ersten Login übernehmen.
- **Angemeldet bleiben:** Kein automatisches Abmelden beim Schließen oder nach Inaktivität. Supabase erneuert die Anmeldung im Hintergrund.
- **Sicherungsdatei:** Export und Import als JSON-Datei (ohne Fotos).
- **Design im iOS-Stil** mit Systemschrift, großen Titeln, die beim Scrollen in die Leiste wandern, gruppierten Listen und Einstellungen wie in der Einstellungen-App (mit Schaltern für Auto-Auslöser und Ton); **Hell oder dunkel automatisch wie das System**, ohne eigenen Schalter in der App (so empfiehlt es Apple).
- **Bewegung wie auf dem iPhone:** Fenster gleiten von unten herein und lassen sich nach unten wegwischen, Knöpfe federn beim Tippen, Seitenwechsel blenden weich über. Am Ende einer Session zählt der Endbetrag hoch, landet mit Kassen-Sound und einem Münzregen. Eigener Startbildschirm (hell und dunkel) für alle aktuellen iPhones. Wer in iOS „Bewegung reduzieren“ eingeschaltet hat, bekommt keine Animationen.
- **Schnell:** Die App merkt sich deine Daten auf dem Gerät und zeigt sie sofort beim Start, auch ohne Verbindung. Danach lädt sie nur, was sich seit dem letzten Mal geändert hat (einmal am Tag zur Sicherheit alles). Sessions werden gebündelt gespeichert, Preise parallel aktualisiert; gleiche Karten werden dabei nur einmal abgefragt.

## iOS-App (Sideloading, ohne Mac)

Die App läuft als echte iOS-App: eigenes Icon und Startbildschirm, kein Safari drumherum, Kamera-Erlaubnis bleibt gespeichert, Vibration beim Scannen, Löschen und am Session-Ende, Backup über das iOS-Teilen-Menü.

GitHub baut sie bei jeder Änderung automatisch auf einem Mac in der Cloud (Workflow `.github/workflows/ios-app.yml`) und legt die neueste Datei hier ab:
**https://github.com/Frozz3/pokemon-kartenscanner/releases/download/ios-latest/Kartenscanner.ipa**

Installation mit dem Windows-PC und einer kostenlosen Apple-ID:

1. **iTunes** von apple.com installieren (nicht die Microsoft-Store-Version), danach **Sideloadly** von sideloadly.io.
2. iPhone per USB anschließen, entsperren und „Vertrauen“ tippen.
3. In Sideloadly die `Kartenscanner.ipa` hineinziehen, deine Apple-ID eintragen, **Start** klicken und das Apple-ID-Passwort eingeben.
4. Auf dem iPhone: **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus** einschalten (Neustart, dann bestätigen).
5. **Einstellungen → Allgemein → VPN & Geräteverwaltung** → deine Apple-ID → **Vertrauen**.
6. App öffnen, einmal anmelden, API-Schlüssel eintragen. Die Daten kommen wie gewohnt aus deinem Konto.

Wichtig bei einer kostenlosen Apple-ID:

- Die Signatur gilt **7 Tage**. Danach startet die App nicht mehr, bis du sie neu aufspielst (Schritt 3 mit der neuesten `.ipa`). Deine Daten bleiben dabei erhalten, weil sie in deinem Konto liegen. Mit der neuesten Datei bekommst du gleich alle Updates mit.
- Höchstens 3 selbst installierte Apps gleichzeitig.
- Die App zeigt unter Einstellungen → App ihre Version und meldet, wenn eine neuere bereitliegt.
- Mit einem bezahlten Apple-Entwicklerkonto (99 €/Jahr) gilt die Signatur 1 Jahr.

## API-Schlüssel (für die Erkennung per Foto)

1. In der [Anthropic Console](https://console.anthropic.com/settings/keys) einen Schlüssel erstellen und Guthaben aufladen.
2. Am besten ein monatliches Ausgabelimit setzen.
3. In der App unter Einstellungen eintragen.

Der Schlüssel wird **nur auf dem Gerät** gespeichert (localStorage) und direkt an `api.anthropic.com` gesendet. Er steht nie im Code oder im Repository. Jeder Scan verbraucht etwas API-Guthaben; Haiku ist günstiger, Sonnet genauer.

## Daten und Login (Supabase)

Inventar, Sessions und Fotos liegen in einem eigenen, kostenlosen [Supabase](https://supabase.com)-Projekt. Nur das angemeldete Konto kommt an die Daten (Row Level Security). Statt deiner E-Mail-Adresse steht in der Login-Verwaltung nur ein Hash. Das ist eine Pseudonymisierung: Wer Zugriff auf die Datenbank hat und deine E-Mail-Adresse bereits kennt, könnte prüfen, ob sie dazu passt; aus dem Hash zurückrechnen lässt sie sich nicht.

Einrichtung:

1. Auf supabase.com ein Konto anlegen → **New project**, Region **Central EU (Frankfurt)**.
2. **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Project Settings → API:** Project URL und den `anon`/`publishable` Key notieren. Für die App kommen sie als GitHub-Variablen in den Build (siehe [Eigene Instanz](#eigene-instanz-selbst-hosten)); `config.js` gilt nur für die Web-Version dieses Repos. Den `service_role`/`secret` Key niemals verwenden, der Build lehnt ihn ab.
4. **Authentication → Sign In / Providers → „Confirm email“ ausschalten** (Supabase kennt nur den Hash, eine Bestätigungs-Mail käme nie an).
5. **„Allow new users to sign up“ eingeschaltet lassen**, bis das Konto angelegt ist. Danach ist es egal: `schema.sql` sorgt dafür, dass der Server nur ein einziges Konto annimmt.
6. Die App öffnen: Solange es noch kein Konto gibt, zeigt sie **„Konto einrichten“**. E-Mail und Passwort festlegen, fertig.

**Schon eingerichtet?** Nach Updates den Inhalt von `schema.sql` einfach noch einmal im SQL Editor ausführen. Das ist gefahrlos, vorhandene Daten bleiben erhalten; es ergänzt Profil, die Sperre für weitere Konten und den Zeitstempel-Trigger für den schnellen Abgleich und entfernt die frühere Nutzerverwaltung samt Verbrauchszähler.

**Von mehreren Konten auf eines umsteigen:** `schema.sql` ausführen, dann unter **Authentication → Users** alle Konten außer deinem löschen (ihre Karten verschwinden mit; ihre Fotos danach unter **Storage → card-images** im Ordner mit der Konto-ID löschen). Neue Konten lehnt der Server ab diesem Moment ab.

Hinweis: Supabase pausiert kostenlose Projekte nach etwa einer Woche ohne Nutzung. Ein Klick auf „Restore“ im Dashboard holt das Projekt mit allen Daten zurück.

## Eigene Instanz (selbst hosten)

Jeder kann den Kartenscanner mit **eigenem Server** und **eigener App** betreiben. Jede Instanz ist für eine Person gedacht; die Daten liegen dann im eigenen Supabase-Projekt, das Original-Projekt hat damit nichts mehr zu tun. Am Code muss nichts geändert werden.

**1. Repository kopieren**
- Auf GitHub oben rechts **Fork**.
- Im Fork den Reiter **Actions** öffnen und die Workflows mit **„I understand my workflows, go ahead and enable them“** einschalten (GitHub schaltet sie in Forks erst aus).

**2. Server einrichten**
- Ein Supabase-Projekt anlegen, entweder kostenlos auf supabase.com oder selbst betrieben ([Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)). Die Adresse muss mit `https://` erreichbar sein.
- Schritte 2, 4 und 5 aus [Daten und Login](#daten-und-login-supabase) ausführen: `schema.sql` laufen lassen, „Confirm email“ aus, „Allow new users to sign up“ an.

**3. Den Fork mit dem Server verbinden:** Im Fork unter **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Variable | Wert |
|---|---|
| `SUPABASE_URL` | Project URL, z. B. `https://abcd1234.supabase.co` oder `https://db.example.org` |
| `SUPABASE_KEY` | der `publishable`- bzw. `anon`-Schlüssel (niemals `secret`/`service_role`) |
| `APP_NAME` | optional: Name unter dem Icon, Standard „Kartenscanner“ |
| `APP_ID` | optional: App-Kennung, Standard `io.github.<dein-github-name>.kartenscanner` |

Der Build trägt die Adresse auch in die Sicherheitsregeln (CSP) ein, die App spricht dann nur mit genau diesem Server. Ohne diese Variablen bricht der Build in einem Fork mit einem Hinweis ab, damit kein Fork aus Versehen fremde Server nutzt.

**4. App bauen:** Reiter **Actions** → „iOS-App bauen“ → **Run workflow**. Nach etwa 10 Minuten liegt die Datei unter
`https://github.com/<dein-name>/<dein-repo>/releases/download/ios-latest/Kartenscanner.ipa`.
Danach baut GitHub bei jeder Änderung im Fork automatisch neu. Die App fragt für Update-Hinweise genau diesen Fork.

**5. Konto einrichten:** Die eigene App öffnen und unter **„Konto einrichten“** E-Mail und Passwort festlegen. Danach nimmt der Server keine weiteren Konten an.

**Updates vom Original übernehmen:** Im Fork auf **Sync fork → Update branch**. GitHub baut die App dann neu. Wenn sich `supabase/schema.sql` geändert hat, die Datei noch einmal im SQL Editor ausführen.

### Bestehendes Konto auf E-Mail-Hash umstellen

In der App: Einstellungen → Konto → **E-Mail-Anmeldung einrichten**. Die App rechnet den Hash auf dem Gerät aus und versucht, die Login-Kennung direkt zu ändern. Verlangt Supabase dafür eine Bestätigungs-Mail, zeigt die App stattdessen zwei SQL-Befehle zum Kopieren an (sie enthalten nur den Hash), die du im SQL Editor ausführst.

### Passwort vergessen

Ohne gespeicherte E-Mail-Adresse gibt es keinen Reset-Link. Stattdessen im SQL Editor ein vorläufiges Passwort setzen; die App akzeptiert es beim nächsten Login und stellt es sofort auf den Hash um:

```sql
update auth.users
   set encrypted_password = extensions.crypt('VORLAEUFIGES_PASSWORT', extensions.gen_salt('bf'))
 where email like 'e-%@kartenscanner.invalid';
```

Danach in der App unter Einstellungen → **Passwort ändern** ein neues Passwort festlegen.

## Sicherheit

- Im Repository stehen keine Geheimnisse, nur der öffentliche Supabase-Schlüssel. Deine Daten schützt die Row Level Security; der Anthropic-Schlüssel bleibt auf dem Gerät und gilt nur für das Konto, mit dem er eingetragen wurde.
- **Content Security Policy** (in `index.html`): Die App lädt nur eigene Dateien und spricht nur mit Supabase, TCGdex, Anthropic und GitHub (Update-Prüfung). Eingeschleuster Code und Anfragen an fremde Server werden blockiert. Inline-Skripte sind komplett verboten.
- Der App-Build nutzt nur GitHubs eigene Actions, fest auf geprüfte Versionen (Commit) gepinnt.
- Nur das eine Konto kommt an Karten und Fotos (Row Level Security). Weitere Konten lehnt die Datenbank selbst ab (Trigger `only_one_account`), auch wenn jemand die App umgeht. Von außen ist nur eine Ja/Nein-Abfrage möglich, ob schon ein Konto existiert (`setup_open`).
- Angemeldet bleiben heißt: Wer dein entsperrtes Handy hat, sieht deine Sammlung. Für mehr Schutz die Bildschirmsperre des Handys nutzen oder in der App „Abmelden“ tippen.
- Für Sideloadly/SideStore am besten eine zweite Apple-ID nehmen, nicht die Haupt-ID.
- Der Build bricht ab, wenn als `SUPABASE_KEY` ein geheimer Schlüssel eingetragen ist.

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
| `package.json`, `capacitor.config.json` | App-Hülle für iOS (Capacitor 8) |
| `scripts/build-web.mjs` | Web-Dateien für die App vorbereiten, Einstellungen der Instanz übernehmen (Server, CSP, App-Kennung, Update-Quelle) |
| `scripts/ios-customize.sh` | Xcode-Projekt anpassen (Kamera-Erlaubnis, Hochformat, Icons, Startbildschirm) |
| `resources/` | App-Icon und Startbilder |
| `.github/workflows/ios-app.yml` | Baut die unsignierte `.ipa` (Release `ios-latest`) |
| `manifest.webmanifest`, `icons/` | PWA-Angaben, App-Icons und Startbilder (`icons/splash/`) |

Dieselben Dateien laufen auch als Web-App im Browser. GitHub Pages ist dafür derzeit aus; bei Bedarf wieder einschalten unter Settings → Pages → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.

## Hinweis

Privates Fanprojekt. Pokémon und alle Kartennamen sind Marken von Nintendo, Creatures und GAME FREAK. Preisdaten: TCGdex / Cardmarket, ohne Gewähr.
