# Gespann-Etappen – Projektkontext für Claude

Privater Etappenplaner (PWA) für eine Reise mit **Wohnwagen-Gespann**. Nutzer: Sebastian (nur für sich selbst,
nicht öffentlich vertrieben). Sprache der App und der Kommunikation: **Deutsch**. Sebastian will wenig Rückfragen –
Absicht erschließen und liefern.

Live: https://sebciox.github.io/gespann-etappen/ (GitHub Pages, Branch `main`, Root). Jeder Push auf `main`
wird automatisch veröffentlicht. Kein Build-Schritt, kein Backend.

## Idee

Start und Ziel eingeben → die Strecke ist zu lang zum Durchfahren → etwa alle 400 km einen Campingplatz ansteuern,
der höchstens ~10 km von der Route entfernt liegt.

## Abgestimmte Entscheidungen

| Thema | Entscheidung |
|---|---|
| Zielgruppe | nur privat |
| Plattform | PWA, rein clientseitig, Hosting GitHub Pages |
| Planung | vorab zu Hause (keine Live-Navigation) |
| Eingabe | nur Start und Ziel (keine Zwischenziele, kein „Fähren meiden“) |
| Ablauf | 1. „Strecke berechnen“ → Gesamtstrecke + Fahrzeit anzeigen. 2. Frage „Wie viele Etappen?“ (Optionen Empfehlung ±2 mit km/Fahrzeit je Etappe, oder eigene Zahl). 3. Plätze je Etappe wählen. „Anzahl ändern“ führt zurück zu 2. |
| Etappenlänge | ideale Länge = Reststrecke / übrige Etappen; Suchkorridor ± (max − min)/2 (Standard ±50 km), gemessen in km; Fahrzeit wird angezeigt |
| Abstand zur Route | **echter Umweg auf der Straße** (einfache Richtung), Standard max. 10 km |
| Plätze | nur Campingplätze (`tourism=camp_site`), keine Wohnmobil-Stellplätze |
| Wohnwagen-Status | `caravans=no` ausblenden; `yes`/`designated` grün, ohne Angabe grau |
| Öffnungszeiten | **keine Prüfung** (nur Anzeige, falls in OSM) |
| Auswahl | alle Treffer im Korridor auf der Karte + Liste; Nutzer wählt |
| Verkettung | jede Etappe startet am gewählten Platz der vorherigen |
| Letzte Etappe | gewählte Anzahl erreicht → direkt zum Ziel, danach Liste „Campingplatz am Ziel“ |
| Nichts gefunden | stufenweise erweitern: Umweg 20 km, dann Korridor ±50 km; Hinweis anzeigen |
| Manuelle Wahl | jeder Campingplatz beim Reinzoomen (Zoom ≥ 10) als Etappenziel wählbar |
| Geschwindigkeit | max. 80 km/h (ORS-Minimum ist 80) |
| Autobahn bevorzugen | Standard an: Route **ohne** `maximum_speed` (`preference: fastest`), Fahrzeit danach je Schritt auf max. km/h gedeckelt. Grund: mit 80-km/h-Limit wählt ORS oft Landstraßen. Aus: altes Verhalten mit `maximum_speed` |
| Maut meiden | Standard aus; `options.avoid_features: ['tollways']` (gilt nur fürs Routing, nicht für die Umweg-Matrix) |
| Speichern | localStorage im Browser, GPX-Export, Tour-Datei (`.etappen.json`) Export/Import; optional Online-Speicher (s. u.) |
| Online-Speicher | privates GitHub-Repo (Standard `sebciox/gespann-touren`), Fine-grained Token nur für dieses Repo („Contents: Read and write“), Token bleibt lokal je Gerät. Synchronisiert Touren **und** Einstellungen inkl. ORS-Schlüssel |
| Layout | Handy: Karte Vollbild + aufziehbares Bottom-Sheet; ab 900 px: Seitenleiste links |

## Ideale Etappenlänge (Kernlogik)

Der Nutzer wählt die Anzahl `state.n` (gespeichert in der Tour als `n`). Empfehlung: `plan(R)`: n = ceil(R / max)
→ so wenige Etappen wie möglich, alle gleich lang. Bei jeder Etappe: ideal = verbleibende Route / übrige Etappen,
Korridor ideal ± (max − min)/2. Pro Kandidat: Reststrecke ≈ verbleibende Route − Etappen-km + Umweg → Vorschau
„danach noch k Etappen à ~x km“. Sortierung: Nähe zur idealen Länge; Bester = „Empfehlung“. Die Gesamtroute
(`state.overview`) wird für Etappe 1 wiederverwendet (keine zweite ORS-Anfrage).
Hintergrund: Sebastians erste Testtour Witten → Sant Pere Pescador ergab 3 Übernachtungen, ideal wären 2 gewesen.

## Technik

- Alles in `index.html` (HTML, CSS, JS inline). Leaflet 1.9.4 von cdnjs.
- `sw.js`: Service Worker, network-first; bei Änderungen die Cache-Version (`gespann-etappen-vN`) hochzählen.
- **Routing, Matrix (Umwege), Ortssuche:** OpenRouteService (`api.openrouteservice.org`), Schlüssel gibt der Nutzer
  unter ⚙︎ ein (localStorage `gp.settings`). Kostenloser Plan: ca. 2.000 Routen und 500 Matrix-Abfragen pro Tag.
  Die ORS-Website war Anfang Nov. 2026 offline; Schlüssel gibt es über das HeiGIT-Konto/-Dashboard. Neue Schlüssel
  beginnen mit `eyJ…` und funktionieren normal (Header `Authorization`).
- **Campingplätze:** Overpass-API, mehrere Server mit Fallback und zweitem Durchgang (überlastet → 504).
  Abfrage per **Bounding-Box um den Korridor**, dann lokal nach Luftlinie filtern (die frühere `around`-Polylinie
  führte zu 504). Danach ORS-Matrix von Ankerpunkten auf der Route zu den Plätzen (max. 60 Plätze).
  Rechteck-Rand mind. 20 km → deckt die Stufe „Umweg 20 km“ mit ab (nur „Korridor ±50 km“ braucht eine zweite
  Abfrage). Wiederholung: 4 Versuche über alle Server, Pausen 4/10/20 s mit Countdown; 429 (zu viele gleichzeitige
  Abfragen) bekommt eine eigene Meldung. Zoom-Abfragen: nur 1 Versuch, ältere werden abgebrochen, während einer
  Etappensuche pausiert.
- **Zwischenspeicher (7 Tage, localStorage):** `gp.cache.op` = Overpass-Ergebnisse je Rechteck (nur nötige Tags,
  wiederverwendet, wenn ein gespeichertes Rechteck das neue enthält, max. ~1,5 Mio. Zeichen), `gp.cache.mx` =
  ORS-Matrix je Anfrage (max. ~0,5 Mio. Zeichen). Routen nur im Arbeitsspeicher. Ist der Speicher voll, gehen
  Touren vor (Zwischenspeicher wird geleert).
- **Kartenkacheln:** `tile.openstreetmap.org`. Funktioniert nur über GitHub Pages/Webserver – als lokal geöffnete
  Datei (file://) blockiert OSM die Kacheln (403). CARTO-Basemaps verlangen inzwischen einen API-Key → nicht nutzen.
- **Online-Speicher:** GitHub Contents-API (`api.github.com/repos/<repo>/contents/…`, CORS ok). Dateien:
  `einstellungen.json` (`SYNC_KEYS`, ohne Token) und `touren/<id>.json` (Format wie Tour-Datei, importierbar).
  `gp.sync` merkt je Tour `{sha, at}` des letzten Abgleichs + ausstehende Löschungen. Regeln: neuere `savedAt`
  gewinnt; online fehlend + früher abgeglichen → auf anderem Gerät gelöscht; neue Verbindung (Token/Repo geändert)
  → Online-Einstellungen haben Vorrang. Abgleich beim Start, beim Öffnen von „Touren“, nach Speichern/Löschen/
  Import und nach dem Speichern der Einstellungen. 409/422 (sha veraltet) → aktuellen sha holen, überschreiben.
- localStorage-Schlüssel: `gp.settings`, `gp.tours`, `gp.sync`, `gp.cache.op`, `gp.cache.mx`.

## Datenquellen – rechtlicher Rahmen

- **park4night:** keine öffentliche API, AGB verbieten Weiterverwendung der Daten → **nicht** als Datenquelle nutzen.
  Nur ein Link „park4night“ pro Platz (Kartenansicht an der Koordinate).
- ACSI, ADAC/PiNCAMP, Campercontact: keine öffentliche API.
- OSM-Daten: ODbL, Attribution „© OpenStreetMap“ ist eingebaut.

## Testen

Die Arbeitsumgebung erreicht ORS/Overpass oft nicht. Bewährt: Playwright-Test mit gemockten Antworten
(`page.route` für ORS-Directions/Matrix/Geocode und Overpass, Leaflet lokal aus npm, `serviceWorkers:'block'`),
Ablauf: planen → Plätze wählen → Zielplatz → Tour-Datei exportieren → neu → importieren.
Online-Speicher: GitHub-API mit In-Memory-Repo mocken, zwei Browser-Kontexte (Laptop/Handy) gegeneinander.

## Offene Ideen

- Start/Ziel sind vorerst zum Testen vorausgefüllt (`DEMO` in `index.html`: Witten → Sant Pere Pescador) – später entfernen.
- Echte Tests mit realen Diensten stehen noch aus (park4night-Link-Ziel ungeprüft).
