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
| Etappenlänge | Korridor, Standard 350–450 km (einstellbar), gemessen in km; Fahrzeit wird angezeigt |
| Abstand zur Route | **echter Umweg auf der Straße** (einfache Richtung), Standard max. 10 km |
| Plätze | nur Campingplätze (`tourism=camp_site`), keine Wohnmobil-Stellplätze |
| Wohnwagen-Status | `caravans=no` ausblenden; `yes`/`designated` grün, ohne Angabe grau |
| Öffnungszeiten | **keine Prüfung** (nur Anzeige, falls in OSM) |
| Auswahl | alle Treffer im Korridor auf der Karte + Liste; Nutzer wählt |
| Verkettung | jede Etappe startet am gewählten Platz der vorherigen |
| Letzte Etappe | Reststrecke ≤ max (450 km) → direkt zum Ziel, danach Liste „Campingplatz am Ziel“ |
| Nichts gefunden | stufenweise erweitern: Umweg 20 km, dann Korridor ±50 km; Hinweis anzeigen |
| Manuelle Wahl | jeder Campingplatz beim Reinzoomen (Zoom ≥ 10) als Etappenziel wählbar |
| Geschwindigkeit | max. 80 km/h (ORS-Minimum ist 80) |
| Speichern | localStorage im Browser, GPX-Export, Tour-Datei (`.etappen.json`) Export/Import |
| Layout | Handy: Karte Vollbild + aufziehbares Bottom-Sheet; ab 900 px: Seitenleiste links |

## Ideale Etappenlänge (Kernlogik)

`plan(R)`: n = ceil(R / max), Länge = R / n → so wenige Etappen wie möglich, alle gleich lang.
Korridor wird nach unten erweitert (bis ideal − 30 km), falls die ideale Länge unter dem Minimum liegt.
Pro Kandidat: Reststrecke ≈ verbleibende Route − Etappen-km + Umweg → Vorschau „danach n Etappen à ~x km ·
y Übernachtungen gesamt“. Sortierung: wenigste Übernachtungen, dann Nähe zur idealen Länge; Bester = „Empfehlung“.
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
- **Kartenkacheln:** `tile.openstreetmap.org`. Funktioniert nur über GitHub Pages/Webserver – als lokal geöffnete
  Datei (file://) blockiert OSM die Kacheln (403). CARTO-Basemaps verlangen inzwischen einen API-Key → nicht nutzen.
- localStorage-Schlüssel: `gp.settings`, `gp.tours`.

## Datenquellen – rechtlicher Rahmen

- **park4night:** keine öffentliche API, AGB verbieten Weiterverwendung der Daten → **nicht** als Datenquelle nutzen.
  Nur ein Link „park4night“ pro Platz (Kartenansicht an der Koordinate).
- ACSI, ADAC/PiNCAMP, Campercontact: keine öffentliche API.
- OSM-Daten: ODbL, Attribution „© OpenStreetMap“ ist eingebaut.

## Testen

Die Arbeitsumgebung erreicht ORS/Overpass oft nicht. Bewährt: Playwright-Test mit gemockten Antworten
(`page.route` für ORS-Directions/Matrix/Geocode und Overpass, Leaflet lokal aus npm, `serviceWorkers:'block'`),
Ablauf: planen → Plätze wählen → Zielplatz → Tour-Datei exportieren → neu → importieren.

## Offene Ideen

- Synchronisation der Touren über ein **privates** GitHub-Repository (das App-Repo ist öffentlich → Touren dort
  wären sichtbar). Bräuchte einen Fine-grained Token, den die App speichert.
- Echte Tests mit realen Diensten stehen noch aus (park4night-Link-Ziel ungeprüft).
