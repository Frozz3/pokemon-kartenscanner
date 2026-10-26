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
- **Set-Fortschritt:** Pro Set „47/189“ mit Fortschrittsbalken, fehlende und vorhandene Karten mit offiziellem Bild, Kosten zum Vervollständigen.
- **Verlauf** aller abgeschlossenen Sessions.
- **Konto mit Login:** E-Mail und Passwort, Daten und Fotos dauerhaft in Supabase gespeichert und auf jedem Gerät verfügbar. Daten aus der alten Version ohne Konto lassen sich beim ersten Login übernehmen.
- **Automatische Abmeldung** nach einstellbarer Zeit ohne Aktivität (5 Min. bis 1 Std., Standard 15 Min.), mit Warnung 30 Sekunden vorher; nicht während Scans oder Preisaktualisierungen.
- **Sicherungsdatei:** Export und Import als JSON-Datei (ohne Fotos).
- Funktioniert als installierbare Web-App (PWA), die App-Oberfläche lädt auch offline.

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

Inventar, Sessions und Fotos liegen in einem eigenen, kostenlosen [Supabase](https://supabase.com)-Projekt. Jeder sieht nur seine eigenen Daten (Row Level Security).

Einrichtung:

1. Auf supabase.com ein Konto anlegen → **New project**, Region **Central EU (Frankfurt)**.
2. **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Authentication → URL Configuration:** Site URL `https://frozz3.github.io/pokemon-kartenscanner/`, dieselbe Adresse auch unter Redirect URLs eintragen.
4. **Project Settings → API:** Project URL und den `anon`/`publishable` Key in [`config.js`](config.js) eintragen. Den `service_role`/`secret` Key niemals verwenden.
5. In der App registrieren und die Bestätigungs-E-Mail öffnen.
6. Danach **Authentication → Sign In / Providers → „Allow new users to sign up“ ausschalten**, damit sich niemand Fremdes registriert.

Hinweis: Supabase pausiert kostenlose Projekte nach etwa einer Woche ohne Nutzung. Ein Klick auf „Restore“ im Dashboard holt das Projekt mit allen Daten zurück.

## Technik

Reines HTML, CSS und JavaScript ohne Build-Schritt:

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst |
| `styles.css` | Gestaltung, hell und dunkel |
| `app.js` | Logik: Login, Speicher, Kamera, Erkennung, Preise, Oberfläche |
| `config.js` | Supabase-Adresse und öffentlicher Schlüssel |
| `supabase/schema.sql` | Tabellen, Zugriffsregeln und Bildspeicher |
| `vendor/supabase.js` | Supabase-Client 2.117.3 (MIT-Lizenz) |
| `sw.js` | Service Worker für Offline-Start |
| `manifest.webmanifest`, `icons/` | PWA-Angaben und App-Icons |

GitHub Pages: Settings → Pages → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.

## Hinweis

Privates Fanprojekt. Pokémon und alle Kartennamen sind Marken von Nintendo, Creatures und GAME FREAK. Preisdaten: TCGdex / Cardmarket, ohne Gewähr.
