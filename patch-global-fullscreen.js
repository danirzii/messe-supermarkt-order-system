const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const APP_FILE = path.join(ROOT, 'public', 'app.js');
const CSS_FILE = path.join(ROOT, 'public', 'styles.css');

function assertFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error('Datei nicht gefunden: ' + file);
  }
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = file + '.backup-before-global-fullscreen-' + stamp;
  fs.copyFileSync(file, backupFile);
  return backupFile;
}

function appendOnce(file, marker, content) {
  let s = fs.readFileSync(file, 'utf8');

  if (s.includes(marker)) {
    console.log(path.basename(file) + ': schon vorhanden, ueberspringe.');
    return;
  }

  backup(file);
  s += '\n\n' + content.trim() + '\n';
  fs.writeFileSync(file, s, 'utf8');

  console.log(path.basename(file) + ': Vollbild-Erweiterung eingetragen.');
}

assertFile(APP_FILE);
assertFile(CSS_FILE);

const js = `
// ------------------------------------------------------------
// Global Fullscreen Button V1
// ------------------------------------------------------------
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function fullscreenSupported() {
    return Boolean(
      document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen
    );
  }

  function currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function requestFullscreen(element) {
    if (element.requestFullscreen) return element.requestFullscreen();
    if (element.webkitRequestFullscreen) return element.webkitRequestFullscreen();
    return Promise.reject(new Error('Fullscreen not supported'));
  }

  function exitFullscreen() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return Promise.reject(new Error('Exit fullscreen not supported'));
  }

  function updateButton(button) {
    var isFullscreen = Boolean(currentFullscreenElement());
    var label = isFullscreen ? 'Vollbild beenden' : 'Vollbild';

    button.querySelector('strong').textContent = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('active', isFullscreen);
  }

  function shouldSkipButton() {
    if (!fullscreenSupported()) return true;

    // Wenn die Seite schon einen eigenen Vollbild-Button hat, keinen zweiten anzeigen.
    if (document.getElementById('fullscreenButton')) return true;

    // Auf Druck-/Bon-Seiten nicht stoeren.
    if (window.location.pathname.indexOf('/receipt.html') !== -1) return true;

    return false;
  }

  function installGlobalFullscreenButton() {
    if (shouldSkipButton()) return;
    if (document.getElementById('globalFullscreenButton')) return;

    var button = document.createElement('button');
    button.id = 'globalFullscreenButton';
    button.type = 'button';
    button.className = 'global-fullscreen-button no-print';
    button.innerHTML = '<span class="global-fullscreen-icon">[]</span><strong>Vollbild</strong>';

    button.addEventListener('click', function () {
      if (currentFullscreenElement()) {
        exitFullscreen().catch(function () {
          alert('Vollbild konnte nicht beendet werden.');
        });
      } else {
        requestFullscreen(document.documentElement).catch(function () {
          alert('Vollbild konnte nicht gestartet werden. Bitte direkt auf den Button klicken oder F11 verwenden.');
        });
      }
    });

    document.addEventListener('fullscreenchange', function () {
      updateButton(button);
    });

    document.addEventListener('webkitfullscreenchange', function () {
      updateButton(button);
    });

    document.body.appendChild(button);
    updateButton(button);
  }

  ready(installGlobalFullscreenButton);
})();
`;

const css = `
/* ------------------------------------------------------------
   Global Fullscreen Button V1
   ------------------------------------------------------------ */
.global-fullscreen-button {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 99999;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px;
  padding: 12px 16px;
  color: #fff;
  background: linear-gradient(135deg, var(--red, #ff416c), var(--orange, #ff7a45));
  box-shadow: 0 18px 50px rgba(0,0,0,.32);
  font-weight: 950;
  cursor: pointer;
  opacity: .88;
  transition: transform .15s ease, opacity .15s ease, box-shadow .15s ease;
}

.global-fullscreen-button:hover {
  opacity: 1;
  transform: translateY(-2px);
  box-shadow: 0 22px 62px rgba(0,0,0,.42);
}

.global-fullscreen-button.active {
  background: rgba(255,255,255,.12);
  backdrop-filter: blur(14px);
}

.global-fullscreen-icon {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255,255,255,.85);
  border-radius: 7px;
  font-size: 0;
}

.global-fullscreen-button strong {
  font-size: 14px;
  letter-spacing: .01em;
}

@media (max-width: 700px) {
  .global-fullscreen-button {
    right: 12px;
    bottom: 12px;
    padding: 10px 13px;
  }

  .global-fullscreen-button strong {
    font-size: 13px;
  }
}

@media print {
  .global-fullscreen-button {
    display: none !important;
  }
}
`;

appendOnce(APP_FILE, 'Global Fullscreen Button V1', js);
appendOnce(CSS_FILE, 'Global Fullscreen Button V1', css);

console.log('Fertig: Globaler Vollbildmodus wurde eingebaut.');
console.log('Jetzt pruefen: node -c public/app.js');
console.log('Danach: pm2 restart messe-supermarkt');
