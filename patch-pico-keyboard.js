const fs = require('fs');
const path = require('path');

function file(name) { return path.join(__dirname, name); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error('Konnte Stelle nicht finden: ' + label);
  return content.replace(search, replacement);
}

function insertBefore(content, marker, insertion, label) {
  const firstLine = insertion.trim().split('\n')[0];
  if (content.includes(firstLine)) return content;
  if (!content.includes(marker)) throw new Error('Konnte Einfuegepunkt nicht finden: ' + label);
  return content.replace(marker, insertion + '\n' + marker);
}

function patchServer() {
  let s = read('server.js');

  if (!s.includes('cashierCode')) {
    s = s.replace(/active: true, image: '([^']+)' \}/g, "active: true, image: '$1', cashierCode: '' }");
    s = s.replace(/active: true \}/g, "active: true, cashierCode: '' }");
  }

  s = s.replace(/version: 5,/g, 'version: 6,');
  s = s.replace(
    "if (!db.version || db.version < 5) { db.version = 5; changed = true; }",
    "if (!db.version || db.version < 6) { db.version = 6; changed = true; }"
  );

  const configBlock = String.raw`
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
`;
  s = insertBefore(s, 'function ensureDb() {', configBlock, 'Pico-Konfiguration vor ensureDb');

  const migrationMarker = "  if (!Array.isArray(db.orders)) { db.orders = []; changed = true; }\n\n";
  const migrationBlock = String.raw`  for (const product of db.products) {
    if (!Object.prototype.hasOwnProperty.call(product, 'cashierCode')) {
      product.cashierCode = '';
      changed = true;
    }
  }

`;
  if (!s.includes("Object.prototype.hasOwnProperty.call(product, 'cashierCode')")) {
    s = replaceOnce(s, migrationMarker, migrationMarker + migrationBlock, 'Produkt-Migration cashierCode');
  }

  if (!s.includes("cashierCode: cleanText(product.cashierCode || '', 80)")) {
    s = replaceOnce(
      s,
      "      image: cleanText(product.image || '', 250),\n      quantity,",
      "      image: cleanText(product.image || '', 250),\n      cashierCode: cleanText(product.cashierCode || '', 80),\n      quantity,",
      'cashierCode in Bestellposition'
    );
  }

  if (!s.includes("cashierCode: cleanText(body.cashierCode || '', 80)")) {
    s = replaceOnce(
      s,
      "    active: body.active !== false,\n    image: cleanText(body.image || '', 250)\n  };",
      "    active: body.active !== false,\n    image: cleanText(body.image || '', 250),\n    cashierCode: cleanText(body.cashierCode || '', 80)\n  };",
      'cashierCode in productPayload'
    );
  }

  const keyboardFunctions = String.raw`
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
`;
  s = insertBefore(s, 'function ordersCsv() {', keyboardFunctions, 'Pico-Funktionen vor ordersCsv');

  const routeBlock = String.raw`
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
`;
  s = insertBefore(s, "app.get('/api/orders', (req, res) => res.json(readDb().orders));", routeBlock, 'API-Route type-product');

  write('server.js', s);
}

function patchAdminHtml() {
  let s = read('public/admin.html');
  if (!s.includes('id="newCashierCode"')) {
    s = replaceOnce(
      s,
      `          <label>Preis
            <input id="newPrice" type="number" min="0" step="0.01" placeholder="4.50" />
          </label>
          <label>Bildpfad optional`,
      `          <label>Preis
            <input id="newPrice" type="number" min="0" step="0.01" placeholder="4.50" />
          </label>
          <label>Artikelnummer Kasse
            <input id="newCashierCode" placeholder="Artikelnummer" inputmode="numeric" />
          </label>
          <label>Bildpfad optional`,
      'newCashierCode in admin.html'
    );
  }
  write('public/admin.html', s);
}

function patchAdminJs() {
  let s = read('public/admin.js');

  if (!s.includes('newCashierCode:')) {
    s = replaceOnce(
      s,
      "  newPrice: document.getElementById('newPrice'),\n  newImage: document.getElementById('newImage'),",
      "  newPrice: document.getElementById('newPrice'),\n  newCashierCode: document.getElementById('newCashierCode'),\n  newImage: document.getElementById('newImage'),",
      'newCashierCode Element'
    );
  }

  if (!s.includes('data-field="cashierCode"')) {
    s = replaceOnce(
      s,
      '      <input data-field="price" type="number" min="0" step="0.01" value="${Number(product.price).toFixed(2)}" />\n      <input data-field="image" placeholder="/assets/products/.." value="${escapeHtml(product.image || \'\')}" />',
      '      <input data-field="price" type="number" min="0" step="0.01" value="${Number(product.price).toFixed(2)}" />\n      <input data-field="cashierCode" placeholder="Artikelnummer" inputmode="numeric" value="${escapeHtml(product.cashierCode || \'\')}" />\n      <input data-field="image" placeholder="/assets/products/.." value="${escapeHtml(product.image || \'\')}" />',
      'cashierCode in Produktliste'
    );
  }

  if (!s.includes("cashierCode: value('cashierCode')")) {
    s = replaceOnce(
      s,
      "    price: Number(value('price')),\n    image: value('image'),",
      "    price: Number(value('price')),\n    cashierCode: value('cashierCode'),\n    image: value('image'),",
      'cashierCode in readRow'
    );
  }

  if (!s.includes('cashierCode: els.newCashierCode.value')) {
    s = replaceOnce(
      s,
      "        price: Number(els.newPrice.value),\n        image: els.newImage.value,",
      "        price: Number(els.newPrice.value),\n        cashierCode: els.newCashierCode.value,\n        image: els.newImage.value,",
      'cashierCode in addProduct'
    );

    s = replaceOnce(
      s,
      "    els.newPrice.value = '';\n    els.newImage.value = '';",
      "    els.newPrice.value = '';\n    els.newCashierCode.value = '';\n    els.newImage.value = '';",
      'newCashierCode leeren'
    );
  }

  write('public/admin.js', s);
}

function patchCashierJs() {
  let s = read('public/cashier.js');

  if (!s.includes('SEND_TO_CASH_REGISTER_ON_TAP')) {
    s = replaceOnce(
      s,
      "const registerId = getParam('register', '1');\nconst cart = new Map();",
      "const registerId = getParam('register', '1');\nconst SEND_TO_CASH_REGISTER_ON_TAP = true;\nconst cart = new Map();",
      'SEND_TO_CASH_REGISTER_ON_TAP'
    );
  }

  if (!s.includes('class="cashier-code-pill"')) {
    s = replaceOnce(
      s,
      '          <small>${stationLabel(product.stationGroup)}</small>\n          <span class="product-price">${euro(product.price)}</span>',
      '          <small>${stationLabel(product.stationGroup)}</small>\n          <span class="cashier-code-pill">Art.-Nr.: ${escapeHtml(product.cashierCode || \'Artikelnummer\')}</span>\n          <span class="product-price">${euro(product.price)}</span>',
      'Artikelnummer-Anzeige in Produktkarte'
    );
  }

  const sendFunction = String.raw`
async function sendProductToCashRegister(productId) {
  if (!SEND_TO_CASH_REGISTER_ON_TAP) return;

  try {
    const result = await fetchJson('/api/registers/' + encodeURIComponent(registerId) + '/type-product', {
      method: 'POST',
      body: JSON.stringify({ productId })
    });

    if (result && result.skipped) {
      console.info('Kassen-Pico uebersprungen:', result.reason);
      return;
    }

    if (result && result.code) {
      toast('Artikelnummer ' + result.code + ' an Kasse gesendet');
    }
  } catch (error) {
    toast('Kasse nicht erreicht: ' + error.message, 'error');
  }
}
`;

  if (!s.includes('async function sendProductToCashRegister')) {
    s = insertBefore(s, 'function addToCart(productId) {', sendFunction, 'sendProductToCashRegister vor addToCart');
  }

  if (!s.includes('sendProductToCashRegister(productId);')) {
    s = replaceOnce(
      s,
      `function addToCart(productId) {
  cart.set(productId, (cart.get(productId) || 0) + 1);
  renderCart();
}`,
      `function addToCart(productId) {
  cart.set(productId, (cart.get(productId) || 0) + 1);
  renderCart();
  sendProductToCashRegister(productId);
}`,
      'addToCart sendet an Kasse'
    );
  }

  if (!s.includes('Nur beim Plus-Klick erneut an die Kasse senden.')) {
    s = replaceOnce(
      s,
      `function changeQty(productId, delta) {
  const next = (cart.get(productId) || 0) + delta;
  if (next <= 0) cart.delete(productId);
  else cart.set(productId, next);
  renderCart();
}`,
      `function changeQty(productId, delta) {
  const next = (cart.get(productId) || 0) + delta;
  if (next <= 0) cart.delete(productId);
  else cart.set(productId, next);
  renderCart();

  // Nur beim Plus-Klick erneut an die Kasse senden.
  // Minus/Entfernen wird bewusst nicht automatisch in der echten Kasse storniert.
  if (delta > 0) {
    sendProductToCashRegister(productId);
  }
}`,
      'changeQty Plus sendet an Kasse'
    );
  }

  write('public/cashier.js', s);
}

function patchStyles() {
  let s = read('public/styles.css');

  const addition = String.raw`

/* Pico-/Kassenartikelnummer Erweiterung */
.cashier-code-pill {
  display: inline-flex;
  width: max-content;
  max-width: 100%;
  padding: 4px 7px;
  border-radius: 999px;
  color: rgba(244,245,247,.78);
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.08);
  font-size: 11px;
  font-weight: 900;
}

.product-admin-row {
  grid-template-columns: 1.05fr .75fr .72fr .62fr .82fr 1.18fr auto !important;
}

.product-form-grid {
  grid-template-columns: repeat(7, minmax(115px, 1fr)) !important;
}
`;

  if (!s.includes('Pico-/Kassenartikelnummer Erweiterung')) {
    s += addition;
  }

  write('public/styles.css', s);
}

patchServer();
patchAdminHtml();
patchAdminJs();
patchCashierJs();
patchStyles();

console.log('Fertig: Pico-/Kassenartikelnummer-Erweiterung wurde in Order-System V5 eingetragen.');
console.log('Naechster Schritt: server.js oeffnen, Pico-IP/Token eintragen und CASH_REGISTER_KEYBOARD_ENABLED spaeter auf true setzen.');
