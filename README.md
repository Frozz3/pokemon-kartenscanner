# Pokémon Kartenscanner

Web-App fürs Handy: Pokémon-Karten mit der Kamera scannen, mit aktuellen Cardmarket-Preisen bewerten und in einem Inventar sammeln.

**Live:** https://frozz3.github.io/pokemon-kartenscanner/

## Funktionen

- **Scan-Sessions:** Karten nacheinander scannen (Live-Kamera mit Kartenrahmen oder Fotos aus der Galerie). Am Ende zeigt die Session den Endbetrag und übernimmt alle Karten ins Inventar. Gleiche Karten werden zusammengezählt.
- **Erkennung per KI:** Claude erkennt Name, Set, Nummer, Sprache, Variante und Zustand. Dafür ist ein eigener Anthropic-API-Schlüssel nötig.
- **Manuelle Suche:** Ohne Schlüssel oder bei falscher Erkennung lässt sich jede Karte über Name und Nummer in der Datenbank suchen.
- **Echte Marktpreise:** Cardmarket-Trendpreis, Ab-Preis und Durchschnitte über 1, 7 und 30 Tage aus [TCGdex](https://tcgdex.dev), dazu der TCGplayer-Preis in USD. Reverse Holos bekommen den Reverse-Holo-Preis.
- **Inventar:** Kartenraster mit eigenem Foto und offiziellem Kartenbild, Suche, Sortierung, Detailansicht, Preise aktualisieren.
- **Verlauf** aller abgeschlossenen Sessions.
- **Backup:** Export und Import als JSON-Datei.
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

## Daten

Inventar, Sessions und Fotos liegen in IndexedDB im Browser des Geräts. Sie werden nicht synchronisiert. Wer die Website-Daten in Safari löscht, löscht auch das Inventar, daher regelmäßig ein Backup speichern (Einstellungen → Backup speichern).

## Technik

Reines HTML, CSS und JavaScript ohne Build-Schritt:

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst |
| `styles.css` | Gestaltung, hell und dunkel |
| `app.js` | Logik: Speicher, Kamera, Erkennung, Preise, Oberfläche |
| `sw.js` | Service Worker für Offline-Start |
| `manifest.webmanifest`, `icons/` | PWA-Angaben und App-Icons |

GitHub Pages: Settings → Pages → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.

## Hinweis

Privates Fanprojekt. Pokémon und alle Kartennamen sind Marken von Nintendo, Creatures und GAME FREAK. Preisdaten: TCGdex / Cardmarket, ohne Gewähr.
