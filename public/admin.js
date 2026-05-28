const socket = io();
const { escapeHtml, fetchJson, toast } = window.OrderApp;
let products = [];

const els = {
  products: document.getElementById('products'),
  newName: document.getElementById('newName'),
  newCategory: document.getElementById('newCategory'),
  newStation: document.getElementById('newStation'),
  newPrice: document.getElementById('newPrice'),
  newImage: document.getElementById('newImage'),
  addProduct: document.getElementById('addProduct'),
  reload: document.getElementById('reload')
};

async function loadProducts() {
  products = await fetchJson('/api/products?includeInactive=1');
  renderProducts();
}

function renderProducts() {
  if (products.length === 0) {
    els.products.innerHTML = '<div class="empty-state"><strong>Keine Produkte</strong></div>';
    return;
  }

  els.products.innerHTML = products.map((product) => `
    <div class="product-admin-row" data-id="${escapeHtml(product.id)}">
      <input data-field="name" value="${escapeHtml(product.name)}" />
      <input data-field="category" value="${escapeHtml(product.category || '')}" />
      <select data-field="stationGroup">
        <option value="hot" ${product.stationGroup === 'hot' ? 'selected' : ''}>Heißtheke</option>
        <option value="coffee" ${product.stationGroup === 'coffee' ? 'selected' : ''}>Kaffee & Getränke</option>
      </select>
      <input data-field="price" type="number" min="0" step="0.01" value="${Number(product.price).toFixed(2)}" />
      <input data-field="image" placeholder="/assets/products/.." value="${escapeHtml(product.image || '')}" />
      <div class="actions">
        <select data-field="active">
          <option value="true" ${product.active !== false ? 'selected' : ''}>Aktiv</option>
          <option value="false" ${product.active === false ? 'selected' : ''}>Aus</option>
        </select>
        <button class="btn-green" data-action="save">Speichern</button>
      </div>
    </div>
  `).join('');

  els.products.querySelectorAll('button[data-action="save"]').forEach((button) => {
    button.addEventListener('click', () => saveRow(button.closest('.product-admin-row')));
  });
}

function readRow(row) {
  const value = (field) => row.querySelector(`[data-field="${field}"]`).value;
  return {
    name: value('name'),
    category: value('category'),
    stationGroup: value('stationGroup'),
    price: Number(value('price')),
    image: value('image'),
    active: value('active') === 'true'
  };
}

async function saveRow(row) {
  try {
    const product = await fetchJson(`/api/products/${encodeURIComponent(row.dataset.id)}`, {
      method: 'PUT',
      body: JSON.stringify(readRow(row))
    });
    toast(`${product.name} gespeichert`);
    await loadProducts();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addProduct() {
  try {
    const product = await fetchJson('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: els.newName.value,
        category: els.newCategory.value || (els.newStation.value === 'coffee' ? 'Kaffee' : 'Heißtheke'),
        stationGroup: els.newStation.value,
        price: Number(els.newPrice.value),
        image: els.newImage.value,
        active: true
      })
    });
    els.newName.value = '';
    els.newCategory.value = '';
    els.newPrice.value = '';
    els.newImage.value = '';
    toast(`${product.name} hinzugefügt`);
    await loadProducts();
  } catch (error) {
    toast(error.message, 'error');
  }
}

els.addProduct.addEventListener('click', addProduct);
els.reload.addEventListener('click', loadProducts);
socket.on('dashboard:changed', loadProducts);
loadProducts().catch((error) => toast(error.message, 'error'));
