# Messe Supermarkt Order-System Pro v3

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

