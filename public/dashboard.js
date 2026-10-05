const socket = io();
const { euro, escapeHtml, statusLabel, stationLabel, fetchJson, toast } = window.OrderApp;

const els = {
  stats: document.getElementById('stats'),
  productTotals: document.getElementById('productTotals'),
  registerTotals: document.getElementById('registerTotals'),
  recentOrders: document.getElementById('recentOrders'),
  statusTotals: document.getElementById('statusTotals'),
  stationPerformance: document.getElementById('stationPerformance'),
  timelineChart: document.getElementById('timelineChart'),
  closeDay: document.getElementById('closeDay')
};

async function loadDashboard() {
  const data = await fetchJson('/api/dashboard');
  renderDashboard(data);
}

function minuteLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')} min`;
}

function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round(((end - start) / 60000) * 10) / 10;
}

function renderDashboard(data) {
  const metrics = data.timeMetrics || {};
  const articleCount = (data.productTotals || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  els.stats.innerHTML = `
    <article class="stat-card"><span>Bestellungen</span><strong>${data.orderCount}</strong><small>heute · ${escapeHtml(data.businessDate)}</small></article>
    <article class="stat-card"><span>Umsatz</span><strong>${euro(data.revenue)}</strong><small>alle aktiven Verkäufe</small></article>
    <article class="stat-card"><span>Ø Wartezeit</span><strong>${minuteLabel(metrics.averageReadyMinutes)}</strong><small>bis abholbereit</small></article>
    <article class="stat-card"><span>Artikel</span><strong>${articleCount}</strong><small>verkaufte Positionen</small></article>
  `;

  renderTimeline(data.hourlyOrders || []);
  renderStationPerformance(data.stationPerformance || []);

  els.productTotals.innerHTML = data.productTotals.length
    ? data.productTotals.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${stationLabel(row.stationGroup)}</td>
        <td>${row.quantity}</td>
        <td>${euro(row.revenue)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">Noch keine Verkäufe.</td></tr>';

  els.registerTotals.innerHTML = data.registerTotals.length
    ? data.registerTotals.map((row) => `
      <tr><td>${escapeHtml(row.registerName)}</td><td>${row.orders}</td><td>${euro(row.revenue)}</td></tr>
    `).join('')
    : '<tr><td colspan="3">Noch keine Kassenumsatzdaten.</td></tr>';

  const display = data.display || {};
  const statusRows = [
    ['Offen', data.statusCounts.open || 0],
    ['In Arbeit', data.statusCounts.in_production || 0],
    ['Abholbereit sichtbar', display.visibleReadyCount ?? (data.statusCounts.ready || 0)],
    ['Abholbereit ausgeblendet', display.hiddenReadyCount ?? 0],
    ['Abgeholt', data.statusCounts.completed || 0],
    ['Storniert', data.statusCounts.cancelled || 0],
    ['Älteste aktive Bestellung', minuteLabel(metrics.oldestActiveMinutes)]
  ];
  els.statusTotals.innerHTML = statusRows.map(([label, count]) => `<tr><td>${label}</td><td>${count}</td></tr>`).join('');

  els.recentOrders.innerHTML = data.recentOrders.length
    ? data.recentOrders.map(renderOrderRow).join('')
    : '<tr><td colspan="6">Noch keine Bestellungen.</td></tr>';

  els.recentOrders.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => runOrderAction(button.dataset.action, button.dataset.id));
  });
}

function renderStationPerformance(rows) {
  if (!els.stationPerformance) return;
  if (!rows.length) {
    els.stationPerformance.innerHTML = '<div class="empty-state mini"><strong>Noch keine Stationsdaten</strong><span class="muted">Sobald Bestellungen bearbeitet werden, erscheinen hier Balken.</span></div>';
    return;
  }

  const maxOrders = Math.max(1, ...rows.map((row) => Number(row.orders || 0)));
  els.stationPerformance.innerHTML = rows.map((row) => {
    const pct = Math.max(6, Math.round((Number(row.orders || 0) / maxOrders) * 100));
    return `
      <article class="station-row">
        <div class="station-row-head">
          <strong>${escapeHtml(row.stationName || row.stationId || '')}</strong>
          <span>${row.orders || 0} Best. · Ø ${minuteLabel(row.averageMinutes)}</span>
        </div>
        <div class="performance-bar"><span style="width:${pct}%"></span></div>
        <div class="station-row-foot">
          <small>${Number(row.items || 0)} Artikel</small>
          <small>${euro(row.revenue || 0)}</small>
        </div>
      </article>
    `;
  }).join('');
}

function renderTimeline(rows) {
  if (!els.timelineChart) return;
  const cleanRows = rows.length ? rows : Array.from({ length: 13 }, (_, index) => ({ hour: 8 + index, label: `${String(8 + index).padStart(2, '0')}:00`, orders: 0 }));
  const max = Math.max(1, ...cleanRows.map((row) => Number(row.orders || 0)));
  const width = 760;
  const height = 260;
  const pad = 34;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const points = cleanRows.map((row, index) => {
    const x = pad + (plotW * index) / Math.max(1, cleanRows.length - 1);
    const y = pad + plotH - (plotH * Number(row.orders || 0)) / max;
    return { x, y, value: row.orders || 0, label: row.label };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${pad},${pad + plotH} ${polyline} ${pad + plotW},${pad + plotH}`;
  const xLabels = points.filter((_, i) => i % 2 === 0 || i === points.length - 1)
    .map((point) => `<text x="${point.x}" y="${height - 8}" text-anchor="middle">${escapeHtml(point.label)}</text>`)
    .join('');
  const dots = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.label)} · ${point.value} Bestellungen</title></circle>`).join('');

  els.timelineChart.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bestellungen im Zeitverlauf">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#ff6a35" stop-opacity="0.45" />
          <stop offset="100%" stop-color="#d93052" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      <g class="grid-lines">
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${pad + plotH}"></line>
        <line x1="${pad}" y1="${pad + plotH}" x2="${pad + plotW}" y2="${pad + plotH}"></line>
        <line x1="${pad}" y1="${pad + plotH / 2}" x2="${pad + plotW}" y2="${pad + plotH / 2}"></line>
        <text x="8" y="${pad + 6}">${max}</text>
        ${max >= 2 ? `<text x="8" y="${pad + plotH / 2 + 5}">${Math.round(max / 2)}</text>` : ''}
        <text x="8" y="${pad + plotH + 5}">0</text>
      </g>
      <polygon class="chart-area" points="${area}"></polygon>
      <polyline class="chart-line" points="${polyline}"></polyline>
      <g class="chart-dots">${dots}</g>
      <g class="chart-labels">${xLabels}</g>
    </svg>
  `;
}

function readyDisplayLabel(order) {
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

function badgeClass(status, order = {}) {
  if (status === 'ready' && order.displayHiddenAt) return 'orange';
  if (status === 'ready') return 'green';
  if (status === 'cancelled') return 'red';
  if (status === 'in_production') return 'blue';
  if (status === 'completed') return 'dark';
  return 'dark';
}

async function runOrderAction(action, orderId) {
  try {
    if (action === 'cancel') {
      const reason = window.prompt('Storno-Grund optional:', '') || '';
      await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    }
    if (action === 'reannounce') {
      await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/reannounce`, {
        method: 'POST',
        body: JSON.stringify({})
      });
    }
    if (action === 'complete') {
      await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({})
      });
    }
    await loadDashboard();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function closeDay() {
  const confirmText = window.prompt('Tagesabschluss startet einen neuen Tag und setzt Bestellungen sowie Nummern zurück. Schreibe ABSCHLUSS zur Bestätigung:');
  if (confirmText !== 'ABSCHLUSS') return;
  try {
    const result = await fetchJson('/api/day-close', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'ABSCHLUSS' })
    });
    toast(`Abschluss gespeichert: ${result.filename}`);
    await loadDashboard();
  } catch (error) {
    toast(error.message, 'error');
  }
}

els.closeDay.addEventListener('click', closeDay);
socket.on('dashboard:changed', loadDashboard);
loadDashboard().catch((error) => toast(error.message, 'error'));
