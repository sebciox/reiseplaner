# Reiseplaner (ehemals Gespann-Etappen) – Projektkontext für Claude

Privater Reiseplaner (PWA) für eine Reise mit **Wohnwagen-Gespann**. Anzeigename **„Reiseplaner“** (Titel, Kopf, Manifest, GPX, PDF); Repo `sebciox/reiseplaner` (Nov. 2026 umbenannt, alte Pages-Adresse `/gespann-etappen/` gibt es nicht mehr). Unverändert bleiben bewusst die Dateikennung `app:'gespann-etappen'` (Tour-Dateien, Online-Speicher), die Cache-Namen in `sw.js` und die localStorage-Schlüssel `gp.*` (gleiche Herkunft sebciox.github.io → Daten bleiben erhalten). Nutzer: Sebastian (nur für sich selbst,
nicht öffentlich vertrieben). Sprache der App und der Kommunikation: **Deutsch**. Sebastian will wenig Rückfragen –
Absicht erschließen und liefern.
**Fragen immer als Auswahl stellen:** Wenn Entscheidungen oder Vorschläge zur Wahl stehen, diese über den
Auswahl-Dialog (AskUserQuestion, mit Optionen und Empfehlung) stellen – nicht als Fließtext-Liste.

Live: https://sebciox.github.io/reiseplaner/ (Repo `sebciox/reiseplaner`, bis Nov. 2026 `gespann-etappen`; GitHub Pages, Branch `main`, Root). Jeder Push auf `main`
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
| Eingabe | Start, optionale **Zwischenziele** (Sehenswürdigkeiten/Orte; je „★ Übernachten in der Nähe“ mit Nächten oder „Besuch unterwegs“; per Drag & Drop am Griff ⠿ sortieren (Maus/Finger, Pfeiltasten am Griff); ein manuell verschobenes Ziel bekommt 📌 und behält beim „Reihenfolge optimieren“ seinen Platz, nur die übrigen werden verteilt (kürzeste Luftlinie, bis 8 freie Ziele exakt); 📌 antippen löst), Ziel oder Schalter „zurück zum Start (Rundreise)“. Beliebig viele Zwischenziele: Enter, „+ Hinzufügen“ oder Vorschlag antippen; Suche `placeSearch()` = ORS + Photon (Photon kennt benannte OSM-Orte wie Campingplätze/Sehenswürdigkeiten, ORS liefert oft nur die Ortschaft), Treffer mit allen Suchwörtern zuerst; Enter/„+ Hinzufügen“ übernimmt nur einen solchen Treffer, sonst Auswahlliste „nicht genau gefunden“; Campingplatz (`camp_site`) → Art „Pause / freie Tage“ (⛺ in der Vorschlagsliste); Formular-Absenden im Feld fügt hinzu statt zu planen, doppelte Ziele werden abgewiesen. Kein „Fähren meiden“ |
| Rundreise (Phase 1) | Zwischenziele → **Abschnitte** (`state.segs`): jedes ★-Ziel beendet einen Abschnitt, „unterwegs“-Ziele sind Durchgangspunkte (ORS-Route mit mehreren Koordinaten). Übersicht „Abschnitte“ mit Etappen je Abschnitt (Empfehlung ceil(km/max), ± änderbar) → „Plätze wählen“. Transit-Etappen wie bisher im Korridor; letzte Etappe eines ★-Abschnitts = Campingplatz im Umkreis (Standard 20 km, 10/20/30/50) um die Sehenswürdigkeit, sortiert nach Straßenentfernung Platz ↔ Sehenswürdigkeit (ORS-Matrix, Pkw-Tempo = ohne Wohnwagen), `stage.to.near`, Nächte aus dem Ziel. Rundreise endet zu Hause ohne Platzliste. Stage hat `seg` + `vias` (passierte Besuche). Phase 3 (offen): Vorschläge in der Nähe, Liste einfügen, Excel |
| Rundreise (Phase 2) | **Basislager:** ★-Ziel kann weitere Sehenswürdigkeiten haben (`via.sights`); Platzsuche um deren Mittelpunkt (Umkreis ≥ entfernteste + 10 km), ORS-Matrix von allen Sehenswürdigkeiten zu den Plätzen, sortiert nach mittlerer Entfernung; `stage.to.sights` [{label, d, t}]. **Besuch unterwegs** mit Dauer (`via.hours`, Standard 2 h) und Link „Parken fürs Gespann“ (Google-Maps-Suche am Punkt); Tagesdauer = Fahrzeit + Besuche. **Tagesplan** (`dayPlan()`): je Etappe ein Fahrtag, je weitere Nacht ein Tag am Platz (Ausflug ohne Wohnwagen / freier Tag); Sehenswürdigkeiten gleichmäßig auf die vollen Tage verteilt, per Auswahl änderbar (`stage.dayPlan` {uid: Tag, 0 = Ankunftstag}); Übersicht mit Reitern „Etappen | Tagesplan“, PDF mit Tagesplan-Seite |
| Ablauf | 1. „Strecke berechnen“ → Gesamtstrecke + Fahrzeit anzeigen. 2. Frage „Wie viele Etappen?“ (Optionen Empfehlung ±2 mit km/Fahrzeit je Etappe, oder eigene Zahl). 3. Plätze je Etappe wählen. „Anzahl ändern“ führt zurück zu 2. |
| Etappenlänge | ideale Länge = Reststrecke / übrige Etappen; Suchkorridor ± (max − min)/2 (Standard ±50 km), gemessen in km; Fahrzeit wird angezeigt |
| Abstand zur Route | **echter Umweg auf der Straße** (einfache Richtung), Standard max. 10 km |
| Plätze | nur Campingplätze (`tourism=camp_site`), keine Wohnmobil-Stellplätze |
| Wohnwagen-Status | `caravans=no` ausblenden; `yes`/`designated` grün, ohne Angabe grau |
| Öffnungszeiten | **keine Prüfung** (nur Anzeige, falls in OSM) |
| Auswahl | alle Treffer im Korridor auf der Karte + Liste; Nutzer wählt |
| Verkettung | jede Etappe startet am gewählten Platz der vorherigen |
| Letzte Etappe | gewählte Anzahl erreicht → direkt zum Ziel, danach Liste „Campingplatz am Ziel“ (wird in der Tour als `endCands` gespeichert; beim Laden einer fertigen Tour **keine** neue Abfrage – ältere Touren ohne Liste zeigen einen Knopf „Campingplätze am Ziel …“) |
| Nichts gefunden | stufenweise erweitern: Umweg 20 km, dann Korridor ±50 km; Hinweis anzeigen |
| Manuelle Wahl | jeder Campingplatz beim Reinzoomen (Zoom ≥ 10) als Etappenziel wählbar. Zoom-Plätze (`drawArea`) lassen Plätze weg, die schon als Vorschlag/Ausweichplatz/Ziel-Liste/Etappenziel angezeigt sind. Popup: während der Planung „außerhalb des Suchkorridors“ + „Als Etappenziel wählen“; danach Entfernung zum nächsten Etappenziel + „Als Ziel von Etappe N übernehmen“ (N = offene Ausweichplatz-Etappe, sonst nächstgelegenes Ziel; wie Ausweichplatz übernehmen) |
| Links je Platz | 🧭 Navigation (Routenführung), „Google-Eintrag“ (mit Google-Schlüssel der gefundene Eintrag, sonst Namenssuche `maps/search/<Name>/@lat,lon,15z`), park4night |
| Umweg-Text | „7,4 km / 9 min von der Route bis zum Platz“ (einfache Richtung) |
| Tournamen | gleicher Name (Groß/Klein + Leerzeichen egal) beim Speichern → Warnung: OK = vorhandene Tour überschreiben (gleiche id, eigener alter Eintrag wird gelöscht), Abbrechen = Vorschlag „Name (2)“. Tourenliste zeigt Datum + Uhrzeit |
| Geschwindigkeit | max. 80 km/h (ORS-Minimum ist 80) |
| Autobahn bevorzugen | Standard an: Route **ohne** `maximum_speed` (`preference: fastest`), Fahrzeit danach je Schritt auf max. km/h gedeckelt. Grund: mit 80-km/h-Limit wählt ORS oft Landstraßen. Aus: altes Verhalten mit `maximum_speed` |
| Maut meiden | Standard aus; `options.avoid_features: ['tollways']` (gilt nur fürs Routing, nicht für die Umweg-Matrix) |
| Speichern | localStorage im Browser, GPX-Export, Tour-Datei (`.etappen.json`) Export/Import; optional Online-Speicher (s. u.) |
| Online-Speicher | privates GitHub-Repo (Standard `sebciox/touren`), Fine-grained Token nur für dieses Repo („Contents: Read and write“), Token bleibt lokal je Gerät. Synchronisiert Touren **und** Einstellungen inkl. ORS-Schlüssel |
| Layout | Handy: Karte Vollbild + Bottom-Sheet (Stufen klein 128 px / halb 42 % / groß 90 % / ausgeblendet; ziehen am Griff oder an der Kopfzeile, ganz runter = ausblenden; Antippen des Griffs wechselt; fertige Tour laden → klein). Schwebende Knöpfe oben links: ☰ Menü ein/aus, 📋 Übersicht. Ab 900 px: Seitenleiste links (Breite am rechten Rand ziehbar 320–760 px, gemerkt in `gp.ui.pw`, kein waagerechtes Scrollen), „Übersicht“ im Kopf |
| Karte | Zoom (+/−), Kartenart-Knopf (🛰 Satellit ↔ 🗺 Straßenkarte, gemerkt in `gp.ui.base`) und Quellenangabe unten rechts; auf dem Handy über dem Bottom-Sheet (CSS-Variable `--sheet-h`, `sheetVar()`). Satellit = Esri World Imagery + Ortsnamen-Ebene (Kacheln wie OSM im Kachel-Cache des Service Workers). Hilfslinien (Korridor, Umkreis) sind `interactive:false` – sonst schluckt der Umkreis die Klicks auf die Plätze. Klick auf Platz = Info-Fenster mit Knopf „Als Etappenziel wählen“ (bewusst kein Sofort-Übernehmen); Info-Fenster zeigt die **Straßenentfernung** zum geplanten Ziel (`popDist`/`fillPopDist` beim Öffnen, ORS-Matrix mit Cache `pdMem`): an der Sehenswürdigkeit je ★ (ohne Wohnwagen), bei Transit „Etappe bis hier“ + Rest, beim Zwischenstopp „Teilt Etappe: a + b“, nach der Planung zum nächsten Etappenziel; bei Fehler Luftlinie. Lade-Anzeige `#mapBusy` oben über der Karte, solange `setStatus(…, 'busy')` läuft. Zweiter Klick auf denselben Punkt schließt das Fenster wieder (Patch von `L.Layer.prototype._openPopup` + `lastClosed`, weil Leaflet bei Kreisen nicht umschaltet und beim „preclick“ schon schließt) |
| Zielplatz-Liste | nach Auswahl eingeklappt („Zielplatz: … ✓ Ändern“) |
| Etappe | Knöpfe: 🧭 Navigation (Google Maps, `dir/?api=1&destination=`), Details (Rezeption, Wohnwagen, Ausstattung, Adresse, Öffnungszeiten OSM, Telefon, Website, Notiz + „reserviert“ + Nächte), Ausweichplatz, Platz ändern (= ab hier neu planen) |
| Zwischenstopp | In der Abschnitte-Übersicht: Stepper „Etappen“ (+ = ein Zwischenstopp mehr, Suche auf gleich langen Teilstrecken), Text „direkt, ohne Zwischenstopp“ / „n Zwischenstopps“. Nachträglich: Knopf „+ Zwischenstopp“ an jeder Etappe (`loadSplit`/`splitStage`, `state.split`): Plätze im mittleren Teil der Etappe (25–75 %, Umweg wie eingestellt, sonst 20 km), sortiert nach Nähe zur Hälfte („beste Teilung“); Karte zeigt Korridor + Punkt „Hälfte“; beim Reinzoomen jeder Platz „Als Zwischenstopp in Etappe N einfügen“. Einfügen teilt die Etappe (Besuche unterwegs nach Lage verteilt), alle anderen Etappen bleiben; `segs[seg].n` bzw. `state.n` +1 |
| Platz fehlt | Unter jeder Platzliste (Transit, Sehenswürdigkeit, Zwischenstopp) Feld „Platz fehlt? Name, Google-Maps-Link oder Koordinaten“ (`searchAddCamp`): Name → Photon-Suche nahe dem Suchpunkt (≤ 150 km, Campingplätze ⛺ zuerst); Koordinaten oder langer Google-Maps-Link (`!3d…!4d…` bevorzugt, sonst `@lat,lon`, Name aus `/place/…`) → eigener Platz (Name per Abfrage). Kurzlinks (maps.app.goo.gl) gehen nicht (CORS) → Erklärung. Google-Inhalte werden **nicht** übernommen (Regeln), nur vom Nutzer eingefügte Koordinaten. Ergänzte Plätze (`c.added`, Badge „von dir ergänzt“) bekommen dieselben Kennzahlen wie gefundene (`enrichAdded`), ignorieren die Filter-Chips und werden normal einsortiert. Liste an der Sehenswürdigkeit: 40 nächste Plätze (vorher 25) |
| Ziele nachträglich ändern | Erneutes „Strecke berechnen“ übernimmt Etappen **unveränderter Abschnitte** automatisch (`snapshotKeep()` vor dem Neuberechnen, `applyKeep()` nach `computeSegs`, Schlüssel `segKey` = Start, Ziel, Art, Besuche, Sehenswürdigkeiten; Nächte dürfen sich ändern). Abschnitte-Übersicht zeigt „✓ bisherige Plätze werden übernommen“; Stepper ändern verwirft die Übernahme für diesen Abschnitt. `computeNext` setzt übernommene Etappen samt Notiz/„reserviert“ ein; ist der Platz davor ein anderer, wird nur die erste Etappe neu geroutet. Zielplatz-Liste wird mit übernommen. In neu zu planenden Abschnitten: früher gewählte Plätze mit Badge „bisher gewählt“ (`state.prevPicks`), nie automatisch. „Abschnitte ändern“ behält gewählte Etappen genauso |
| Ausweichplatz | Umkreis 5/10/20/30 km (gemerkt in `settings.altRadius`) um den Platz der Etappe; „Übernehmen“ rechnet diese und die nächste Etappe neu, spätere bleiben |
| Google-Bewertungen | Places API (New) Text Search (`places.googleapis.com/v1/places:searchText`, Feldmaske rating/userRatingCount/googleMapsUri), Schlüssel `settings.gkey` (synchronisiert). Nur live + im Arbeitsspeicher (Google-Regeln), max. 20 Plätze je Liste (Kontingent). Sortierung „Entfernung/Etappe“ oder „★ Google-Bewertung“ (gewichtet, `settings.sortBy`) |
| Ersatzdienst | nur auf Rückfrage: bei ORS-Fehler (kein/ungültiger Schlüssel, 429, 5xx, Netz) `confirm` → für die Sitzung OSRM-Demo (`router.project-osrm.org`, Route + Table, `exclude=toll`) und Photon (`photon.komoot.io`, Ortssuche/Rückwärtssuche); Hinweis `#fbNote` mit „zurück zu ORS“ |
| Koordinaten | in Details/Übersicht/PDF und am Idealpunkt der Etappe, je mit Kopier-Symbol (SVG, zwei Rechtecke; danach kurz ✓) und „Camping in der Nähe“ (Google-Maps-Suche „camping“ am Punkt – findet auch Plätze, die in OSM fehlen) |
| Länder/Fähre/Maut | ORS `extra_info: waycategory, tollways` → `stage.ex {ferry, toll}` (Meter); Länder je Etappe per Photon-Rückwärtssuche alle ~60 km → `stage.countries`; Tabelle `LAND` mit Gespann-Richtwerten (ohne Gewähr) |
| Teilen | 📤 je Etappe: Text (Datum, Ziel, Adresse, Koordinaten, Rezeption/Check-in/out, Telefon, Website, Navigation, Notiz) über `navigator.share`, sonst Zwischenablage |
| Offline-Karte | Service Worker speichert jede angesehene OSM-Kachel (Cache `gespann-kacheln`, max. 2500, Netz zuerst). Kein Massen-Vorabladen (OSM-Kachelregeln) – nur „Etappenziele für unterwegs laden“ (je Ziel Zoom 10/13/15) |
| Reisedatum | Abfahrt (`tour.date`) und „Ankunft/Zurück spätestens“ (`tour.ret`) im Formular; Nächte je Stopp (`stage.nights`, Standard 1; Stepper „Nächte hier − n +“ an jeder Etappe, n−1 = freie Tage) → Datum je Etappe. Abfahrt verschieben → Rückkehr wandert um dieselben Tage mit; Rückkehr nie vor Abfahrt (`min`, sonst auf Abfahrtstag gesetzt). Leeres Rückkehrfeld: beim Antippen wird vorübergehend die Abfahrt eingetragen, damit der Kalender im Abfahrtsmonat aufgeht (ohne Wahl wieder leer). `tripEnd()` schätzt das Reiseende (offene Etappen: Transit 1 Nacht, Zwischenziel mit seinen Nächten); liegt es nach `ret` → rote Warnung „⚠ n Tage zu lang“ (Abfragen, Etappenliste, Übersicht), sonst Puffer-Anzeige; bei „Wie viele Etappen?“ je Option Ankunft + „⚠ zu spät“ |
| Zwischenziel-Arten | ★ Übernachten in der Nähe (Sehenswürdigkeit) · ⛺ Pause / freie Tage (nur Campingplatz, Entfernung „zum Ort“) · Besuch unterwegs |
| Farben | Hintergrund weiß; Akzent Salbeigrün pastell `--brand #9cbca2` (Flächen, Knöpfe mit dunkler Schrift), `--brand-ink #476b50` für Text/Links, `--brand-soft #eef4ef`; Eingabefelder `--field`; Route/Pins `#6a9a74`. Orange `--accent` bleibt für Sehenswürdigkeiten/Empfehlung |
| App-Icon | **nur Wohnwagen** (kein Auto/Gespann) als dünnes Linien-Icon nach Sebastians Vorlage: gespiegelt, Front rechts, **waagerechte** Deichsel ohne Kupplung, Radkasten und Rad getrennt, ohne Bodenlinie; Radkasten kleiner als die Linie darüber; App-Icon: **weiße** Linien auf Salbei; Logo im App-Kopf: Salbei-Linien (`#6a9a74`) auf Weiß (inline-SVG); `icon.svg`, PNG 192/512 per Playwright gerendert |
| Ausstattung/Filter | Symbole aus OSM (Strom, WLAN, Duschen, Pool – Hunde bewusst nicht); Filter-Chips „Wohnwagen ✓ / Strom“ (`settings.filters`), filtern nur ausdrückliche Angaben |
| Übersicht | Harmonika (📋): außerhalb des Reisezeitraums alles offen, während der Tour nur die nächste Etappe; „Drucken / PDF“ = A4 quer (Übersichtskarte + Tabelle: Nr, Datum, Von → Nach, Strecke, Platz, Adresse, Rezeption, Website/Kontakt mit Links) über `window.print()` |
| Rezeptionszeiten | GitHub Action im Repo `touren` (`tools/rezeption.mjs`) liest nach jedem Tour-Push die Websites der gewählten Plätze (Startseite + passende Unterseiten; DE/EN/FR/ES/CA/NL/IT/DA/SV/NO) → `rezeption.json` {v, status ok/partial/none/error, hours, snippet, url, checkin/checkout {text, snippet, url}}; `VERSION` im Skript erhöhen → alle Plätze werden neu geprüft. App lädt die Datei beim Abgleich (`gp.rezeption`) und zeigt Zeiten + Quellen-Link; ~2 Min. nach dem Hochladen wird einmal nachgeladen |

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
- **Zwischenspeicher (7 Tage, localStorage):** `gp.cache.op2` = Overpass-Ergebnisse je Rechteck (nur nötige Tags,
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
- **Adressen:** aus OSM `addr:*`, sonst einmalig ORS-Rückwärtssuche (`/geocode/reverse`), gespeichert in `stage.to.addr`.
  Änderungen an einer gespeicherten Tour (Notiz, Datum, Nächte, Adresse, Ausweichplatz) sichert `touch()` automatisch.
- localStorage-Schlüssel: `gp.settings`, `gp.tours`, `gp.sync`, `gp.cache.op2`, `gp.cache.mx`, `gp.rezeption`.

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

- **Geplant (noch nicht umgesetzt, Details mit Sebastian klären):**
  - **Excel-Export** (.xlsx, **ein** Blatt): Spalte „Typ“ = Campingplatz / Sehenswürdigkeit, Zeilen je Etappe
    (Platz, darunter seine Sehenswürdigkeiten); Spalten u. a. Etappe, Datum, Name, Adresse, Koordinaten,
    Entfernung zum Platz, Rezeption/Check-in/out, Website (Link), Telefon, Google-Sterne, Notiz.
  - **Sehenswürdigkeiten** je Etappe/Platz: in der App suchen und manuell hinzufügen, mit Google-Sternen;
    Anzeige auf der Karte (eigenes Symbol + Popup) sowie in Übersicht und PDF.

- Start/Ziel sind vorerst zum Testen vorausgefüllt (`DEMO` in `index.html`: Witten → Sant Pere Pescador) – später entfernen.
- Echte Tests mit realen Diensten stehen noch aus (park4night-Link-Ziel ungeprüft).
