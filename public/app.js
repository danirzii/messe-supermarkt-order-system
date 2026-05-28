(function () {
  function euro(value) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
  }

  function time(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function dateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#039;',
      '"': '&quot;'
    }[char]));
  }

  function statusLabel(status) {
    return {
      open: 'Offen',
      in_production: 'In Arbeit',
      ready: 'Fertig',
      completed: 'Abgeholt',
      cancelled: 'Storniert'
    }[status] || status;
  }

  function stationLabel(group) {
    return group === 'coffee' ? 'Kaffee & Getränke' : 'Heißtheke';
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const error = new Error((data && data.error) || 'Fehler');
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function toast(message, type = 'ok') {
    let node = document.querySelector('.toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.dataset.type = type;
    node.classList.add('show');
    window.clearTimeout(node._timer);
    node._timer = window.setTimeout(() => node.classList.remove('show'), 2600);
  }

  function getParam(name, fallback = '') {
    return new URLSearchParams(window.location.search).get(name) || fallback;
  }


  function categoryRank(category) {
    return {
      'Heißtheke': 1,
      'Kaffee': 2,
      'Getränke': 3,
      'Alle': 0
    }[category] || 99;
  }

  function imageOrFallback(value) {
    return String(value || '').trim();
  }

  window.OrderApp = { euro, time, dateTime, escapeHtml, statusLabel, stationLabel, fetchJson, toast, getParam, categoryRank, imageOrFallback };
}());
