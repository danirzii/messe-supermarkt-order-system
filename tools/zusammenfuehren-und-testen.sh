#!/bin/bash
# Fuehrt den Server-Stand (lokaler Branch server-stand, inkl. display-static.html)
# mit den Verbesserungen von GitHub zusammen und testet das Ergebnis auf Port 3099.
# Die laufende Anzeige (Port 3000) und die Bestellungen werden dabei NICHT angefasst.
LIVE=~/order-software
TEST=~/order-software-test
BRANCH=claude/relaxed-cray-pg08g4

cd "$LIVE" || { echo "FEHLER: $LIVE nicht gefunden"; exit 1; }
if ! git rev-parse --verify -q server-stand >/dev/null; then
  echo "FEHLER: Branch server-stand fehlt"; exit 1
fi

echo "== 1/4 Lade Verbesserungen von GitHub (ohne Passwort) =="
git fetch -q origin "$BRANCH" || { echo "FEHLER: Download von GitHub fehlgeschlagen"; exit 1; }

echo "== 2/4 Fuehre zusammen (im Testordner $TEST) =="
git worktree remove --force "$TEST" 2>/dev/null; rm -rf "$TEST"; git worktree prune
git branch -D zusammen 2>/dev/null >/dev/null
git worktree add -q -b zusammen "$TEST" server-stand || { echo "FEHLER: Testordner"; exit 1; }
cd "$TEST"
if ! git -c user.name="Server" -c user.email="server@local" merge -q --no-edit -m "Server-Stand + Verbesserungen" "origin/$BRANCH"; then
  echo "KONFLIKT in diesen Dateien:"
  git diff --name-only --diff-filter=U
  echo "---- Konfliktstellen (bitte an Claude schicken) ----"
  git diff | grep -n -A12 -B12 '^[+ ]<<<<<<<' | head -150
  git merge --abort
  exit 2
fi

echo "== 3/4 Starte Test-Server auf Port 3099 =="
ln -s "$LIVE/node_modules" node_modules
cp "$LIVE/data/db.json" data/db.json
PORT=3099 node server.js > /tmp/test-server.log 2>&1 &
PID=$!
sleep 3

echo "== 4/4 Pruefe Seiten =="
FEHLER=0
for URL in "/display-static.html?refresh=10" "/display.html" "/" "/cashier.html?register=1" "/station.html?station=hot1" "/dashboard.html" "/settings.html" "/api/display" "/api/pico/status" "/messe-v9.css"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3099$URL")
  if [ "$CODE" = "200" ]; then echo "  OK   $URL"; else echo "  FEHLT ($CODE) $URL"; FEHLER=1; fi
done
if curl -s "http://localhost:3099/display-static.html?refresh=10" | cmp -s - <(curl -s "http://localhost:3000/display-static.html?refresh=10"); then
  echo "  OK   display-static.html sieht genauso aus wie jetzt"
else
  echo "  HINWEIS display-static.html unterscheidet sich von der laufenden (kann an neuen Bestellungen liegen)"
fi
kill $PID 2>/dev/null
if grep -qiE "error|fehler" /tmp/test-server.log; then echo "---- Server-Log ----"; tail -20 /tmp/test-server.log; FEHLER=1; fi

if [ $FEHLER = 0 ]; then
  echo "ALLES OK - bereit zum Einspielen. Die laufende Anzeige wurde nicht veraendert."
else
  echo "PROBLEM - bitte die Ausgabe an Claude schicken. Die laufende Anzeige wurde nicht veraendert."
fi
