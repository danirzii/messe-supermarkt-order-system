const socket = io();
const { fetchJson, escapeHtml, toast } = window.OrderApp;

const els = {
  ready: document.getElementById('ready'),
  avgReady: document.getElementById('avgReady'),
  activeOrders: document.getElementById('activeOrders'),
  readyCount: document.getElementById('readyCount'),
  soundToggle: document.getElementById('soundToggle'),
  staffToggle: document.getElementById('staffToggle'),
  staffPanel: document.getElementById('staffPanel'),
  clearAllReady: document.getElementById('clearAllReady')
};

let initialized = false;
let knownReadyIds = new Set();
let currentReadyOrders = [];
let soundEnabled = localStorage.getItem('displaySoundEnabled') === '1';
let audioContext = null;

function minuteLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return `${Number.isInteger(n) ? n : n.toFixed(1)} min`;
}

function updateSoundButton() {
  els.soundToggle.textContent = soundEnabled ? 'Ton ist aktiv' : 'Ton aktivieren';
  els.soundToggle.classList.toggle('btn-green', soundEnabled);
}

function ensureAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function playToneSequence(count = 1) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const tones = Math.min(Math.max(count, 1), 3);
  for (let i = 0; i < tones; i += 1) {
    const start = ctx.currentTime + i * 0.22;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.exponentialRampToValueAtTime(1320, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  }
}

async function loadDisplay() {
  const data = await fetchJson('/api/display');
  const metrics = data.metrics || {};
  currentReadyOrders = data.ready || [];

  els.avgReady.textContent = minuteLabel(metrics.averageReadyMinutes);
  els.activeOrders.textContent = metrics.activeOrderCount ?? 0;
  els.readyCount.textContent = metrics.readyOrderCount ?? currentReadyOrders.length;

  const currentIds = new Set(currentReadyOrders.map((order) => order.id));
  const newReadyOrders = currentReadyOrders.filter((order) => !knownReadyIds.has(order.id));

  if (initialized && newReadyOrders.length > 0) {
    playToneSequence(newReadyOrders.length);
  }
  initialized = true;
  knownReadyIds = currentIds;

  if (!currentReadyOrders.length) {
    els.ready.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div><strong>Noch nichts fertig</strong><span class="muted">Bitte kurz warten.</span></div></div>';
    return;
  }

  els.ready.innerHTML = currentReadyOrders.map((order) => renderReadyOrder(order)).join('');
  els.ready.querySelectorAll('button[data-action="clear-one"]').forEach((button) => {
    button.addEventListener('click', () => clearOne(button.dataset.id));
  });
}

function renderReadyOrder(order) {
  return `
    <article class="ready-number-card">
      <div class="ready-number">#${order.number}</div>
      <div class="ready-meta">
        <span>${escapeHtml(order.registerName || '')}</span>
        <span>Wartezeit: ${minuteLabel(order.waitMinutes)}</span>
      </div>
      <button class="ready-clear staff-only" data-action="clear-one" data-id="${escapeHtml(order.id)}" type="button">Entfernen</button>
    </article>
  `;
}

async function clearOne(orderId) {
  try {
    await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    toast('Nummer entfernt');
    await loadDisplay();
  } catch (error) {
    toast(error.message, 'error');
    await loadDisplay();
  }
}

async function clearAllReady() {
  if (!currentReadyOrders.length) return;
  const ok = window.confirm('Alle fertigen Nummern von der Anzeige entfernen? Das zählt als abgeholt.');
  if (!ok) return;
  try {
    const result = await fetchJson('/api/display/clear-ready', {
      method: 'POST',
      body: JSON.stringify({})
    });
    toast(`${result.completedCount} Nummern entfernt`);
    await loadDisplay();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function toggleStaffMode() {
  document.body.classList.toggle('staff-mode');
  const active = document.body.classList.contains('staff-mode');
  els.staffPanel.hidden = !active;
  els.staffToggle.textContent = active ? 'Bedienmodus aus' : 'Bedienmodus';
}

els.soundToggle.addEventListener('click', async () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('displaySoundEnabled', soundEnabled ? '1' : '0');
  if (soundEnabled) {
    ensureAudio();
    playToneSequence(1);
    toast('Ton aktiviert');
  } else {
    toast('Ton deaktiviert');
  }
  updateSoundButton();
});

els.staffToggle.addEventListener('click', toggleStaffMode);
els.clearAllReady.addEventListener('click', clearAllReady);

socket.on('orders:changed', loadDisplay);
updateSoundButton();
loadDisplay().catch((error) => toast(error.message, 'error'));
