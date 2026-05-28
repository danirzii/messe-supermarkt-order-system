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
  { id: 'schnitzel_broetchen', name: 'Schnitzel-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.90, active: true, image: '/assets/products/schnitzel-broetchen.png' },
  { id: 'leberkaese_broetchen', name: 'Leberkäse-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.50, active: true, image: '/assets/products/leberkaese-broetchen.png' },
  { id: 'frikadelle_broetchen', name: 'Frikadellen-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.20, active: true, image: '/assets/products/frikadelle-broetchen.png' },
  { id: 'kassler_broetchen', name: 'Kassler-Brötchen', category: 'Heißtheke', stationGroup: 'hot', price: 4.80, active: true, image: '/assets/products/kassler-broetchen.png' },
  { id: 'bockwurst', name: 'Bockwurst', category: 'Heißtheke', stationGroup: 'hot', price: 3.80, active: true, image: '/assets/products/bockwurst.png' },
  { id: 'kaffee', name: 'Kaffee', category: 'Kaffee', stationGroup: 'coffee', price: 2.20, active: true },
  { id: 'kaffee_crema', name: 'Kaffee Crema', category: 'Kaffee', stationGroup: 'coffee', price: 2.50, active: true },
  { id: 'cappuccino', name: 'Cappuccino', category: 'Kaffee', stationGroup: 'coffee', price: 3.10, active: true },
  { id: 'latte_macchiato', name: 'Latte Macchiato', category: 'Kaffee', stationGroup: 'coffee', price: 3.30, active: true },
  { id: 'milchkaffee', name: 'Milchkaffee', category: 'Kaffee', stationGroup: 'coffee', price: 3.00, active: true },
  { id: 'milchschock', name: 'Milchschock', category: 'Kaffee', stationGroup: 'coffee', price: 2.80, active: true },
  { id: 'cola_05', name: 'Cola 0,5 l', category: 'Getränke', stationGroup: 'coffee', price: 2.30, active: true },
  { id: 'wasser_05', name: 'Wasser 0,5 l', category: 'Getränke', stationGroup: 'coffee', price: 1.80, active: true },
  { id: 'apfelschorle_05', name: 'Apfelschorle 0,5 l', category: 'Getränke', stationGroup: 'coffee', price: 2.20, active: true }
];

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLOSURES_DIR)) fs.mkdirSync(CLOSURES_DIR, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    writeDb({
      version: 5,
      businessDate: getBusinessDate(),
      nextNumber: 101,
      products: DEFAULT_PRODUCTS,
      orders: []
    });
    return;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  let changed = false;
  if (!db.version || db.version < 5) { db.version = 5; changed = true; }
  if (!db.businessDate) { db.businessDate = getBusinessDate(); changed = true; }
  if (!Number.isInteger(db.nextNumber)) { db.nextNumber = 101; changed = true; }
  if (!Array.isArray(db.products) || db.products.length === 0) { db.products = DEFAULT_PRODUCTS; changed = true; }
  if (!Array.isArray(db.orders)) { db.orders = []; changed = true; }

  for (const order of db.orders) {
    if (!Object.prototype.hasOwnProperty.call(order, 'readyAt')) { order.readyAt = null; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(order, 'displayClearedAt')) { order.displayClearedAt = null; changed = true; }
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
    timeMetrics,
    recentOrders: ordersToday.slice(0, 30)
  };
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
    image: cleanText(body.image || '', 250)
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

app.get('/api/dashboard', (req, res) => res.json(buildDashboard()));

app.get('/api/display', (req, res) => {
  const db = readDb();
  const ready = db.orders
    .filter((order) => order.status === 'ready')
    .slice(0, 12)
    .map((order) => ({
      id: order.id,
      number: order.number,
      registerName: order.registerName,
      createdAt: order.createdAt,
      readyAt: order.readyAt,
      waitMinutes: minutesRounded(msBetween(order.createdAt, order.readyAt))
    }));
  res.json({ ready, metrics: buildTimeMetrics(db) });
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
