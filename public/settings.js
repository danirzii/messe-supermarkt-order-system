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
