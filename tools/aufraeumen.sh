#!/bin/bash
# Raeumt alte Backup-Ordner im Home-Ordner auf. Bestellungsdaten aller alten Ordner
# werden vorher in ein Archiv (archiv-bestellungen-*.tar.gz) gepackt. Der laufende Ordner bleibt.
cd ~ || exit 1
# Nur aufraeumen, wenn das laufende System gesund ist
if [ "$(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/display-static.html?refresh=10')" != "200" ]; then
  echo "ABGEBROCHEN: Server antwortet nicht richtig - nichts geloescht."
else
  echo "Platz vorher: $(du -sh ~ 2>/dev/null | cut -f1)"
  ARCHIV=~/archiv-bestellungen-$(date +%Y%m%d-%H%M%S)
  mkdir -p "$ARCHIV"
  ALT=$(ls -d ~/order-software-backup ~/order-software-backup-* ~/order-software-neu* ~/vor-update-* 2>/dev/null)
  # 1. Bestellungsdaten aller alten Ordner sichern
  for D in $ALT; do
    N=$(basename "$D")
    if [ -d "$D/data" ]; then mkdir -p "$ARCHIV/$N" && cp -r "$D/data" "$ARCHIV/$N/"; fi
    [ -f "$D/db.json" ] && mkdir -p "$ARCHIV/$N" && cp "$D/db.json" "$ARCHIV/$N/"
  done
  for F in ~/db-vor-tausch-*.json; do [ -f "$F" ] && cp "$F" "$ARCHIV/"; done
  # 2. Reste im laufenden Ordner (alte Kopien/Sicherungsdateien) ins Archiv verschieben
  mkdir -p "$ARCHIV/reste-im-live-ordner/public"
  [ -d ~/order-software/order-software ] && mv ~/order-software/order-software "$ARCHIV/reste-im-live-ordner/"
  for D in ~/order-software/backup-before-*; do [ -d "$D" ] && mv "$D" "$ARCHIV/reste-im-live-ordner/"; done
  for F in ~/order-software/public/*.backup-* ~/order-software/public/*.kaputt-backup-*; do [ -f "$F" ] && mv "$F" "$ARCHIV/reste-im-live-ordner/public/"; done
  # 3. Archiv packen und pruefen, erst dann loeschen
  tar -czf "$ARCHIV.tar.gz" --exclude=node_modules -C ~ "$(basename "$ARCHIV")"
  if tar -tzf "$ARCHIV.tar.gz" >/dev/null 2>&1; then
    rm -rf "$ARCHIV" $ALT ~/db-vor-tausch-*.json
    git -C ~/order-software worktree prune 2>/dev/null
    echo "Archiv: $ARCHIV.tar.gz ($(du -h "$ARCHIV.tar.gz" | cut -f1))"
    echo "Geloescht: $(echo $ALT | wc -w) alte Ordner"
    echo "Platz nachher: $(du -sh ~ 2>/dev/null | cut -f1)"
    echo "Server-Check: $(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/display-static.html?refresh=10') (200 = alles gut)"
  else
    echo "Archiv fehlerhaft - NICHTS geloescht. Bitte an Claude melden."
  fi
fi
