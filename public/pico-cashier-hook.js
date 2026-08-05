(function () {
  'use strict';

  const TOKEN = 'kasse1-test';

  function getRegisterId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('register') || '1';
  }

  function postProductToPicoQueue(productId) {
    const registerId = getRegisterId();

    if (!productId) return;

    fetch('/api/registers/' + encodeURIComponent(registerId) + '/queue-keyboard-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TOKEN,
        productId: String(productId)
      })
    })
      .then(function (response) {
        if (!response.ok) {
          console.warn('[Pico] Artikelnummer konnte nicht gesendet werden:', response.status);
        }
      })
      .catch(function (error) {
        console.warn('[Pico] Verbindung zur Warteschlange fehlgeschlagen:', error);
      });
  }

  function installAddToCartHook() {
    if (window.__picoCashierHookInstalled) return true;

    if (typeof window.addToCart !== 'function') {
      return false;
    }

    const originalAddToCart = window.addToCart;

    window.addToCart = function (productId) {
      const result = originalAddToCart.apply(this, arguments);

      try {
        postProductToPicoQueue(productId);
      } catch (error) {
        console.warn('[Pico] Hook Fehler:', error);
      }

      return result;
    };

    window.__picoCashierHookInstalled = true;
    console.log('[Pico] Kassen-Klick-Hook aktiv');
    return true;
  }

  let tries = 0;
  const timer = window.setInterval(function () {
    tries += 1;

    if (installAddToCartHook() || tries > 50) {
      window.clearInterval(timer);
    }
  }, 100);
})();