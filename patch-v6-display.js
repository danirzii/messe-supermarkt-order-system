const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TARGETS = [
  'server.js',
  'public/display.html',
  'public/display.js',
  'public/dashboard.js',
  'public/styles.css'
];

function file(name) { return path.join(ROOT, name); }
function exists(name) { return fs.existsSync(file(name)); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }

function assertFile(name) {
  if (!exists(name)) throw new Error('Datei fehlt: ' + name + '. Bitte dieses Script direkt im order-system-v5 Hauptordner ausfuehren.');
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error('Konnte Stelle nicht finden: ' + label);
  return content.replace(search, replacement);
}

function insertAfter(content, marker, insertion, label) {
  if (content.includes(insertion.trim().split('\n')[0])) return content;
  if (!content.includes(marker)) throw new Error('Konnte Einfuegepunkt nicht finden: ' + label);
  return content.replace(marker, marker + '\n' + insertion);
}

function insertBefore(content, marker, insertion, label) {
  if (content.includes(insertion.trim().split('\n')[0])) return content;
  if (!content.includes(marker)) throw new Error('Konnte Einfuegepunkt nicht finden: ' + label);
  return content.replace(marker, insertion + '\n' + marker);
}

function backupFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(ROOT, 'backup-before-v6-display-' + stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const name of TARGETS) {
    assertFile(name);
    const dst = path.join(backupDir, name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file(name), dst);
  }

  return backupDir;
}

const DISPLAY_CONFIG = `
// ------------------------------------------------------------
// Abholanzeige V6
// ------------------------------------------------------------
// Fertige Nummern bleiben fuer Kunden nur eine bestimmte Zeit sichtbar.
// Danach werden sie nur von der Kundenanzeige ausgeblendet, aber NICHT
// automatisch als abgeholt markiert. Abgeholt bleibt eine interne Aktion
// im Dashboard.
const DISPLAY_AUTO_HIDE_AFTER_MS = Number(process.env.DISPLAY_AUTO_HIDE_AFTER_MS || 10 * 60 * 1000);
const DISPLAY_MAX_READY_NUMBERS = Number(process.env.DISPLAY_MAX_READY_NUMBERS || 8);
`;

const SERVER_DISPLAY_FUNCTIONS = `
function autoHideExpiredDisplayOrders(db = readDb()) {
  const now = Date.now();
  let changed = false;

  for (const order of db.orders) {
    if (order.status !== 'ready') continue;
    if (order.displayHiddenAt) continue;
    if (!order.readyAt) continue;

    const readyTime = new Date(order.readyAt).getTime();
    if (!Number.isFinite(readyTime)) continue;

    if (now - readyTime >= DISPLAY_AUTO_HIDE_AFTER_MS) {
      order.displayHiddenAt = nowIso();
      order.updatedAt = order.displayHiddenAt;
      changed = true;
    }
  }

  if (changed) writeDb(db);
  return db;
}

function isVisibleOnPickupDisplay(order, now = Date.now()) {
  if (!order || order.status !== 'ready') return false;
  if (order.displayHiddenAt) return false;
  if (!order.readyAt) return true;

  const readyTime = new Date(order.readyAt).getTime();
  if (!Number.isFinite(readyTime)) return true;

  return now - readyTime < DISPLAY_AUTO_HIDE_AFTER_MS;
}

function buildDisplaySummary(db = readDb()) {
  const now = Date.now();
  const ordersToday = db.orders.filter((order) => order.businessDate === db.businessDate);
  const readyOrders = ordersToday.filter((order) => order.status === 'ready');
  const visibleReady = readyOrders.filter((order) => isVisibleOnPickupDisplay(order, now));
  const hiddenReady = readyOrders.filter((order) => !isVisibleOnPickupDisplay(order, now));

  return {
    autoHideAfterMinutes: Math.round((DISPLAY_AUTO_HIDE_AFTER_MS / 60000) * 10) / 10,
    visibleReadyCount: visibleReady.length,
    hiddenReadyCount: hiddenReady.length,
    readyTotalCount: readyOrders.length
  };
}

function buildDisplayPayload() {
  const db = autoHideExpiredDisplayOrders(readDb());
  const now = Date.now();
  const ready = db.orders
    .filter((order) => isVisibleOnPickupDisplay(order, now))
    .sort((a, b) => new Date(a.readyAt || a.createdAt) - new Date(b.readyAt || b.createdAt))
    .slice(0, DISPLAY_MAX_READY_NUMBERS)
    .map((order) => ({
      id: order.id,
      number: order.number,
      registerName: order.registerName,
      createdAt: order.createdAt,
      readyAt: order.readyAt,
      waitMinutes: minutesRounded(msBetween(order.createdAt, order.readyAt))
    }));

  return { ready, metrics: buildTimeMetrics(db), display: buildDisplaySummary(db) };
}

function reannounceOrder(orderId) {
  const db = readDb();
  const order = findOrderOrThrow(db, orderId);

  if (order.status !== 'ready') {
    const err = new Error('Nur fertige Bestellungen koennen erneut angezeigt werden.');
    err.status = 409;
    throw err;
  }

  order.readyAt = nowIso();
  order.displayHiddenAt = null;
  order.updatedAt = order.readyAt;
  writeDb(db);
  return order;
}
`;

const DISPLAY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pickup Display · Messe Supermarkt</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="display-body pickup-display-v6" data-ready-count="0">
  <div class="pickup-shell">
    <header class="pickup-header">
      <div class="pickup-brand">
        <div class="pickup-wordmark"><span>Messe</span><span>Supermarkt</span></div>
        <div class="pickup-divider"></div>
        <div>
          <h1>Ready for pickup</h1>
          <p>Please collect your order at the counter.</p>
        </div>
      </div>
      <div class="pickup-controls no-print">
        <button id="soundToggle" type="button">Enable sound</button>
        <button id="testSound" type="button">Test sound</button>
        <button id="fullscreenButton" type="button">Fullscreen</button>
      </div>
    </header>

    <main class="pickup-main">
      <section class="pickup-status-row" aria-label="Pickup status">
        <article><span>Ready now</span><strong id="readyCount">0</strong></article>
        <article><span>In progress</span><strong id="activeOrders">0</strong></article>
        <article><span>Average wait</span><strong id="avgReady">-</strong></article>
      </section>
      <section class="pickup-board" aria-live="polite" aria-label="Ready order numbers">
        <div class="pickup-label">Order numbers</div>
        <div id="ready" class="pickup-number-grid"></div>
      </section>
    </main>

    <footer class="pickup-footer">
      <span>Numbers are shown for a limited time. If your number is no longer visible, please ask our team.</span>
      <span id="autoHideInfo">Display updates automatically.</span>
    </footer>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/app.js"></script>
  <script src="/display.js"></script>
</body>
</html>
`;

const DISPLAY_JS = `const socket = io();
const { fetchJson, escapeHtml, toast } = window.OrderApp;

const els = {
  ready: document.getElementById('ready'),
  avgReady: document.getElementById('avgReady'),
  activeOrders: document.getElementById('activeOrders'),
  readyCount: document.getElementById('readyCount'),
  soundToggle: document.getElementById('soundToggle'),
  testSound: document.getElementById('testSound'),
  fullscreenButton: document.getElementById('fullscreenButton'),
  autoHideInfo: document.getElementById('autoHideInfo')
};

let initialized = false;
let knownReadyIds = new Set();
let currentReadyOrders = [];
let soundEnabled = localStorage.getItem('pickupDisplaySoundEnabled') === '1';
let audioContext = null;
let reloadTimer = null;

function minuteLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return (Number.isInteger(n) ? n : n.toFixed(1)) + ' min';
}

function updateSoundButton() {
  els.soundToggle.textContent = soundEnabled ? 'Sound on' : 'Enable sound';
  els.soundToggle.classList.toggle('active', soundEnabled);
}

function ensureAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function playBellTone(force = false) {
  if (!soundEnabled && !force) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const notes = [784, 1046.5, 659.25];

  notes.forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.18;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(index === 1 ? 0.18 : 0.12, start + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.62);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.68);
  });
}

function scheduleAutoReload() {
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => {
    loadDisplay().catch((error) => toast(error.message, 'error'));
  }, 15000);
}

async function loadDisplay() {
  const data = await fetchJson('/api/display');
  const metrics = data.metrics || {};
  const display = data.display || {};

  currentReadyOrders = data.ready || [];

  els.avgReady.textContent = minuteLabel(metrics.averageReadyMinutes);
  els.activeOrders.textContent = metrics.activeOrderCount ?? 0;
  els.readyCount.textContent = currentReadyOrders.length;

  if (display.autoHideAfterMinutes) {
    els.autoHideInfo.textContent = 'Numbers are shown for about ' + display.autoHideAfterMinutes + ' minutes.';
  }

  document.body.dataset.readyCount = String(currentReadyOrders.length);

  const currentIds = new Set(currentReadyOrders.map((order) => order.id));
  const newReadyOrders = currentReadyOrders.filter((order) => !knownReadyIds.has(order.id));

  if (initialized && newReadyOrders.length > 0) {
    playBellTone();
  }

  initialized = true;
  knownReadyIds = currentIds;

  renderReadyNumbers();
  scheduleAutoReload();
}

function renderReadyNumbers() {
  if (!currentReadyOrders.length) {
    els.ready.innerHTML = '<div class="pickup-empty"><strong>Welcome</strong><span>Ready order numbers will appear here.</span></div>';
    return;
  }

  els.ready.innerHTML = currentReadyOrders.map((order) => (
    '<article class="pickup-number-card">' +
      '<div class="pickup-number">' + escapeHtml(order.number) + '</div>' +
      '<div class="pickup-number-meta">Ready now</div>' +
    '</article>'
  )).join('');
}

els.soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('pickupDisplaySoundEnabled', soundEnabled ? '1' : '0');
  updateSoundButton();

  if (soundEnabled) {
    ensureAudio();
    playBellTone(true);
    toast('Sound enabled');
  } else {
    toast('Sound disabled');
  }
});

els.testSound.addEventListener('click', () => {
  ensureAudio();
  playBellTone(true);
});

els.fullscreenButton.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      els.fullscreenButton.textContent = 'Exit fullscreen';
    } else {
      await document.exitFullscreen();
      els.fullscreenButton.textContent = 'Fullscreen';
    }
  } catch (error) {
    toast('Fullscreen is not available', 'error');
  }
});

document.addEventListener('fullscreenchange', () => {
  els.fullscreenButton.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});

socket.on('orders:changed', loadDisplay);
updateSoundButton();
loadDisplay().catch((error) => toast(error.message, 'error'));
`;

const CSS = `

/* ------------------------------------------------------------
   Abholanzeige V6 - englische Kundenanzeige
   ------------------------------------------------------------ */
.display-body.pickup-display-v6 {
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 16%, rgba(255, 70, 112, .18), transparent 28%),
    radial-gradient(circle at 78% 12%, rgba(255, 122, 69, .16), transparent 30%),
    linear-gradient(135deg, #10141b 0%, #171b24 55%, #0d1016 100%);
  color: #f7f4ee;
}

.pickup-display-v6::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: .18;
  background-image:
    linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 54px 54px;
  mask-image: radial-gradient(circle at center, black, transparent 86%);
}

.pickup-shell {
  position: relative;
  z-index: 1;
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: clamp(14px, 2.2vh, 26px);
  padding: clamp(18px, 2.6vw, 52px);
}

.pickup-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.pickup-brand {
  display: flex;
  align-items: center;
  gap: clamp(14px, 2vw, 30px);
}

.pickup-wordmark {
  display: grid;
  line-height: .86;
  letter-spacing: -.06em;
  font-weight: 1000;
}

.pickup-wordmark span:first-child {
  font-size: clamp(34px, 4.8vw, 94px);
  background: linear-gradient(135deg, #ff4670 0%, #ff7a45 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.pickup-wordmark span:last-child {
  font-size: clamp(20px, 2.5vw, 50px);
  color: #ff8a54;
  letter-spacing: -.04em;
}

.pickup-divider {
  width: 1px;
  height: clamp(58px, 8vw, 118px);
  background: rgba(255,255,255,.22);
}

.pickup-header h1 {
  margin: 0;
  font-size: clamp(34px, 5.5vw, 112px);
  line-height: .86;
  letter-spacing: -.075em;
  color: #fff;
}

.pickup-header p {
  margin: 10px 0 0;
  color: rgba(247,244,238,.72);
  font-size: clamp(15px, 1.55vw, 30px);
  font-weight: 750;
}

.pickup-controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.pickup-controls button {
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.14);
  color: #fff;
  background: rgba(255,255,255,.075);
  padding: 12px 16px;
  font-weight: 950;
}

.pickup-controls button.active {
  background: linear-gradient(135deg, #ff4670, #ff7a45);
}

.pickup-main {
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: clamp(14px, 2.2vh, 28px);
}

.pickup-status-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(10px, 1.4vw, 20px);
}

.pickup-status-row article {
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.055);
  border-radius: 24px;
  min-height: clamp(78px, 10vh, 126px);
  padding: clamp(14px, 1.8vw, 24px);
  display: grid;
  align-content: center;
  box-shadow: 0 24px 80px rgba(0,0,0,.20);
}

.pickup-status-row span {
  color: rgba(247,244,238,.62);
  text-transform: uppercase;
  letter-spacing: .13em;
  font-size: clamp(11px, .9vw, 15px);
  font-weight: 950;
}

.pickup-status-row strong {
  display: block;
  margin-top: 8px;
  font-size: clamp(30px, 4.6vw, 72px);
  line-height: .9;
  letter-spacing: -.07em;
  background: linear-gradient(135deg, #ff4670 0%, #ff7a45 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.pickup-board {
  min-height: 0;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.035);
  border-radius: clamp(28px, 3vw, 48px);
  padding: clamp(18px, 2.6vw, 46px);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow: 0 34px 110px rgba(0,0,0,.30);
  overflow: hidden;
}

.pickup-label {
  color: #ff7a45;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: .16em;
  font-size: clamp(14px, 1.5vw, 26px);
  font-weight: 950;
  margin-bottom: clamp(10px, 2vh, 28px);
}

.pickup-number-grid {
  min-height: 0;
  display: grid;
  gap: clamp(14px, 2vw, 28px);
  align-content: center;
  justify-content: center;
}

body[data-ready-count="0"] .pickup-number-grid {
  grid-template-columns: minmax(0, 1fr);
}

body[data-ready-count="1"] .pickup-number-grid {
  grid-template-columns: minmax(0, 1fr);
}

body[data-ready-count="2"] .pickup-number-grid,
body[data-ready-count="3"] .pickup-number-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

body[data-ready-count="4"] .pickup-number-grid,
body[data-ready-count="5"] .pickup-number-grid,
body[data-ready-count="6"] .pickup-number-grid,
body[data-ready-count="7"] .pickup-number-grid,
body[data-ready-count="8"] .pickup-number-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.pickup-number-card {
  display: grid;
  place-items: center;
  gap: clamp(6px, 1vh, 14px);
  min-width: min(26vw, 440px);
  border-radius: clamp(24px, 3vw, 46px);
  padding: clamp(12px, 2vw, 32px);
  background: linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.025));
  border: 1px solid rgba(255,255,255,.12);
}

.pickup-number {
  font-weight: 1000;
  line-height: .78;
  letter-spacing: -.085em;
  font-size: clamp(120px, 16vw, 330px);
  background: linear-gradient(135deg, #ff4670 0%, #ff7a45 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 30px 90px rgba(255, 70, 112, .10);
}

body[data-ready-count="1"] .pickup-number {
  font-size: clamp(220px, 34vw, 620px);
}

body[data-ready-count="2"] .pickup-number,
body[data-ready-count="3"] .pickup-number {
  font-size: clamp(140px, 18vw, 360px);
}

body[data-ready-count="4"] .pickup-number,
body[data-ready-count="5"] .pickup-number,
body[data-ready-count="6"] .pickup-number,
body[data-ready-count="7"] .pickup-number,
body[data-ready-count="8"] .pickup-number {
  font-size: clamp(105px, 12vw, 240px);
}

.pickup-number-meta {
  color: rgba(247,244,238,.68);
  font-size: clamp(15px, 1.3vw, 24px);
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .12em;
}

.pickup-empty {
  min-height: 38vh;
  display: grid;
  place-items: center;
  text-align: center;
  gap: 12px;
}

.pickup-empty strong {
  font-size: clamp(64px, 10vw, 180px);
  line-height: .9;
  letter-spacing: -.07em;
  background: linear-gradient(135deg, #ff4670 0%, #ff7a45 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.pickup-empty span {
  color: rgba(247,244,238,.68);
  font-size: clamp(18px, 2vw, 34px);
}

.pickup-footer {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  color: rgba(247,244,238,.58);
  font-weight: 750;
  font-size: clamp(13px, 1.2vw, 21px);
}

.badge.orange {
  background: rgba(255, 138, 71, .22);
  border-color: rgba(255, 138, 71, .32);
  color: #fff3ea;
}

@media (max-width: 900px) {
  .pickup-header,
  .pickup-footer {
    flex-direction: column;
  }

  .pickup-status-row {
    grid-template-columns: 1fr;
  }

  body[data-ready-count] .pickup-number-grid {
    grid-template-columns: 1fr;
  }

  .pickup-number,
  body[data-ready-count] .pickup-number {
    font-size: clamp(130px, 34vw, 300px);
  }
}
`;

const NEW_RENDER_ORDER_ROW = `function readyDisplayLabel(order) {
  if (order.status !== 'ready') return statusLabel(order.status);
  return order.displayHiddenAt ? 'Fertig · ausgeblendet' : 'Fertig · sichtbar';
}

function renderOrderRow(order) {
  const canComplete = order.status === 'ready';
  const canReannounce = order.status === 'ready' && order.displayHiddenAt;
  const canCancel = !['cancelled', 'completed'].includes(order.status);
  const readyMinutes = minutesBetween(order.createdAt, order.readyAt);
  const totalMinutes = minutesBetween(order.createdAt, order.completedAt);
  const timing = order.status === 'completed'
    ? minuteLabel(totalMinutes)
    : order.status === 'ready'
      ? minuteLabel(readyMinutes) + ' bis fertig'
      : '-';

  return '<tr>' +
    '<td><strong>#' + escapeHtml(order.number) + '</strong></td>' +
    '<td>' + escapeHtml(order.registerName || '') + '</td>' +
    '<td><span class="badge ' + badgeClass(order.status, order) + '">' + escapeHtml(readyDisplayLabel(order)) + '</span></td>' +
    '<td>' + euro(order.total) + '</td>' +
    '<td>' + timing + '</td>' +
    '<td><div class="actions compact-actions">' +
      '<a class="button btn-dark" href="/receipt.html?orderId=' + encodeURIComponent(order.id) + '" target="_blank">Bon</a>' +
      (canReannounce ? '<button class="btn-blue" data-action="reannounce" data-id="' + escapeHtml(order.id) + '">Wieder anzeigen</button>' : '') +
      (canComplete ? '<button class="btn-green" data-action="complete" data-id="' + escapeHtml(order.id) + '">Abgeholt</button>' : '') +
      (canCancel ? '<button class="btn-red" data-action="cancel" data-id="' + escapeHtml(order.id) + '">Storno</button>' : '') +
    '</div></td>' +
  '</tr>';
}

function badgeClass`;

function patchServer() {
  let s = read('server.js');

  if (!s.includes('DISPLAY_AUTO_HIDE_AFTER_MS')) {
    s = insertAfter(s, "const DB_FILE = path.join(DATA_DIR, 'db.json');", DISPLAY_CONFIG, 'Display-V6-Konfiguration');
  }

  const migrationLine = "    if (!Object.prototype.hasOwnProperty.call(order, 'displayClearedAt')) { order.displayClearedAt = null; changed = true; }\n";

  if (!s.includes("Object.prototype.hasOwnProperty.call(order, 'displayHiddenAt')")) {
    s = replaceOnce(
      s,
      migrationLine,
      migrationLine + "    if (!Object.prototype.hasOwnProperty.call(order, 'displayHiddenAt')) { order.displayHiddenAt = null; changed = true; }\n",
      'displayHiddenAt Migration'
    );
  }

  if (!s.includes('displayHiddenAt: null,')) {
    s = replaceOnce(
      s,
      "    displayClearedAt: null,\n    cancelReason: '',",
      "    displayClearedAt: null,\n    displayHiddenAt: null,\n    cancelReason: '',",
      'displayHiddenAt bei neuer Bestellung'
    );
  }

  if (!s.includes('function autoHideExpiredDisplayOrders')) {
    s = insertBefore(s, 'function productPayload(body) {', SERVER_DISPLAY_FUNCTIONS, 'Display-V6-Funktionen');
  }

  if (!s.includes('display: buildDisplaySummary(db),')) {
    if (s.includes('    hourlyOrders,\n    timeMetrics,')) {
      s = replaceOnce(
        s,
        '    hourlyOrders,\n    timeMetrics,',
        '    hourlyOrders,\n    display: buildDisplaySummary(db),\n    timeMetrics,',
        'Display-Summary im Dashboard'
      );
    } else if (s.includes('    timeMetrics,\n    recentOrders:')) {
      s = replaceOnce(
        s,
        '    timeMetrics,\n    recentOrders:',
        '    display: buildDisplaySummary(db),\n    timeMetrics,\n    recentOrders:',
        'Display-Summary im Dashboard'
      );
    } else {
      throw new Error('Konnte Dashboard-Return fuer display summary nicht finden.');
    }
  }

  if (!s.includes('res.json(buildDisplayPayload());')) {
    const start = s.indexOf("app.get('/api/display', (req, res) => {");
    const endMarker = "\n\napp.post('/api/display/clear-ready'";
    const end = s.indexOf(endMarker, start);

    if (start === -1 || end === -1) throw new Error('Konnte /api/display Route nicht finden.');

    const newRoute = "app.get('/api/display', (req, res) => {\n  res.json(buildDisplayPayload());\n});";
    s = s.slice(0, start) + newRoute + s.slice(end);
  }

  if (!s.includes("app.post('/api/orders/:orderId/reannounce'")) {
    const route = `
app.post('/api/orders/:orderId/reannounce', (req, res) => {
  try {
    const order = reannounceOrder(req.params.orderId);
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});
`;
    s = insertBefore(s, "app.get('/api/stations/:stationId/orders'", route, 'Reannounce-Route');
  }

  write('server.js', s);
}

function patchDisplayFiles() {
  write('public/display.html', DISPLAY_HTML);
  write('public/display.js', DISPLAY_JS);
}

function patchDashboardJs() {
  let s = read('public/dashboard.js');

  if (!s.includes('display.visibleReadyCount')) {
    const statusRegex = /const statusRows = \[[\s\S]*?\n  \];\n  els\.statusTotals/;
    const replacement = `const display = data.display || {};
  const statusRows = [
    ['Offen', data.statusCounts.open || 0],
    ['In Arbeit', data.statusCounts.in_production || 0],
    ['Abholbereit sichtbar', display.visibleReadyCount ?? (data.statusCounts.ready || 0)],
    ['Abholbereit ausgeblendet', display.hiddenReadyCount ?? 0],
    ['Abgeholt', data.statusCounts.completed || 0],
    ['Storniert', data.statusCounts.cancelled || 0],
    ['Älteste aktive Bestellung', minuteLabel(metrics.oldestActiveMinutes)]
  ];
  els.statusTotals`;

    if (!statusRegex.test(s)) throw new Error('Konnte statusRows in dashboard.js nicht finden.');
    s = s.replace(statusRegex, replacement);
  }

  if (!s.includes('function readyDisplayLabel(order)')) {
    const renderStart = s.indexOf('function renderOrderRow(order) {');
    const badgeStart = s.indexOf('function badgeClass', renderStart);

    if (renderStart === -1 || badgeStart === -1) throw new Error('Konnte renderOrderRow in dashboard.js nicht finden.');

    s = s.slice(0, renderStart) + NEW_RENDER_ORDER_ROW + s.slice(badgeStart + 'function badgeClass'.length);
  }

  const badgeRegex = /function badgeClass\(status[^)]*\) \{[\s\S]*?\n\}\n\nasync function runOrderAction/;

  if (badgeRegex.test(s)) {
    const badgeFunction = `function badgeClass(status, order = {}) {
  if (status === 'ready' && order.displayHiddenAt) return 'orange';
  if (status === 'ready') return 'green';
  if (status === 'cancelled') return 'red';
  if (status === 'in_production') return 'blue';
  if (status === 'completed') return 'dark';
  return 'dark';
}

async function runOrderAction`;

    s = s.replace(badgeRegex, badgeFunction);
  }

  if (!s.includes("action === 'reannounce'")) {
    const insert = `    if (action === 'reannounce') {
      await fetchJson(\`/api/orders/\${encodeURIComponent(orderId)}/reannounce\`, {
        method: 'POST',
        body: JSON.stringify({})
      });
    }
`;

    s = replaceOnce(
      s,
      "    if (action === 'complete') {",
      insert + "    if (action === 'complete') {",
      'reannounce action vor complete'
    );
  }

  write('public/dashboard.js', s);
}

function patchStyles() {
  let s = read('public/styles.css');

  if (!s.includes('Abholanzeige V6 - englische Kundenanzeige')) {
    s += CSS;
  }

  write('public/styles.css', s);
}

function main() {
  for (const target of TARGETS) assertFile(target);

  const backupDir = backupFiles();

  patchServer();
  patchDisplayFiles();
  patchDashboardJs();
  patchStyles();

  console.log('Fertig: Abholanzeige V6 wurde eingetragen.');
  console.log('Backup erstellt in: ' + backupDir);
  console.log('Danach Server neu starten und /display.html mit Strg+F5 neu laden.');
}

main();
