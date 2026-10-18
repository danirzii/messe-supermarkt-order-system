const socket = io();
const { escapeHtml, fetchJson, toast, getParam, time } = window.OrderApp;
const stationId = getParam('station', 'hot1');
let station = null;

// Erinnerung an vergessene "Fertig"-Klicks. Bei hohem Andrang warten alle Bestellungen laenger,
// deshalb zaehlt vor allem: Eine NEUERE Bestellung ist schon fertig, die aeltere steht noch offen.
const VERGESSEN_UEBERHOLT_MINUTEN = 2;   // so lange ist die neuere Bestellung schon fertig
const VERGESSEN_NOTBREMSE_MINUTEN = 15;  // unabhaengig davon: so lange offen = markieren
const ERINNERUNGSTON_ABSTAND_SEKUNDEN = 90;

let currentOrders = [];
let lastSeen = new Map();          // orderId -> createdAt (ms) der zuletzt angezeigten Bestellungen
let finishedEvents = [];           // { createdAt, finishedAt } von Bestellungen, die hier erledigt wurden
let lastReminderAt = 0;
let soundOn = false;
try { soundOn = localStorage.getItem('stationSound') === '1'; } catch (error) { soundOn = false; }
let audioCtx = null;

const els = {
  pageTitle: document.getElementById('pageTitle'),
  subtitle: document.getElementById('subtitle'),
  orders: document.getElementById('orders'),
  openCount: document.getElementById('openCount'),
  timeNow: document.getElementById('timeNow'),
  refresh: document.getElementById('refresh')
};

async function init() {
  const config = await fetchJson('/api/config');
  station = config.stations.find((item) => item.id === stationId);
  if (!station) throw new Error('Station nicht gefunden.');
  els.pageTitle.textContent = station.name;
  els.subtitle.textContent = station.group === 'hot'
    ? 'Beide Heißtheken sehen dieselbe Heiß-Warteschlange. Wer startet, reserviert die Bestellung.'
    : 'Kaffee-Station sieht nur Kaffeeartikel.';
  tickClock();
  window.setInterval(tickClock, 10000);
  installSoundButton();
  window.setInterval(() => renderOrders(currentOrders), 20000);
  await loadOrders();
}

function tickClock() {
  els.timeNow.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

async function loadOrders() {
  const orders = await fetchJson(`/api/stations/${encodeURIComponent(stationId)}/orders`);
  const stillOpen = new Set(orders.map((order) => order.id));
  const gone = Array.from(lastSeen.keys()).filter((id) => !stillOpen.has(id));
  for (const id of gone) {
    const createdAt = lastSeen.get(id);
    lastSeen.delete(id);
    // Stornierte Bestellungen zaehlen nicht als "fertig"
    try {
      const order = await fetchJson(`/api/orders/${encodeURIComponent(id)}`);
      if (order && order.status === 'cancelled') continue;
    } catch (error) { /* im Zweifel als fertig werten */ }
    finishedEvents.push({ createdAt, finishedAt: Date.now() });
  }
  finishedEvents = finishedEvents.slice(-50);
  for (const order of orders) lastSeen.set(order.id, new Date(order.createdAt).getTime());
  currentOrders = orders;
  renderOrders(orders);
}

function isForgotten(order) {
  const created = new Date(order.createdAt).getTime();
  const now = Date.now();
  if (now - created >= VERGESSEN_NOTBREMSE_MINUTEN * 60000) return true;
  return finishedEvents.some((event) => event.createdAt > created
    && now - event.finishedAt >= VERGESSEN_UEBERHOLT_MINUTEN * 60000);
}

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = i === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + offset);
      osc.stop(audioCtx.currentTime + offset + 0.25);
    });
  } catch (error) { /* kein Ton moeglich */ }
}

function renderForgottenBanner(count) {
  let banner = document.getElementById('forgottenBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'forgottenBanner';
    banner.className = 'forgotten-banner';
    els.orders.parentNode.insertBefore(banner, els.orders);
  }
  banner.hidden = count === 0;
  banner.textContent = count === 1
    ? '1 Bestellung wartet, obwohl neuere schon raus sind – schon fertig? Dann bitte „Fertig“ drücken.'
    : `${count} Bestellungen warten, obwohl neuere schon raus sind – schon fertig? Dann bitte „Fertig“ drücken.`;
  if (count > 0 && soundOn && Date.now() - lastReminderAt >= ERINNERUNGSTON_ABSTAND_SEKUNDEN * 1000) {
    lastReminderAt = Date.now();
    beep();
  }
}

function installSoundButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-dark';
  const label = () => { button.textContent = soundOn ? 'Erinnerungston: an' : 'Erinnerungston: aus'; };
  label();
  button.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem('stationSound', soundOn ? '1' : '0'); } catch (error) { /* egal */ }
    if (soundOn) beep();
    label();
  });
  // Ton- und Aktualisieren-Knopf rechts zusammen gruppieren
  const group = document.createElement('div');
  group.className = 'toolbar-buttons';
  els.refresh.parentNode.insertBefore(group, els.refresh);
  group.appendChild(button);
  group.appendChild(els.refresh);
}

function renderOrders(orders) {
  els.openCount.textContent = `${orders.length} offen`;
  renderForgottenBanner(orders.filter(isForgotten).length);
  if (orders.length === 0) {
    els.orders.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div><strong>Alles sauber</strong><span class="muted">Keine offenen Bestellungen für diese Station.</span></div></div>';
    return;
  }

  els.orders.innerHTML = orders.map((order) => renderOrder(order)).join('');
  els.orders.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action, button.dataset.id));
  });
}


function minutesSince(iso) {
  if (!iso) return null;
  const start = new Date(iso).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((Date.now() - start) / 60000));
}

function waitLabel(iso) {
  const minutes = minutesSince(iso);
  if (minutes === null) return '';
  if (minutes < 1) return 'gerade eben';
  if (minutes >= 24 * 60) return 'über 1 Tag alt';
  if (minutes >= 120) return `über ${Math.floor(minutes / 60)} Std. wartet`;
  return `${minutes} min wartet`;
}

function renderOrder(order) {
  const relevant = order.items;
  const claimedByOther = relevant.find((item) => item.status === 'in_progress' && item.claimedBy && item.claimedBy !== stationId);
  const claimedByMe = relevant.some((item) => item.status === 'in_progress' && item.claimedBy === stationId);
  const isOpen = relevant.every((item) => item.status === 'open');
  const age = minutesSince(order.createdAt);
  const ageClass = age >= 10 ? ' late' : age >= 5 ? ' warn' : '';
  const forgotten = !claimedByOther && isForgotten(order);
  const cardClass = (claimedByOther ? 'order-card blocked' : claimedByMe ? 'order-card claimed' : 'order-card') + ageClass + (forgotten ? ' forgotten' : '');
  const ownerText = claimedByOther ? stationName(claimedByOther.claimedBy) : '';

  const items = relevant.map((item) => `
    <li>
      <span class="qty-badge">${item.quantity}</span>
      <span>${escapeHtml(item.name)}</span>
    </li>
  `).join('');

  // Ein Tipp genuegt: "Fertig" ist immer der grosse Hauptknopf.
  let actions = '';
  if (claimedByOther) {
    actions = `<button disabled class="btn-dark">Bei ${escapeHtml(ownerText)} in Arbeit</button>`;
  } else {
    actions = `<button class="btn-green btn-done" data-action="done" data-id="${escapeHtml(order.id)}">Fertig</button>`;
    if (claimedByMe) {
      actions += `<button class="btn-dark btn-secondary" data-action="release" data-id="${escapeHtml(order.id)}">Zurücklegen</button>`;
    } else if (isOpen) {
      actions += `<button class="btn-dark btn-secondary" data-action="start" data-id="${escapeHtml(order.id)}">In Arbeit nehmen</button>`;
    }
  }

  return `
    <article class="${cardClass}">
      <div class="order-head">
        <div class="order-no">#${order.number}</div>
        <div class="order-meta">
          <span class="badge ${claimedByMe ? 'green' : claimedByOther ? 'red' : 'dark'}">${claimedByMe ? 'Deins' : claimedByOther ? 'Besetzt' : 'Offen'}</span>
          <span>${escapeHtml(order.registerName || '')}</span>
          <span>${time(order.createdAt)} Uhr</span>
          <span class="badge ${minutesSince(order.createdAt) >= 10 ? 'red' : minutesSince(order.createdAt) >= 5 ? 'blue' : 'dark'}">${waitLabel(order.createdAt)}</span>
        </div>
      </div>
      ${forgotten ? '<div class="forgotten-hint">Schon fertig? Neuere Bestellung ist bereits raus.</div>' : ''}
      <ul class="order-items">${items}</ul>
      ${order.customerName ? `<div class="note-box"><strong>Kunde:</strong> ${escapeHtml(order.customerName)}</div>` : ''}
      ${order.note ? `<div class="note-box"><strong>Notiz:</strong> ${escapeHtml(order.note)}</div>` : ''}
      <div class="actions">${actions}</div>
    </article>
  `;
}

function stationName(id) {
  const names = { hot1: 'Heißtheke 1', hot2: 'Heißtheke 2', coffee: 'Kaffee' };
  return names[id] || id;
}

async function runAction(action, orderId) {
  try {
    await fetchJson(`/api/stations/${encodeURIComponent(stationId)}/orders/${encodeURIComponent(orderId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    await loadOrders();
  } catch (error) {
    toast(error.message, 'error');
    await loadOrders();
  }
}

els.refresh.addEventListener('click', loadOrders);
socket.on('orders:changed', loadOrders);
init().catch((error) => toast(error.message, 'error'));
