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


// ------------------------------------------------------------
// Global Fullscreen Button V1
// ------------------------------------------------------------
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function fullscreenSupported() {
    return Boolean(
      document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen
    );
  }

  function currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function requestFullscreen(element) {
    if (element.requestFullscreen) return element.requestFullscreen();
    if (element.webkitRequestFullscreen) return element.webkitRequestFullscreen();
    return Promise.reject(new Error('Fullscreen not supported'));
  }

  function exitFullscreen() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return Promise.reject(new Error('Exit fullscreen not supported'));
  }

  function updateButton(button) {
    var isFullscreen = Boolean(currentFullscreenElement());
    var label = isFullscreen ? 'Vollbild beenden' : 'Vollbild';

    button.querySelector('strong').textContent = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('active', isFullscreen);
  }

  function shouldSkipButton() {
    if (!fullscreenSupported()) return true;

    // Wenn die Seite schon einen eigenen Vollbild-Button hat, keinen zweiten anzeigen.
    if (document.getElementById('fullscreenButton')) return true;

    // Auf Druck-/Bon-Seiten nicht stoeren.
    if (window.location.pathname.indexOf('/receipt.html') !== -1) return true;

    return false;
  }

  function installGlobalFullscreenButton() {
    if (shouldSkipButton()) return;
    if (document.getElementById('globalFullscreenButton')) return;

    var button = document.createElement('button');
    button.id = 'globalFullscreenButton';
    button.type = 'button';
    button.className = 'global-fullscreen-button no-print';
    button.innerHTML = '<span class="global-fullscreen-icon">[]</span><strong>Vollbild</strong>';

    button.addEventListener('click', function () {
      if (currentFullscreenElement()) {
        exitFullscreen().catch(function () {
          alert('Vollbild konnte nicht beendet werden.');
        });
      } else {
        requestFullscreen(document.documentElement).catch(function () {
          alert('Vollbild konnte nicht gestartet werden. Bitte direkt auf den Button klicken oder F11 verwenden.');
        });
      }
    });

    document.addEventListener('fullscreenchange', function () {
      updateButton(button);
    });

    document.addEventListener('webkitfullscreenchange', function () {
      updateButton(button);
    });

    // Wenn die Seite eine Navigationsleiste hat, sitzt der Knopf dort als normaler Knopf
    // und schwebt nicht ueber dem Inhalt.
    var nav = document.querySelector('.topbar .nav');
    if (nav) {
      button.classList.add('in-nav');
      button.title = 'Vollbild';
      nav.appendChild(button);
    } else {
      document.body.appendChild(button);
    }
    updateButton(button);
  }

  ready(installGlobalFullscreenButton);
})();
