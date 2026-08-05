const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CLOSURES_DIR = path.join(DATA_DIR, 'closures');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ------------------------------------------------------------
// Programm-Einstellungen V7
// ------------------------------------------------------------
// Diese Werte sind nur Standardwerte. Die echten Einstellungen werden
// in data/db.json gespeichert und koennen ueber /settings.html geaendert werden.
const DEFAULT_APP_SETTINGS = {
  displayAutoHideMinutes: 10,
  displayMaxReadyNumbers: 8,
  displayRefreshSeconds: 15,
  displayShowMetrics: true,
  displaySoundVolume: 70,
  displayBilingual: true
};

// Kompatibilität für alte V6-Stellen, falls noch irgendwo vorhanden.
// Die neue Logik nutzt eigentlich db.settings, aber diese Konstanten
// verhindern ReferenceError, falls ein alter Block noch geladen wird.
const DISPLAY_AUTO_HIDE_AFTER_MS = Number(process.env.DISPLAY_AUTO_HIDE_AFTER_MS || DEFAULT_APP_SETTINGS.displayAutoHideMinutes * 60 * 1000);
const DISPLAY_MAX_READY_NUMBERS = Number(process.env.DISPLAY_MAX_READY_NUMBERS || DEFAULT_APP_SETTINGS.displayMaxReadyNumbers);



const REGISTERS = [
  { id: '1', name: 'Kasse 1' },
  { id: '2', name: 'Kasse 2' },
  { id: '3', name: 'Kasse 3' },
  { id: '4', name: 'Kasse 4' }
];

const STATIONS = [
  { id: 'hot1', name: 'Heißtheke 1', group: 'hot' },
  { id: 'hot2', name: 'Heißtheke 2', group: 'hot' },
  { id: 'coffee', name: 'Kaffee & Getränke', group: 'coffee' }
];

const DEFAULT_PRODUCTS = [
  { id: 'schnitzel_broetchen', name: 'Schnitzel-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.90, active: true, image: '/assets/products/schnitzel-broetchen.png', cashierCode: '' },
  { id: 'leberkaese_broetchen', name: 'Leberkäse-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.50, active: true, image: '/assets/products/leberkaese-broetchen.png', cashierCode: '' },
  { id: 'frikadelle_broetchen', name: 'Frikadellen-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.20, active: true, image: '/assets/products/frikadelle-broetchen.png', cashierCode: '' },
  { id: 'kassler_broetchen', name: 'Kassler-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.80, active: true, image: '/assets/products/kassler-broetchen.png', cashierCode: '' },
  { id: 'bockwurst', name: 'Bockwurst', category: 'Heißtheke', stationGroup: 'hot', price: 3.80, active: true, image: '/assets/products/bockwurst.png', cashierCode: '' },
  { id: 'kaffee', name: 'Kaffee', category: 'Kaffee', stationGroup: 'coffee', price: 2.20, active: true, cashierCode: '' },
  { id: 'kaffee_crema', name: 'Kaffee Crema', category: 'Kaffee', stationGroup: 'coffee', price: 2.50, active: true, cashierCode: '' },
  { id: 'cappuccino', name: 'Cappuccino', category: 'Kaffee', stationGroup: 'coffee', price: 3.10, active: true, cashierCode: '' },
  { id: 'latte_macchiato', name: 'Latte Macchiato', category: 'Kaffee', stationGroup: 'coffee', price: 3.30, active: true, cashierCode: '' },
  { id: 'milchkaffee', name: 'Milchkaffee', category: 'Kaffee', stationGroup: 'coffee', price: 3.00, active: true, cashierCode: '' },
  { id: 'milchschock', name: 'Milchschock', category: 'Kaffee', stationGroup: 'coffee', price: 2.80, active: true, cashierCode: '' },
  { id: 'cola_05', name: 'Cola 0,5 l', category: 'Getränke', stationGroup: 'coffee', price: 2.30, active: true, cashierCode: '' },
  { id: 'wasser_05', name: 'Wasser 0,5 l', category: 'Getränke', stationGroup: 'coffee', price: 1.80, active: true, cashierCode: '' },
  { id: 'apfelschorle_05', name: 'Apfelschorle 0,5 l', category: 'Getränke', stationGroup: 'coffee', price: 2.20, active: true, cashierCode: '' }
];


// ------------------------------------------------------------
// Kassen-Tastatur-Bruecke ueber Raspberry Pi Pico W
// ------------------------------------------------------------
// Erst auf true setzen, wenn der Pico fertig eingerichtet ist.
// Solange false, laeuft das Bestellsystem normal weiter und der Klick
// auf ein Produkt wird nur intern in den Warenkorb gelegt.
const CASH_REGISTER_KEYBOARD_ENABLED = false;

// Weil die Kasse mehrere Codes direkt hintereinander nicht sauber versteht,
// werden Klicks pro Kasse serverseitig nacheinander abgearbeitet.
const CASH_REGISTER_SEND_DELAY_MS = 900;

// Platzhalter: spaeter die echten Pico-IP-Adressen und Tokens eintragen.
// Beispiel URL spaeter: http://192.168.1.61/type
const CASH_REGISTER_KEYBOARDS = {
  '1': { name: 'Kasse 1 Pico', url: 'http://PICO_KASSE_1_IP/type', token: 'PICO_TOKEN_HIER_EINTRAGEN' },
  '2': { name: 'Kasse 2 Pico', url: 'http://PICO_KASSE_2_IP/type', token: 'PICO_TOKEN_HIER_EINTRAGEN' },
  '3': { name: 'Kasse 3 Pico', url: 'http://PICO_KASSE_3_IP/type', token: 'PICO_TOKEN_HIER_EINTRAGEN' },
  '4': { name: 'Kasse 4 Pico', url: 'http://PICO_KASSE_4_IP/type', token: 'PICO_TOKEN_HIER_EINTRAGEN' }
};

const cashRegisterQueues = new Map();

const CASH_REGISTER_POLLING_TOKEN = process.env.CASH_REGISTER_POLLING_TOKEN || 'kasse1-test';
const cashRegisterPollingQueues = new Map();

function getPollingQueue(registerId) {
  const key = String(registerId);
  if (!cashRegisterPollingQueues.has(key)) cashRegisterPollingQueues.set(key, []);
  return cashRegisterPollingQueues.get(key);
}

function enqueuePollingKeyboardCode(registerId, code) {
  const cleanCode = String(code || '').trim();

  if (!cleanCode) return null;
  if (!/^\d{1,32}$/.test(cleanCode)) return null;

  const queue = getPollingQueue(registerId);
  const job = {
    jobId: crypto.randomUUID(),
    code: cleanCode,
    createdAt: new Date().toISOString()
  };

  queue.push(job);
  return job;
}


function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLOSURES_DIR)) fs.mkdirSync(CLOSURES_DIR, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    writeDb({
      version: 6,
      businessDate: getBusinessDate(),
      nextNumber: 101,
      products: DEFAULT_PRODUCTS,
      settings: { ...DEFAULT_APP_SETTINGS },
      orders: []
    });
    return;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  let changed = false;
  if (!db.version || db.version < 6) { db.version = 6; changed = true; }
  if (!db.businessDate) { db.businessDate = getBusinessDate(); changed = true; }
  if (!Number.isInteger(db.nextNumber)) { db.nextNumber = 101; changed = true; }
  if (!Array.isArray(db.products) || db.products.length === 0) { db.products = DEFAULT_PRODUCTS; changed = true; }
  if (!Array.isArray(db.orders)) { db.orders = []; changed = true; }

  if (!db.settings || typeof db.settings !== 'object') { db.settings = { ...DEFAULT_APP_SETTINGS }; changed = true; }
  const normalizedSettings = normalizeAppSettings(db.settings);
  if (JSON.stringify(db.settings) !== JSON.stringify(normalizedSettings)) { db.settings = normalizedSettings; changed = true; }

  for (const product of db.products) {
    if (!Object.prototype.hasOwnProperty.call(product, 'cashierCode')) {
      product.cashierCode = '';
      changed = true;
    }
  }

  for (const order of db.orders) {
    if (!Object.prototype.hasOwnProperty.call(order, 'readyAt')) { order.readyAt = null; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(order, 'displayClearedAt')) { order.displayClearedAt = null; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(order, 'displayHiddenAt')) { order.displayHiddenAt = null; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(order, 'completedAt')) { order.completedAt = null; changed = true; }
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        if (!Object.prototype.hasOwnProperty.call(item, 'startedAt')) { item.startedAt = null; changed = true; }
        if (!Object.prototype.hasOwnProperty.call(item, 'completedAt')) { item.completedAt = null; changed = true; }
      }
    }
    refreshOrderStatus(order, false);
  }

  if (changed) writeDb(db);
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function getBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function nowIso() {
  return new Date().toISOString();
}

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function makeId(prefix = 'id') {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function cleanText(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function getStation(stationId) {
  return STATIONS.find((station) => station.id === stationId) || null;
}

function getRegister(registerId) {
  return REGISTERS.find((register) => register.id === String(registerId)) || null;
}

function getProduct(db, productId, includeInactive = false) {
  const product = db.products.find((item) => item.id === productId);
  if (!product) return null;
  if (!includeInactive && product.active === false) return null;
  return product;
}

function slugify(text) {
  const ascii = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii || 'produkt';
}

function calculateOrderTotal(order) {
  return money(order.items.reduce((sum, item) => sum + item.quantity * item.price, 0));
}

function refreshOrderStatus(order, stampReady = true) {
  order.total = calculateOrderTotal(order);
  if (order.status === 'cancelled' || order.status === 'completed') return order.status;

  let nextStatus = 'open';
  if (order.items.every((item) => item.status === 'done')) {
    nextStatus = 'ready';
  } else if (order.items.some((item) => item.status === 'in_progress' || item.status === 'done')) {
    nextStatus = 'in_production';
  }

  if (nextStatus === 'ready' && !order.readyAt && stampReady) {
    order.readyAt = nowIso();
  }
  order.status = nextStatus;
  return order.status;
}

function normalizeOrderItems(db, rawItems) {
  const merged = new Map();
  for (const rawItem of rawItems || []) {
    const productId = String(rawItem.productId || '');
    const quantity = Number(rawItem.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const product = getProduct(db, productId);
    if (!product) continue;
    const current = merged.get(product.id) || 0;
    merged.set(product.id, current + quantity);
  }

  return Array.from(merged.entries()).map(([productId, quantity]) => {
    const product = getProduct(db, productId);
    return {
      lineId: makeId('line'),
      productId: product.id,
      name: product.name,
      category: product.category || 'Artikel',
      stationGroup: product.stationGroup,
      price: money(product.price),
      image: cleanText(product.image || '', 250),
      cashierCode: cleanText(product.cashierCode || '', 80),
      quantity,
      status: 'open',
      claimedBy: null,
      startedAt: null,
      completedAt: null
    };
  });
}

function createOrder(payload) {
  const db = readDb();
  const register = getRegister(payload.registerId);
  const items = normalizeOrderItems(db, payload.items || []);

  if (items.length === 0) {
    const err = new Error('Keine gültigen Artikel in der Bestellung.');
    err.status = 400;
    throw err;
  }

  const order = {
    id: makeId('order'),
    number: db.nextNumber,
    businessDate: db.businessDate || getBusinessDate(),
    registerId: register ? register.id : cleanText(payload.registerId || 'unbekannt', 30),
    registerName: register ? register.name : `Kasse ${cleanText(payload.registerId || '?', 30)}`,
    source: cleanText(payload.source || 'cashier', 40),
    customerName: cleanText(payload.customerName || '', 80),
    note: cleanText(payload.note || '', 500),
    status: 'open',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    cancelledAt: null,
    readyAt: null,
    completedAt: null,
    displayClearedAt: null,
    displayHiddenAt: null,
    cancelReason: '',
    items,
    total: 0
  };
  refreshOrderStatus(order);

  db.nextNumber += 1;
  db.orders.unshift(order);
  writeDb(db);
  return order;
}

function findOrderOrThrow(db, orderId) {
  const order = db.orders.find((item) => item.id === orderId);
  if (!order) {
    const err = new Error('Bestellung nicht gefunden.');
    err.status = 404;
    throw err;
  }
  return order;
}

function stationOrders(stationId) {
  const station = getStation(stationId);
  if (!station) {
    const err = new Error('Station nicht gefunden.');
    err.status = 404;
    throw err;
  }

  const db = readDb();
  return db.orders
    .filter((order) => !['cancelled', 'completed'].includes(order.status))
    .slice()
    .reverse()
    .map((order) => {
      const items = order.items.filter((item) => item.stationGroup === station.group && item.status !== 'done');
      return { ...order, stationId: station.id, stationName: station.name, stationGroup: station.group, items };
    })
    .filter((order) => order.items.length > 0);
}

function startStationOrder(stationId, orderId) {
  const station = getStation(stationId);
  if (!station) {
    const err = new Error('Station nicht gefunden.');
    err.status = 404;
    throw err;
  }

  const db = readDb();
  const order = findOrderOrThrow(db, orderId);
  if (['cancelled', 'completed'].includes(order.status)) {
    const err = new Error('Diese Bestellung kann nicht mehr gestartet werden.');
    err.status = 409;
    throw err;
  }

  const stationItems = order.items.filter((item) => item.stationGroup === station.group && item.status !== 'done');
  const blocked = stationItems.find((item) => item.status === 'in_progress' && item.claimedBy && item.claimedBy !== station.id);
  if (blocked) {
    const owner = getStation(blocked.claimedBy);
    const err = new Error(`Bestellung ist bereits bei ${owner ? owner.name : blocked.claimedBy} in Arbeit.`);
    err.status = 409;
    throw err;
  }

  for (const item of stationItems) {
    if (item.status === 'open') {
      item.status = 'in_progress';
      item.claimedBy = station.id;
      item.startedAt = nowIso();
    }
  }
  order.updatedAt = nowIso();
  refreshOrderStatus(order);
  writeDb(db);
  return order;
}

function finishStationOrder(stationId, orderId) {
  const station = getStation(stationId);
  if (!station) {
    const err = new Error('Station nicht gefunden.');
    err.status = 404;
    throw err;
  }

  const db = readDb();
  const order = findOrderOrThrow(db, orderId);
  if (['cancelled', 'completed'].includes(order.status)) {
    const err = new Error('Diese Bestellung kann nicht mehr erledigt werden.');
    err.status = 409;
    throw err;
  }

  const stationItems = order.items.filter((item) => item.stationGroup === station.group && item.status !== 'done');
  const blocked = stationItems.find((item) => item.status === 'in_progress' && item.claimedBy && item.claimedBy !== station.id);
  if (blocked) {
    const owner = getStation(blocked.claimedBy);
    const err = new Error(`Bestellung ist bei ${owner ? owner.name : blocked.claimedBy} in Arbeit.`);
    err.status = 409;
    throw err;
  }

  for (const item of stationItems) {
    item.status = 'done';
    item.claimedBy = station.id;
    item.completedAt = nowIso();
  }
  order.updatedAt = nowIso();
  refreshOrderStatus(order);
  writeDb(db);
  return order;
}

function releaseStationOrder(stationId, orderId) {
  const station = getStation(stationId);
  if (!station) {
    const err = new Error('Station nicht gefunden.');
    err.status = 404;
    throw err;
  }

  const db = readDb();
  const order = findOrderOrThrow(db, orderId);
  for (const item of order.items) {
    if (item.stationGroup === station.group && item.status === 'in_progress' && item.claimedBy === station.id) {
      item.status = 'open';
      item.claimedBy = null;
      item.startedAt = null;
    }
  }
  order.updatedAt = nowIso();
  refreshOrderStatus(order);
  writeDb(db);
  return order;
}

function cancelOrder(orderId, reason = '') {
  const db = readDb();
  const order = findOrderOrThrow(db, orderId);
  if (order.status === 'completed') {
    const err = new Error('Abgeholte Bestellung kann nicht storniert werden.');
    err.status = 409;
    throw err;
  }
  order.status = 'cancelled';
  order.cancelledAt = nowIso();
  order.cancelReason = cleanText(reason, 300);
  order.updatedAt = nowIso();
  writeDb(db);
  return order;
}

function completeOrder(orderId) {
  const db = readDb();
  const order = findOrderOrThrow(db, orderId);
  if (order.status !== 'ready') {
    const err = new Error('Bestellung ist noch nicht komplett fertig.');
    err.status = 409;
    throw err;
  }
  order.status = 'completed';
  order.completedAt = nowIso();
  order.displayClearedAt = order.completedAt;
  order.updatedAt = nowIso();
  writeDb(db);
  return order;
}

function completeAllReadyOrders() {
  const db = readDb();
  const completedAt = nowIso();
  const completed = [];
  for (const order of db.orders) {
    if (order.status === 'ready') {
      order.status = 'completed';
      order.completedAt = completedAt;
      order.displayClearedAt = completedAt;
      order.updatedAt = completedAt;
      completed.push({ id: order.id, number: order.number });
    }
  }
  writeDb(db);
  return { ok: true, completedCount: completed.length, completed };
}

function msBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function minutesRounded(ms) {
  if (ms === null || ms === undefined) return null;
  return Math.round((ms / 60000) * 10) / 10;
}

function averageMs(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function firstStartedAt(order) {
  const starts = (order.items || [])
    .map((item) => item.startedAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!starts.length) return null;
  return new Date(Math.min(...starts)).toISOString();
}

function oldestActiveMinutes(orders) {
  const active = orders.filter((order) => ['open', 'in_production'].includes(order.status));
  if (!active.length) return null;
  const now = Date.now();
  const ages = active.map((order) => now - new Date(order.createdAt).getTime()).filter(Number.isFinite);
  if (!ages.length) return null;
  return minutesRounded(Math.max(...ages));
}

function buildTimeMetrics(db = readDb()) {
  const ordersToday = db.orders.filter((order) => order.businessDate === db.businessDate && order.status !== 'cancelled');
  const readyDurations = [];
  const firstStartDurations = [];
  const pickupDurations = [];
  const customerDurations = [];

  for (const order of ordersToday) {
    const firstStart = firstStartedAt(order);
    const readyAt = order.readyAt || null;
    const completedAt = order.completedAt || null;

    const firstStartMs = msBetween(order.createdAt, firstStart);
    if (firstStartMs !== null) firstStartDurations.push(firstStartMs);

    const readyMs = msBetween(order.createdAt, readyAt);
    if (readyMs !== null) readyDurations.push(readyMs);

    const pickupMs = msBetween(readyAt, completedAt);
    if (pickupMs !== null) pickupDurations.push(pickupMs);

    const customerMs = msBetween(order.createdAt, completedAt);
    if (customerMs !== null) customerDurations.push(customerMs);
  }

  const activeOrders = ordersToday.filter((order) => ['open', 'in_production'].includes(order.status));
  const readyOrders = ordersToday.filter((order) => order.status === 'ready');

  return {
    averageFirstStartMinutes: minutesRounded(averageMs(firstStartDurations)),
    averageReadyMinutes: minutesRounded(averageMs(readyDurations)),
    averagePickupMinutes: minutesRounded(averageMs(pickupDurations)),
    averageCustomerMinutes: minutesRounded(averageMs(customerDurations)),
    activeOrderCount: activeOrders.length,
    readyOrderCount: readyOrders.length,
    measuredReadyOrders: readyDurations.length,
    measuredCompletedOrders: customerDurations.length,
    oldestActiveMinutes: oldestActiveMinutes(ordersToday)
  };
}

function buildDashboard() {
  const db = readDb();
  const ordersToday = db.orders.filter((order) => order.businessDate === db.businessDate);
  const soldOrders = ordersToday.filter((order) => order.status !== 'cancelled');

  const productTotals = new Map();
  const registerTotals = new Map();
  const stationTotals = new Map();
  let revenue = 0;

  for (const order of soldOrders) {
    revenue += calculateOrderTotal(order);
    const registerKey = order.registerId || 'unbekannt';
    if (!registerTotals.has(registerKey)) {
      registerTotals.set(registerKey, { registerId: registerKey, registerName: order.registerName || registerKey, orders: 0, revenue: 0 });
    }
    const registerRow = registerTotals.get(registerKey);
    registerRow.orders += 1;
    registerRow.revenue += calculateOrderTotal(order);

    for (const item of order.items) {
      if (!productTotals.has(item.productId)) {
        productTotals.set(item.productId, {
          productId: item.productId,
          name: item.name,
          quantity: 0,
          revenue: 0,
          category: item.category,
          stationGroup: item.stationGroup
        });
      }
      const productRow = productTotals.get(item.productId);
      productRow.quantity += item.quantity;
      productRow.revenue += item.quantity * item.price;

      if (!stationTotals.has(item.stationGroup)) {
        stationTotals.set(item.stationGroup, { stationGroup: item.stationGroup, quantity: 0, revenue: 0 });
      }
      const stationRow = stationTotals.get(item.stationGroup);
      stationRow.quantity += item.quantity;
      stationRow.revenue += item.quantity * item.price;
    }
  }

  const statusCounts = { open: 0, in_production: 0, ready: 0, completed: 0, cancelled: 0 };
  for (const order of ordersToday) {
    if (!statusCounts[order.status]) statusCounts[order.status] = 0;
    statusCounts[order.status] += 1;
  }

  const timeMetrics = buildTimeMetrics(db);

  const hourlyOrders = Array.from({ length: 13 }, (_, index) => {
    const hour = 8 + index;
    return { hour, label: `${String(hour).padStart(2, '0')}:00`, orders: 0 };
  });
  for (const order of soldOrders) {
    const hour = Number(new Date(order.createdAt).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      hour12: false
    }));
    const row = hourlyOrders.find((item) => item.hour === hour);
    if (row) row.orders += 1;
  }

  const stationPerformance = STATIONS.map((station) => {
    const relevantOrders = soldOrders.filter((order) => order.items.some((item) => (
      item.stationGroup === station.group
      && (station.group === 'coffee' || item.claimedBy === station.id || !item.claimedBy)
    )));
    const durations = [];
    let itemCount = 0;
    let revenueSum = 0;
    for (const order of relevantOrders) {
      for (const item of order.items) {
        if (item.stationGroup !== station.group) continue;
        if (station.group !== 'coffee' && item.claimedBy && item.claimedBy !== station.id) continue;
        itemCount += item.quantity;
        revenueSum += item.quantity * item.price;
        const duration = msBetween(item.startedAt || order.createdAt, item.completedAt || order.readyAt);
        if (duration !== null) durations.push(duration);
      }
    }
    return {
      stationId: station.id,
      stationName: station.name,
      group: station.group,
      orders: relevantOrders.length,
      items: itemCount,
      revenue: money(revenueSum),
      averageMinutes: minutesRounded(averageMs(durations))
    };
  });

  return {
    businessDate: db.businessDate,
    nextNumber: db.nextNumber,
    orderCount: soldOrders.length,
    cancelledCount: statusCounts.cancelled || 0,
    revenue: money(revenue),
    statusCounts,
    productTotals: Array.from(productTotals.values()).map((row) => ({ ...row, revenue: money(row.revenue) })),
    registerTotals: Array.from(registerTotals.values()).map((row) => ({ ...row, revenue: money(row.revenue) })),
    stationTotals: Array.from(stationTotals.values()).map((row) => ({ ...row, revenue: money(row.revenue) })),
    stationPerformance,
    hourlyOrders,
    display: buildDisplaySummary(db),
    timeMetrics,
    recentOrders: ordersToday.slice(0, 30)
  };
}


function normalizeAppSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = DEFAULT_APP_SETTINGS;

  function numberValue(key, min, max) {
    const rawValue = source[key];
    const parsed = Number(rawValue);
    const fallback = defaults[key];

    if (!Number.isFinite(parsed)) return fallback;

    return Math.max(min, Math.min(max, parsed));
  }

  return {
    displayAutoHideMinutes: numberValue('displayAutoHideMinutes', 0, 120),
    displayMaxReadyNumbers: Math.round(numberValue('displayMaxReadyNumbers', 1, 24)),
    displayRefreshSeconds: Math.round(numberValue('displayRefreshSeconds', 5, 120)),
    displayShowMetrics: source.displayShowMetrics === false ? false : true,
    displaySoundVolume: Math.round(numberValue('displaySoundVolume', 0, 100)),
    displayBilingual: source.displayBilingual === false ? false : true
  };
}

function getAppSettingsFromDb(db) {
  return normalizeAppSettings(db && db.settings ? db.settings : {});
}

function getAppSettings() {
  return getAppSettingsFromDb(readDb());
}

function updateAppSettings(body = {}) {
  const db = readDb();
  db.settings = normalizeAppSettings({ ...(db.settings || {}), ...(body || {}) });
  writeDb(db);
  return db.settings;
}

function autoHideMs(settings) {
  const minutes = Number(settings.displayAutoHideMinutes || 0);

  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  return minutes * 60 * 1000;
}

function normalizeAppSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = DEFAULT_APP_SETTINGS;

  function numberValue(key, min, max) {
    const rawValue = source[key];
    const parsed = Number(rawValue);
    const fallback = defaults[key];

    if (!Number.isFinite(parsed)) return fallback;

    return Math.max(min, Math.min(max, parsed));
  }

  return {
    displayAutoHideMinutes: numberValue('displayAutoHideMinutes', 0, 120),
    displayMaxReadyNumbers: Math.round(numberValue('displayMaxReadyNumbers', 1, 24)),
    displayRefreshSeconds: Math.round(numberValue('displayRefreshSeconds', 5, 120)),
    displayShowMetrics: source.displayShowMetrics === false ? false : true,
    displaySoundVolume: Math.round(numberValue('displaySoundVolume', 0, 100)),
    displayBilingual: source.displayBilingual === false ? false : true
  };
}

function getAppSettingsFromDb(db) {
  return normalizeAppSettings(db && db.settings ? db.settings : {});
}

function getAppSettings() {
  return getAppSettingsFromDb(readDb());
}

function updateAppSettings(body = {}) {
  const db = readDb();
  db.settings = normalizeAppSettings({ ...(db.settings || {}), ...(body || {}) });
  writeDb(db);
  return db.settings;
}

function autoHideMs(settings) {
  const minutes = Number(settings.displayAutoHideMinutes || 0);

  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  return minutes * 60 * 1000;
}

function autoHideExpiredDisplayOrders(db = readDb()) {
  const settings = getAppSettingsFromDb(db);
  const hideMs = autoHideMs(settings);

  if (!hideMs) return db;

  const now = Date.now();
  let changed = false;

  for (const order of db.orders) {
    if (order.status !== 'ready') continue;
    if (order.displayHiddenAt) continue;
    if (!order.readyAt) continue;

    const readyTime = new Date(order.readyAt).getTime();
    if (!Number.isFinite(readyTime)) continue;

    if (now - readyTime >= hideMs) {
      order.displayHiddenAt = nowIso();
      order.updatedAt = order.displayHiddenAt;
      changed = true;
    }
  }

  if (changed) writeDb(db);

  return db;
}

function isVisibleOnPickupDisplay(order, now = Date.now(), settings = null) {
  if (!order || order.status !== 'ready') return false;
  if (order.displayHiddenAt) return false;

  const effectiveSettings = settings || getAppSettingsFromDb(readDb());
  const hideMs = autoHideMs(effectiveSettings);

  if (!hideMs) return true;

  if (!order.readyAt) return true;

  const readyTime = new Date(order.readyAt).getTime();

  if (!Number.isFinite(readyTime)) return true;

  return now - readyTime < hideMs;
}

function buildDisplaySummary(db = readDb()) {
  const settings = getAppSettingsFromDb(db);
  const now = Date.now();
  const ordersToday = db.orders.filter((order) => order.businessDate === db.businessDate);
  const readyOrders = ordersToday.filter((order) => order.status === 'ready');
  const visibleReady = readyOrders.filter((order) => isVisibleOnPickupDisplay(order, now, settings));
  const hiddenReady = readyOrders.filter((order) => !isVisibleOnPickupDisplay(order, now, settings));

  return {
    autoHideAfterMinutes: settings.displayAutoHideMinutes,
    visibleReadyCount: visibleReady.length,
    hiddenReadyCount: hiddenReady.length,
    readyTotalCount: readyOrders.length,
    settings
  };
}

function buildDisplayPayload() {
  const db = autoHideExpiredDisplayOrders(readDb());
  const settings = getAppSettingsFromDb(db);
  const now = Date.now();

  const ready = db.orders
    .filter((order) => isVisibleOnPickupDisplay(order, now, settings))
    .sort((a, b) => new Date(a.readyAt || a.createdAt) - new Date(b.readyAt || b.createdAt))
    .slice(0, settings.displayMaxReadyNumbers)
    .map((order) => ({
      id: order.id,
      number: order.number,
      registerName: order.registerName,
      createdAt: order.createdAt,
      readyAt: order.readyAt,
      waitMinutes: minutesRounded(msBetween(order.createdAt, order.readyAt))
    }));

  return {
    ready,
    metrics: buildTimeMetrics(db),
    display: buildDisplaySummary(db),
    settings
  };
}

function reannounceOrder(orderId) {
  const db = readDb();
  const order = findOrderOrThrow(db, orderId);

  if (order.status !== 'ready') {
    const err = new Error('Nur fertige Bestellungen können erneut angezeigt werden.');
    err.status = 409;
    throw err;
  }

  order.readyAt = nowIso();
  order.displayHiddenAt = null;
  order.updatedAt = order.readyAt;

  writeDb(db);

  return order;
}

function productPayload(body) {
  const stationGroup = body.stationGroup === 'coffee' ? 'coffee' : 'hot';
  const price = money(body.price);
  if (!cleanText(body.name, 100)) {
    const err = new Error('Produktname fehlt.');
    err.status = 400;
    throw err;
  }
  return {
    name: cleanText(body.name, 100),
    category: cleanText(body.category || (stationGroup === 'coffee' ? 'Kaffee' : 'Heißtheke'), 60),
    stationGroup,
    price,
    active: body.active !== false,
    image: cleanText(body.image || '', 250),
    cashierCode: cleanText(body.cashierCode || '', 80)
  };
}

function createProduct(body) {
  const db = readDb();
  const payload = productPayload(body);
  let id = slugify(payload.name);
  if (db.products.some((product) => product.id === id)) id = `${id}_${Date.now().toString(36)}`;
  const product = { id, ...payload };
  db.products.push(product);
  writeDb(db);
  return product;
}

function updateProduct(productId, body) {
  const db = readDb();
  const product = db.products.find((item) => item.id === productId);
  if (!product) {
    const err = new Error('Produkt nicht gefunden.');
    err.status = 404;
    throw err;
  }
  const payload = productPayload(body);
  Object.assign(product, payload);
  writeDb(db);
  return product;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlaceholder(value) {
  const text = String(value || '').toUpperCase();
  return !text || text.includes('PICO_') || text.includes('TOKEN_HIER') || text.includes('ARTIKELNUMMER');
}

function validateCashierCode(code) {
  const text = cleanText(code, 80);
  if (!text) return '';

  // Fuer den Pico-Tastaturcode erstmal bewusst nur Zahlen zulassen.
  // Falls eure Kasse spaeter Buchstaben braucht, passen wir diese Pruefung an.
  if (!/^\d+$/.test(text)) {
    const err = new Error('Artikelnummer "' + text + '" ist ungueltig. Bitte nur Zahlen verwenden.');
    err.status = 400;
    throw err;
  }

  return text;
}

async function sendCashierCodeToPico(registerId, productId) {
  const db = readDb();
  const product = getProduct(db, productId, true);

  if (!product) {
    const err = new Error('Produkt nicht gefunden.');
    err.status = 404;
    throw err;
  }

  const code = validateCashierCode(product.cashierCode || '');

  if (!CASH_REGISTER_KEYBOARD_ENABLED) {
    return { ok: true, skipped: true, reason: 'Pico-Senden ist noch deaktiviert.', productId, code };
  }

  if (!code) {
    return { ok: true, skipped: true, reason: 'Keine Artikelnummer bei ' + product.name + ' hinterlegt.', productId };
  }

  const bridge = CASH_REGISTER_KEYBOARDS[String(registerId)];
  if (!bridge || isPlaceholder(bridge.url) || isPlaceholder(bridge.token)) {
    return { ok: true, skipped: true, reason: 'Pico fuer Kasse ' + registerId + ' ist noch nicht konfiguriert.', productId, code };
  }

  const url = bridge.url + '?token=' + encodeURIComponent(bridge.token) + '&code=' + encodeURIComponent(code);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      const err = new Error('Pico antwortet mit Fehler ' + response.status + ': ' + text);
      err.status = 502;
      throw err;
    }

    return { ok: true, skipped: false, registerId: String(registerId), productId, productName: product.name, code, pico: bridge.name };
  } finally {
    clearTimeout(timer);
  }
}

function enqueueCashierCode(registerId, productId) {
  const key = String(registerId);
  const previous = cashRegisterQueues.get(key) || Promise.resolve();

  const queued = previous.catch(() => null).then(async () => {
    const result = await sendCashierCodeToPico(key, productId);
    await sleep(CASH_REGISTER_SEND_DELAY_MS);
    return result;
  });

  cashRegisterQueues.set(key, queued);
  queued.finally(() => {
    if (cashRegisterQueues.get(key) === queued) {
      cashRegisterQueues.delete(key);
    }
  });

  return queued;
}

function ordersCsv() {
  const db = readDb();
  const rows = [[
    'Datum', 'Uhrzeit', 'Nummer', 'Kasse', 'Status', 'Artikel', 'Menge', 'Einzelpreis', 'Summe',
    'Station', 'Start nach Min', 'Fertig nach Min', 'Abgeholt nach Min', 'Notiz'
  ]];
  for (const order of db.orders.slice().reverse()) {
    const created = new Date(order.createdAt);
    const firstStart = firstStartedAt(order);
    const startMinutes = minutesRounded(msBetween(order.createdAt, firstStart));
    const readyMinutes = minutesRounded(msBetween(order.createdAt, order.readyAt));
    const customerMinutes = minutesRounded(msBetween(order.createdAt, order.completedAt));
    for (const item of order.items) {
      rows.push([
        order.businessDate,
        created.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' }),
        order.number,
        order.registerName,
        order.status,
        item.name,
        item.quantity,
        money(item.price).toFixed(2),
        money(item.quantity * item.price).toFixed(2),
        item.stationGroup,
        startMinutes ?? '',
        readyMinutes ?? '',
        customerMinutes ?? '',
        order.note || ''
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(';')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function closeDay(confirmText) {
  if (confirmText !== 'ABSCHLUSS') {
    const err = new Error('Bitte ABSCHLUSS als Bestätigung senden.');
    err.status = 400;
    throw err;
  }
  const db = readDb();
  const dashboard = buildDashboard();
  const closedAt = nowIso();
  const filename = `abschluss-${db.businessDate}-${closedAt.replace(/[:.]/g, '-')}.json`;
  const snapshot = { closedAt, dashboard, orders: db.orders };
  fs.writeFileSync(path.join(CLOSURES_DIR, filename), JSON.stringify(snapshot, null, 2), 'utf8');

  db.businessDate = getBusinessDate();
  db.nextNumber = 101;
  db.orders = [];
  writeDb(db);
  return { ok: true, filename, dashboard };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function broadcast() {
  io.emit('orders:changed');
  io.emit('dashboard:changed');
}

function sendError(res, error) {
  res.status(error.status || 500).json({ error: error.message || 'Serverfehler' });
}

app.get('/api/config', (req, res) => {
  res.json({ registers: REGISTERS, stations: STATIONS, stationGroups: ['hot', 'coffee'] });
});

app.get('/api/products', (req, res) => {
  const db = readDb();
  const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
  const products = includeInactive ? db.products : db.products.filter((product) => product.active !== false);
  res.json(products);
});

app.post('/api/products', (req, res) => {
  try {
    const product = createProduct(req.body || {});
    broadcast();
    res.status(201).json(product);
  } catch (error) {
    sendError(res, error);
  }
});

app.put('/api/products/:productId', (req, res) => {
  try {
    const product = updateProduct(req.params.productId, req.body || {});
    broadcast();
    res.json(product);
  } catch (error) {
    sendError(res, error);
  }
});




app.post('/api/registers/:registerId/queue-keyboard-product', (req, res) => {
  try {
    const token = String((req.body && req.body.token) || req.query.token || '');

    if (token !== CASH_REGISTER_POLLING_TOKEN) {
      return res.status(401).json({ ok: false, error: 'wrong_token' });
    }

    const productId = String((req.body && req.body.productId) || '').trim();

    if (!productId) {
      return res.status(400).json({ ok: false, error: 'missing_product_id' });
    }

    const db = readDb();
    const product = (db.products || []).find((item) => String(item.id) === productId);

    if (!product) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }

    const code = String(
      product.cashierCode ||
      product.cashRegisterCode ||
      product.articleNumber ||
      ''
    ).trim();

    if (!code) {
      return res.status(400).json({ ok: false, error: 'product_has_no_cashier_code' });
    }

    const job = enqueuePollingKeyboardCode(req.params.registerId, code);

    if (!job) {
      return res.status(400).json({ ok: false, error: 'invalid_code' });
    }

    console.log('[Pico Polling] Kasse ' + req.params.registerId + ' Produkt ' + productId + ' Code queued: ' + code);

    res.json({
      ok: true,
      jobId: job.jobId,
      code
    });
  } catch (error) {
    sendError(res, error);
  }
});


app.post('/api/registers/:registerId/queue-keyboard-code', (req, res) => {
  try {
    if ((req.body.token || req.query.token || '') !== CASH_REGISTER_POLLING_TOKEN) {
      return res.status(401).json({ ok: false, error: 'wrong_token' });
    }

    const code = String(req.body.code || '').trim();
    const job = enqueuePollingKeyboardCode(req.params.registerId, code);

    if (!job) {
      return res.status(400).json({ ok: false, error: 'invalid_code' });
    }

    res.json({ ok: true, jobId: job.jobId });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/registers/:registerId/next-keyboard-code', (req, res) => {
  try {
    if ((req.query.token || '') !== CASH_REGISTER_POLLING_TOKEN) {
      return res.status(401).json({ ok: false, error: 'wrong_token' });
    }

    const queue = getPollingQueue(req.params.registerId);

    if (!queue.length) {
      return res.status(204).end();
    }

    const job = queue[0];

    res.json({
      ok: true,
      jobId: job.jobId,
      code: job.code
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/registers/:registerId/keyboard-code-done', (req, res) => {
  try {
    if ((req.query.token || '') !== CASH_REGISTER_POLLING_TOKEN) {
      return res.status(401).json({ ok: false, error: 'wrong_token' });
    }

    const queue = getPollingQueue(req.params.registerId);
    const jobId = String(req.query.jobId || '');

    if (queue.length && queue[0].jobId === jobId) {
      queue.shift();
    }

    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});



// Pico Polling Hook:
// Diese Route hängt sich VOR die vorhandene type-product Route.
// Sie verändert die Kassenoberfläche nicht.
// Wenn ein Produkt geklickt wird, wird dessen Artikelnummer in die Pico-Warteschlange gelegt.
app.post('/api/registers/:registerId/type-product', (req, res, next) => {
  try {
    const registerId = String(req.params.registerId || '');
    const productId = String((req.body && req.body.productId) || '').trim();

    if (!productId) return next();

    const db = readDb();
    const product = (db.products || []).find((item) => item.id === productId);

    if (!product) return next();

    const code = String(
      product.cashierCode ||
      product.cashRegisterCode ||
      product.articleNumber ||
      ''
    ).trim();

    if (code) {
      enqueuePollingKeyboardCode(registerId, code);
      console.log('[Pico Polling] Kasse ' + registerId + ' Code queued: ' + code);
    }
  } catch (error) {
    console.error('[Pico Polling] type-product hook failed:', error);
  }

  next();
});

app.post('/api/registers/:registerId/type-product', async (req, res) => {
  try {
    const productId = cleanText(req.body ? req.body.productId : '', 120);

    if (!productId) {
      return res.status(400).json({ ok: false, error: 'productId fehlt.' });
    }

    const result = await enqueueCashierCode(req.params.registerId, productId);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/orders', (req, res) => res.json(readDb().orders));

app.get('/api/orders/:orderId', (req, res) => {
  try {
    const db = readDb();
    res.json(findOrderOrThrow(db, req.params.orderId));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/orders', (req, res) => {
  try {
    const order = createOrder(req.body || {});
    broadcast();
    res.status(201).json(order);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/orders/:orderId/cancel', (req, res) => {
  try {
    const order = cancelOrder(req.params.orderId, req.body ? req.body.reason : '');
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/orders/:orderId/complete', (req, res) => {
  try {
    const order = completeOrder(req.params.orderId);
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});


app.post('/api/orders/:orderId/reannounce', (req, res) => {
  try {
    const order = reannounceOrder(req.params.orderId);
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/stations/:stationId/orders', (req, res) => {
  try {
    res.json(stationOrders(req.params.stationId));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/stations/:stationId/orders/:orderId/start', (req, res) => {
  try {
    const order = startStationOrder(req.params.stationId, req.params.orderId);
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/stations/:stationId/orders/:orderId/done', (req, res) => {
  try {
    const order = finishStationOrder(req.params.stationId, req.params.orderId);
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/stations/:stationId/orders/:orderId/release', (req, res) => {
  try {
    const order = releaseStationOrder(req.params.stationId, req.params.orderId);
    broadcast();
    res.json(order);
  } catch (error) {
    sendError(res, error);
  }
});


app.get('/api/settings', (req, res) => {
  res.json(getAppSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const settings = updateAppSettings(req.body || {});
    io.emit('settings:changed');
    broadcast();
    res.json(settings);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/dashboard', (req, res) => res.json(buildDashboard()));

app.get('/api/display', (req, res) => {
  res.json(buildDisplayPayload());
});

app.post('/api/display/clear-ready', (req, res) => {
  try {
    const result = completeAllReadyOrders();
    broadcast();
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/export/orders.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bestellungen.csv"');
  res.send('\uFEFF' + ordersCsv());
});

app.post('/api/day-close', (req, res) => {
  try {
    const result = closeDay(req.body ? req.body.confirm : '');
    broadcast();
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

io.on('connection', (socket) => {
  socket.emit('orders:changed');
  socket.emit('dashboard:changed');
});

ensureDb();
server.listen(PORT, '0.0.0.0', () => {
  console.log('-------------------------------------------');
  console.log(`Order-System Pro v5 laeuft: http://localhost:${PORT}`);
  console.log('Kassen: /cashier.html?register=1 bis register=4');
  console.log('Stationen: /station.html?station=hot1, hot2, coffee');
  console.log('Ausgabe intern: /dashboard.html (Button Abgeholt)');
  console.log('-------------------------------------------');
});
