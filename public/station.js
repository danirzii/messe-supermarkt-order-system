const socket = io();
const { escapeHtml, fetchJson, toast, getParam, time } = window.OrderApp;
const stationId = getParam('station', 'hot1');
let station = null;

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
  await loadOrders();
}

function tickClock() {
  els.timeNow.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

async function loadOrders() {
  const orders = await fetchJson(`/api/stations/${encodeURIComponent(stationId)}/orders`);
  renderOrders(orders);
}

function renderOrders(orders) {
  els.openCount.textContent = `${orders.length} offen`;
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
  return `${minutes} min wartet`;
}

function renderOrder(order) {
  const relevant = order.items;
  const claimedByOther = relevant.find((item) => item.status === 'in_progress' && item.claimedBy && item.claimedBy !== stationId);
  const claimedByMe = relevant.some((item) => item.status === 'in_progress' && item.claimedBy === stationId);
  const isOpen = relevant.every((item) => item.status === 'open');
  const cardClass = claimedByOther ? 'order-card blocked' : claimedByMe ? 'order-card claimed' : 'order-card';
  const ownerText = claimedByOther ? stationName(claimedByOther.claimedBy) : '';

  const items = relevant.map((item) => `
    <li>
      <span class="qty-badge">${item.quantity}</span>
      <span>${escapeHtml(item.name)}</span>
    </li>
  `).join('');

  let actions = '';
  if (claimedByOther) {
    actions = `<button disabled class="btn-dark">Bei ${escapeHtml(ownerText)} in Arbeit</button>`;
  } else if (claimedByMe) {
    actions = `
      <button class="btn-green" data-action="done" data-id="${escapeHtml(order.id)}">Fertig</button>
      <button class="btn-dark" data-action="release" data-id="${escapeHtml(order.id)}">Zurücklegen</button>
    `;
  } else if (isOpen) {
    actions = `<button class="btn-blue" data-action="start" data-id="${escapeHtml(order.id)}">In Arbeit nehmen</button>`;
  } else {
    actions = `<button class="btn-green" data-action="done" data-id="${escapeHtml(order.id)}">Fertig</button>`;
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
