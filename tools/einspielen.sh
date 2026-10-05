#!/bin/bash
# Spielt den getesteten Stand (Branch "zusammen") ein.
# Bestellungen (data/db.json) und Startseite bleiben unveraendert.
# Wenn nach dem Neustart eine Seite fehlt, wird automatisch zurueckgesetzt.
LIVE=~/order-software
cd "$LIVE" || { echo "FEHLER: $LIVE nicht gefunden"; exit 1; }
git rev-parse --verify -q zusammen-neu >/dev/null || { echo "FEHLER: Erst zusammenfuehren-und-testen.sh ausfuehren"; exit 1; }

SICHER=~/vor-update-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SICHER" && cp -r data "$SICHER/" && cp public/index.html "$SICHER/"
echo "Sicherung: $SICHER"
VORHER=$(git rev-parse --abbrev-ref HEAD)
VORHER_STAND=$(git rev-parse HEAD)

git worktree remove --force ~/order-software-test 2>/dev/null; git worktree prune
# Ohne -f: db.json und index.html sind in beiden Staenden gleich und bleiben deshalb unberuehrt.
if ! git checkout -q -B zusammen zusammen-neu; then
  echo "ABGEBROCHEN - nichts veraendert. Bitte Ausgabe an Claude schicken."; exit 1
fi
pm2 restart messe-supermarkt >/dev/null
sleep 3

FEHLER=0
for URL in "/display-static.html?refresh=10" "/display.html" "/" "/cashier.html?register=1" "/api/display" "/api/pico/status"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$URL")
  if [ "$CODE" = "200" ]; then echo "  OK   $URL"; else echo "  FEHLT ($CODE) $URL"; FEHLER=1; fi
done
cmp -s data/db.json "$SICHER/data/db.json" || echo "  (Bestellungen wurden seit dem Neustart schon weitergeschrieben - normal)"

if [ $FEHLER = 0 ]; then
  echo "FERTIG - neuer Stand laeuft. Zurueck ginge mit: cd $LIVE && git checkout -B $VORHER $VORHER_STAND && pm2 restart messe-supermarkt"
else
  echo "PROBLEM - setze automatisch zurueck auf $VORHER ..."
  git checkout -q -B "$VORHER" "$VORHER_STAND" && pm2 restart messe-supermarkt >/dev/null
  echo "ZURUECKGESETZT - alter Stand laeuft wieder. Bitte Ausgabe an Claude schicken."
fi
