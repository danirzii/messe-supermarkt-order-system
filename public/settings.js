const socket = io();
const { fetchJson, toast } = window.OrderApp;

const DEFAULTS = {
  displayAutoHideMinutes: 10,
  displayMaxReadyNumbers: 8,
  displayRefreshSeconds: 15,
  displayShowMetrics: true,
  displaySoundVolume: 70,
  displayBilingual: true
};

const els = {
  displayAutoHideMinutes: document.getElementById('displayAutoHideMinutes'),
  displayMaxReadyNumbers: document.getElementById('displayMaxReadyNumbers'),
  displayRefreshSeconds: document.getElementById('displayRefreshSeconds'),
  displayShowMetrics: document.getElementById('displayShowMetrics'),
  displaySoundVolume: document.getElementById('displaySoundVolume'),
  displayBilingual: document.getElementById('displayBilingual'),
  saveSettings: document.getElementById('saveSettings'),
  resetDefaults: document.getElementById('resetDefaults')
};

function apply(settings) {
  const data = { ...DEFAULTS, ...(settings || {}) };

  els.displayAutoHideMinutes.value = data.displayAutoHideMinutes;
  els.displayMaxReadyNumbers.value = data.displayMaxReadyNumbers;
  els.displayRefreshSeconds.value = data.displayRefreshSeconds;
  els.displayShowMetrics.checked = data.displayShowMetrics !== false;
  els.displaySoundVolume.value = data.displaySoundVolume;
  els.displayBilingual.checked = data.displayBilingual !== false;
}

function readForm() {
  return {
    displayAutoHideMinutes: Number(els.displayAutoHideMinutes.value),
    displayMaxReadyNumbers: Number(els.displayMaxReadyNumbers.value),
    displayRefreshSeconds: Number(els.displayRefreshSeconds.value),
    displayShowMetrics: Boolean(els.displayShowMetrics.checked),
    displaySoundVolume: Number(els.displaySoundVolume.value),
    displayBilingual: Boolean(els.displayBilingual.checked)
  };
}

async function loadSettings() {
  const settings = await fetchJson('/api/settings');
  apply(settings);
}

async function saveSettings() {
  try {
    const saved = await fetchJson('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(readForm())
    });

    apply(saved);
    toast('Einstellungen gespeichert');
  } catch (error) {
    toast(error.message, 'error');
  }
}

els.saveSettings.addEventListener('click', saveSettings);
els.resetDefaults.addEventListener('click', () => apply(DEFAULTS));

socket.on('settings:changed', loadSettings);

loadSettings().catch((error) => toast(error.message, 'error'));


// ---- Pico-Status und Steuerung ----
const picoList = document.getElementById('picoList');
const picoMaxAge = document.getElementById('picoMaxAge');

function agoText(iso) {
  if (!iso) return 'noch nie gemeldet';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `vor ${seconds} s`;
  return `vor ${Math.round(seconds / 60)} min`;
}

function renderPico(data) {
  if (!picoList) return;
  if (picoMaxAge && data.jobMaxAgeSeconds) picoMaxAge.textContent = data.jobMaxAgeSeconds;
  picoList.innerHTML = (data.registers || []).map((r) => {
    const state = r.disabled ? 'bad' : (r.online ? 'ok' : 'bad');
    const label = r.disabled ? 'Aus (manuell)' : (r.online ? 'Online' : 'Offline');
    return `
      <div class="pico-settings-row">
        <strong>${r.name}</strong>
        <span class="pico-status ${state}">${label}</span>
        <span class="muted grow">zuletzt ${agoText(r.lastSeenAt)} · ${r.queued} wartet · ${r.expired} verfallen</span>
        <button type="button" class="btn-dark" data-pico="toggle" data-id="${r.registerId}" data-enabled="${r.disabled ? '1' : '0'}">${r.disabled ? 'Einschalten' : 'Ausschalten'}</button>
        <button type="button" class="btn-dark" data-pico="clear" data-id="${r.registerId}">Warteschlange leeren</button>
      </div>`;
  }).join('');
}

async function loadPico() {
  try {
    renderPico(await fetchJson('/api/pico/status'));
  } catch (error) {
    // Status ist nur Anzeige, kein Toast bei jedem Fehlversuch
  }
}

if (picoList) {
  picoList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-pico]');
    if (!button) return;
    const id = button.dataset.id;
    try {
      if (button.dataset.pico === 'toggle') {
        await fetchJson(`/api/pico/${encodeURIComponent(id)}/enabled`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: button.dataset.enabled === '1' })
        });
      } else {
        await fetchJson(`/api/pico/${encodeURIComponent(id)}/clear`, { method: 'POST' });
      }
      await loadPico();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  socket.on('pico:changed', loadPico);
  setInterval(loadPico, 4000);
  loadPico();
}
