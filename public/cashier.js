const socket = io();
const { euro, escapeHtml, fetchJson, toast, getParam, stationLabel, categoryRank, imageOrFallback } = window.OrderApp;

const registerId = getParam('register', '1');
const cart = new Map();
let products = [];
let activeCategory = 'Alle';
let lastOrderId = null;

const els = {
  pageTitle: document.getElementById('pageTitle'),
  pageSubtitle: document.getElementById('pageSubtitle'),
  categoryTabs: document.getElementById('categoryTabs'),
  search: document.getElementById('search'),
  products: document.getElementById('products'),
  cart: document.getElementById('cart'),
  cartTotal: document.getElementById('cartTotal'),
  note: document.getElementById('note'),
  submitOrder: document.getElementById('submitOrder'),
  clearCart: document.getElementById('clearCart'),
  successModal: document.getElementById('successModal'),
  modalNumber: document.getElementById('modalNumber'),
  printReceipt: document.getElementById('printReceipt'),
  closeModal: document.getElementById('closeModal')
};

async function init() {
  const config = await fetchJson('/api/config');
  const register = config.registers.find((item) => item.id === registerId);
  els.pageTitle.textContent = register ? register.name : `Kasse ${registerId}`;
  els.pageSubtitle.textContent = 'Heißtheke, Kaffee und Getränke strukturiert aufnehmen';
  await loadProducts();
  renderCart();
}

async function loadProducts() {
  products = await fetchJson('/api/products');
  products = products.slice().sort((a, b) => {
    const categoryDiff = categoryRank(a.category) - categoryRank(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.name.localeCompare(b.name, 'de');
  });
  renderTabs();
  renderProducts();
}

function renderTabs() {
  const categories = ['Alle', ...Array.from(new Set(products.map((product) => product.category || 'Artikel')))
    .sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'de'))];
  if (!categories.includes(activeCategory)) activeCategory = 'Alle';
  els.categoryTabs.innerHTML = categories.map((category) => `
    <button type="button" class="${category === activeCategory ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `).join('');
  els.categoryTabs.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.category;
      renderTabs();
      renderProducts();
    });
  });
}

function filteredProducts() {
  const query = els.search.value.trim().toLowerCase();
  return products.filter((product) => {
    const categoryMatch = activeCategory === 'Alle' || product.category === activeCategory;
    const queryMatch = !query || `${product.name} ${product.category}`.toLowerCase().includes(query);
    return categoryMatch && queryMatch;
  });
}

function renderProducts() {
  const list = filteredProducts();
  if (list.length === 0) {
    els.products.innerHTML = '<div class="empty-state"><div><strong>Nichts gefunden</strong><span class="muted">Suche oder Kategorie ändern.</span></div></div>';
    return;
  }

  els.products.innerHTML = list.map((product) => {
    const image = imageOrFallback(product.image);
    return `
      <button class="product-tile ${image ? 'with-image' : ''}" data-id="${escapeHtml(product.id)}">
        ${image ? `<img class="product-photo" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : '<div class="product-photo placeholder"></div>'}
        <div class="product-copy">
          <div class="product-head">
            <span class="badge ${product.stationGroup === 'coffee' ? 'blue' : 'green'}">${escapeHtml(product.category || stationLabel(product.stationGroup))}</span>
          </div>
          <strong>${escapeHtml(product.name)}</strong>
          <small>${stationLabel(product.stationGroup)}</small>
          <span class="product-price">${euro(product.price)}</span>
        </div>
      </button>
    `;
  }).join('');

  els.products.querySelectorAll('.product-tile').forEach((button) => {
    button.addEventListener('click', () => addToCart(button.dataset.id));
  });
}

function addToCart(productId) {
  cart.set(productId, (cart.get(productId) || 0) + 1);
  renderCart();
}

function changeQty(productId, delta) {
  const next = (cart.get(productId) || 0) + delta;
  if (next <= 0) cart.delete(productId);
  else cart.set(productId, next);
  renderCart();
}

function removeItem(productId) {
  cart.delete(productId);
  renderCart();
}

function cartTotal() {
  let total = 0;
  for (const [productId, quantity] of cart.entries()) {
    const product = products.find((item) => item.id === productId);
    if (product) total += product.price * quantity;
  }
  return total;
}

function renderCart() {
  if (cart.size === 0) {
    els.cart.innerHTML = '<div class="empty-state" style="min-height: 180px;"><div><strong>Noch leer</strong><span class="muted">Links Artikel antippen.</span></div></div>';
    els.cartTotal.textContent = euro(0);
    els.submitOrder.disabled = true;
    return;
  }

  els.submitOrder.disabled = false;
  els.cart.innerHTML = Array.from(cart.entries()).map(([productId, quantity]) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return '';
    return `
      <div class="cart-row">
        <div>
          <strong>${quantity} x ${escapeHtml(product.name)}</strong><br>
          <small>${escapeHtml(product.category || '')} · ${stationLabel(product.stationGroup)} · ${euro(product.price)} pro Stück</small>
        </div>
        <div class="qty-controls">
          <button class="btn-small btn-dark" data-action="minus" data-id="${escapeHtml(productId)}">−</button>
          <button class="btn-small btn-dark" data-action="plus" data-id="${escapeHtml(productId)}">+</button>
          <button class="btn-small btn-red" data-action="remove" data-id="${escapeHtml(productId)}">×</button>
        </div>
      </div>
    `;
  }).join('');
  els.cartTotal.textContent = euro(cartTotal());

  els.cart.querySelectorAll('button').forEach((button) => {
    const id = button.dataset.id;
    if (button.dataset.action === 'minus') button.addEventListener('click', () => changeQty(id, -1));
    if (button.dataset.action === 'plus') button.addEventListener('click', () => changeQty(id, 1));
    if (button.dataset.action === 'remove') button.addEventListener('click', () => removeItem(id));
  });
}

async function submitOrder() {
  if (cart.size === 0) return;
  els.submitOrder.disabled = true;
  els.submitOrder.textContent = 'Wird gesendet...';

  try {
    const payload = {
      registerId,
      source: 'cashier',
      note: els.note.value,
      items: Array.from(cart.entries()).map(([productId, quantity]) => ({ productId, quantity }))
    };
    const order = await fetchJson('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    lastOrderId = order.id;
    cart.clear();
    els.note.value = '';
    renderCart();
    els.modalNumber.textContent = `#${order.number}`;
    els.successModal.classList.add('show');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    els.submitOrder.textContent = 'Bestellung senden';
    renderCart();
  }
}

els.search.addEventListener('input', renderProducts);
els.submitOrder.addEventListener('click', submitOrder);
els.clearCart.addEventListener('click', () => { cart.clear(); renderCart(); });
els.closeModal.addEventListener('click', () => els.successModal.classList.remove('show'));
els.printReceipt.addEventListener('click', () => {
  if (lastOrderId) window.open(`/receipt.html?orderId=${encodeURIComponent(lastOrderId)}`, '_blank');
});

socket.on('dashboard:changed', loadProducts);
init().catch((error) => toast(error.message, 'error'));
