# Messe Supermarkt Order-System Pro

Lokales Bestell- und Stationssystem für Messe-/Supermarktbetrieb mit Kassen, zwei Heißtheken, Kaffee-Station, Abholanzeige, Tagesübersicht und Wartezeitmessung.

## Ansichten

- Startseite: `http://localhost:3000/`
- Kasse 1 bis 4: `/cashier.html?register=1` bis `/cashier.html?register=4`
- Heißtheke 1: `/station.html?station=hot1`
- Heißtheke 2: `/station.html?station=hot2`
- Kaffee-Station: `/station.html?station=coffee`
- Abholanzeige: `/display.html`
- Dashboard: `/dashboard.html`
- Produktverwaltung: `/admin.html`

## Neu in v3

- Ton auf der Abholanzeige, sobald neue fertige Nummern erscheinen
- Bedienmodus auf der Abholanzeige zum Entfernen einzelner Nummern
- Button zum Entfernen aller fertigen Nummern
- Automatische Messung der Wartezeiten
- Dashboard-Kennzahlen für durchschnittliche Zeit bis Start, bis fertig und bis Abholung
- CSV-Export mit Wartezeitspalten
- Stationen zeigen, wie lange eine Bestellung bereits wartet

## Starten

```powershell
npm.cmd install
npm.cmd start
```

Dann im Browser öffnen:

```text
http://localhost:3000
```

## Ton auf der Abholanzeige

Browser erlauben Ton normalerweise erst nach einer Benutzeraktion. Deshalb muss auf der Abholanzeige einmal `Ton aktivieren` gedrückt werden. Danach merkt sich der Browser die Einstellung lokal.

## Nummern von der Anzeige entfernen

Auf `/display.html` gibt es den Button `Bedienmodus`. Dort kann eine Nummer entfernt werden. Das setzt die Bestellung intern auf `Abgeholt/entfernt`, damit sie nicht weiter auf der Anzeige stehen bleibt. Im Dashboard kann man dasselbe über `Abgeholt` machen.

## Wartezeit-Logik

Das System speichert pro Bestellung:

- `createdAt`: Bestellung wurde an der Kasse gesendet
- `startedAt`: Station hat die Bestellung in Arbeit genommen
- `readyAt`: alle Stationen sind fertig
- `completedAt`: Bestellung wurde von der Anzeige entfernt / abgeholt

Daraus berechnet das Dashboard:

- Durchschnitt bis Start
- Durchschnitt bis fertig
- Durchschnitt bis Abholung
- Anzahl aktiver Bestellungen
- älteste aktive Bestellung



## Pico-Kassentastatur (Status und Schutz)

Die Picos fragen den Server per Polling ab (`/api/registers/:id/next-keyboard-code`). Der Server schuetzt davor, dass ein haengender Pico alte Eingaben staut:

- Codes, die laenger als 30 Sekunden warten, verfallen (`PICO_JOB_MAX_AGE_MS`)
- Ein Pico gilt nach 10 Sekunden ohne Abfrage als offline (`PICO_ONLINE_MS`)
- Bereits bestaetigte Jobs werden nicht nochmal ausgeliefert
- Pro Kasse gibt es eine Status-Ampel; bei offline/aus zeigt der Warenkorb die Artikelnummern zum Selbsttippen
- Unter `/settings.html` kann man jeden Pico ein-/ausschalten und die Warteschlange leeren

API: `GET /api/pico/status`, `PUT /api/pico/:id/enabled`, `POST /api/pico/:id/clear`.

## Hinweise

- `data/db.json` enthaelt die echten Bestellungen. Vor einem `git pull` auf dem Server sichern.
- Die Produktbilder in `public/assets/products/` sind je ca. 2 MB gross. Fuer Tablets an den Kassen besser auf ca. 100-200 KB verkleinern.
