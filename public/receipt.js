const { euro, escapeHtml, dateTime, statusLabel, fetchJson, getParam } = window.OrderApp;
const root = document.getElementById('receipt');
const orderId = getParam('orderId', '');

async function loadReceipt() {
  if (!orderId) {
    root.textContent = 'Keine Bestellung ausgewaehlt.';
    return;
  }
  const order = await fetchJson(`/api/orders/${encodeURIComponent(orderId)}`);
  root.innerHTML = `
    <h1>Messe Supermarkt</h1>
    <div style="text-align:center;">Bestellbon</div>
    <div class="receipt-number">#${order.number}</div>
    <div class="receipt-row"><span>Kasse</span><strong>${escapeHtml(order.registerName || '')}</strong></div>
    <div class="receipt-row"><span>Zeit</span><strong>${dateTime(order.createdAt)}</strong></div>
    <div class="receipt-row"><span>Status</span><strong>${statusLabel(order.status)}</strong></div>
    ${order.customerName ? `<div class="receipt-row"><span>Kunde</span><strong>${escapeHtml(order.customerName)}</strong></div>` : ''}
    <hr>
    ${order.items.map((item) => `
      <div class="receipt-row">
        <span>${item.quantity} x ${escapeHtml(item.name)}</span>
        <strong>${euro(item.quantity * item.price)}</strong>
      </div>
    `).join('')}
    <hr>
    <div class="receipt-row" style="font-size: 22px;"><span>Gesamt</span><strong>${euro(order.total)}</strong></div>
    ${order.note ? `<p><strong>Notiz:</strong> ${escapeHtml(order.note)}</p>` : ''}
    <p style="text-align:center; margin-top: 22px;">Danke für Ihren Einkauf.</p>
  `;
}

loadReceipt().catch((error) => { root.textContent = error.message; });
