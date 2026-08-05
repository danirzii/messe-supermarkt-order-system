const socket = io();
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

let displaySettings = {
  displayAutoHideMinutes: 10,
  displayMaxReadyNumbers: 8,
  displayRefreshSeconds: 15,
  displayShowMetrics: true,
  displaySoundVolume: 70,
  displayBilingual: true
};

function minuteLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return (Number.isInteger(n) ? n : n.toFixed(1)) + ' min';
}

function updateSoundButton() {
  els.soundToggle.textContent = soundEnabled ? 'Ton aktiv / Sound on' : 'Ton aktivieren / Enable sound';
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

  const volume = Math.max(0, Math.min(1, Number(displaySettings.displaySoundVolume || 70) / 100));
  const notes = [784, 1046.5, 659.25];

  notes.forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.18;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);

    const peak = (index === 1 ? 0.18 : 0.12) * volume;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.62);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(start);
    oscillator.stop(start + 0.68);
  });
}

function scheduleAutoReload() {
  window.clearTimeout(reloadTimer);

  const seconds = Math.max(5, Math.min(120, Number(displaySettings.displayRefreshSeconds || 15)));

  reloadTimer = window.setTimeout(() => {
    loadDisplay().catch((error) => toast(error.message, 'error'));
  }, seconds * 1000);
}

function applyDisplaySettings(settings) {
  displaySettings = { ...displaySettings, ...(settings || {}) };

  document.body.dataset.showMetrics = displaySettings.displayShowMetrics === false ? 'false' : 'true';
  document.body.classList.toggle('single-language-display', displaySettings.displayBilingual === false);

  const minutes = Number(displaySettings.displayAutoHideMinutes || 0);

  if (minutes > 0) {
    els.autoHideInfo.innerHTML =
      'Nummern werden ca. ' + escapeHtml(minutes) + ' Minuten angezeigt.<br>' +
      'Numbers are shown for about ' + escapeHtml(minutes) + ' minutes.';
  } else {
    els.autoHideInfo.innerHTML =
      'Nummern bleiben sichtbar, bis sie intern entfernt werden.<br>' +
      'Numbers remain visible until removed internally.';
  }
}

async function loadDisplay() {
  const data = await fetchJson('/api/display');
  const metrics = data.metrics || {};

  applyDisplaySettings(data.settings || (data.display ? data.display.settings : null));

  currentReadyOrders = data.ready || [];

  els.avgReady.textContent = minuteLabel(metrics.averageReadyMinutes);
  els.activeOrders.textContent = metrics.activeOrderCount ?? 0;
  els.readyCount.textContent = currentReadyOrders.length;

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
    els.ready.innerHTML =
      '<div class="pickup-empty">' +
        '<strong>Willkommen<br><span>Welcome</span></strong>' +
        '<span>Fertige Bestellnummern erscheinen hier.<br>Ready order numbers will appear here.</span>' +
      '</div>';
    return;
  }

  els.ready.innerHTML = currentReadyOrders.map((order) => (
    '<article class="pickup-number-card">' +
      '<div class="pickup-number">' + escapeHtml(order.number) + '</div>' +
      '<div class="pickup-number-meta">Jetzt abholbereit / Ready now</div>' +
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
    toast('Ton aktiviert / Sound enabled');
  } else {
    toast('Ton deaktiviert / Sound disabled');
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
      els.fullscreenButton.textContent = 'Vollbild beenden / Exit fullscreen';
    } else {
      await document.exitFullscreen();
      els.fullscreenButton.textContent = 'Vollbild / Fullscreen';
    }
  } catch (error) {
    toast('Vollbild nicht verfügbar / Fullscreen is not available', 'error');
  }
});

document.addEventListener('fullscreenchange', () => {
  els.fullscreenButton.textContent = document.fullscreenElement ? 'Vollbild beenden / Exit fullscreen' : 'Vollbild / Fullscreen';
});

socket.on('orders:changed', loadDisplay);
socket.on('settings:changed', loadDisplay);

updateSoundButton();
loadDisplay().catch((error) => toast(error.message, 'error'));
