# Gespann-Etappen

Privater Etappenplaner für Wohnwagen-Gespanne: Start und Ziel eingeben, die App zeigt Campingplätze
im Korridor 350–450 km je Etappe mit höchstens 10 km echtem Umweg. Du wählst einen Platz, die nächste
Etappe wird ab dort berechnet. Liegt das Ziel weniger als 450 km entfernt, geht es direkt dorthin.

## Einrichten (einmalig)

1. **OpenRouteService-Schlüssel holen:** https://openrouteservice.org/dev/#/signup → kostenloses Konto →
   Dashboard → Token anlegen (Standard-Plan). Der Schlüssel kommt später in der App unter ⚙︎ rein.
2. **Auf GitHub Pages veröffentlichen:**
   - Neues Repository anlegen, z. B. `gespann-etappen` (privat geht nur mit bezahltem GitHub-Plan; öffentlich ist ok, der Schlüssel liegt nicht im Code).
   - Alle Dateien aus diesem Ordner hochladen (Add file → Upload files).
   - Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
   - Nach 1–2 Minuten läuft die App unter `https://<dein-name>.github.io/gespann-etappen/`.
3. **Aufs Handy:** Seite im Browser öffnen → „Zum Home-Bildschirm“ (iPhone: Teilen-Menü; Android: Menü → App installieren).

Lokal testen geht auch: im Ordner `python3 -m http.server` starten und `http://localhost:8000` öffnen.

## Planen

- Pro Etappe zeigt die App die **ideale Aufteilung** (so wenige Etappen wie möglich, alle gleich lang)
  und bei jedem Platz, wie es danach weitergeht und wie viele Übernachtungen es insgesamt werden.
- Am Ende gibt es eine Liste **Campingplatz am Ziel**, um die letzte Etappe direkt auf einen Platz zu legen.
- **Tour-Datei:** speichert die Tour als `.etappen.json` (am Handy über Teilen). Auf einem anderen Gerät unter
  „Touren → Tour-Datei öffnen“ wieder laden.

## Datenquellen

- **Campingplätze:** OpenStreetMap über die Overpass-API (`tourism=camp_site`). Plätze mit `caravans=no` werden ausgeblendet.
  Grün = Wohnwagen ausdrücklich erlaubt, grau = keine Angabe.
- **Routing, Umwege, Ortssuche:** OpenRouteService, Höchstgeschwindigkeit 80 km/h (einstellbar, minimal 80).
- **Karte:** OpenStreetMap-Kacheln. Funktioniert nur über GitHub Pages bzw. einen Webserver, nicht als lokal geöffnete Datei.

## Grenzen des Prototyps

- Kontingent des kostenlosen ORS-Plans: ca. 2.000 Routen und 500 Matrix-Abfragen pro Tag. Eine Etappe braucht etwa 2 Routen und 1–2 Matrix-Abfragen.
- Öffnungszeiten werden nicht geprüft (nur angezeigt, falls in OSM eingetragen).
- Touren werden nur im jeweiligen Browser gespeichert.
