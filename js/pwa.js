/* PWA: service worker, tombol instal, petunjuk iOS, pemanasan server. Path relatif (./) untuk GitHub Pages. */
(function () {
  'use strict';
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var w = reg.installing; if (!w) return;
          w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) window.__swBaru = true; });
        });
      }).catch(function () { /* abaikan: aplikasi tetap jalan tanpa PWA */ });
    });
  }

  // Pemanasan server Apps Script (hilangkan cold start saat layar login tampil)
  try {
    var u = window.APP_CONFIG && window.APP_CONFIG.GAS_URL;
    if (u && !/GANTI|XXXX/.test(u)) fetch(u + '?action=ping', { credentials: 'omit' }).catch(function () { });
  } catch (e) { /* abaikan */ }

  var tunda = null;
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  function el(id) { return document.getElementById(id); }
  // Tombol ikon kecil di topbar (setelah login) + tautan teks kecil di layar login. Tidak menutupi konten.
  function pasang() {
    if (!tunda) return;
    tunda.prompt();
    tunda.userChoice.then(function (r) { if (r.outcome === 'accepted') tunda = null; segarkan(); });
  }
  function tautanLogin() {
    var t = el('pwaLink');
    if (!t) {
      t = document.createElement('button'); t.id = 'pwaLink'; t.type = 'button';
      t.textContent = 'Pasang aplikasi di perangkat ini';
      t.style.cssText = 'position:fixed;right:12px;top:10px;z-index:50;display:none;background:none;border:0;color:#C75A10;font:600 12px Inter,system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:6px 10px';
      t.onclick = pasang; document.body.appendChild(t);
    }
    return t;
  }
  function segarkan() {
    var ada = !!tunda && !standalone, b = el('pwaInstal');
    if (b) { b.classList.toggle('hide', !ada); b.onclick = pasang; }
    var t = tautanLogin(); t.style.display = (ada && el('lNrp')) ? 'block' : 'none';
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); tunda = e; segarkan(); });
  window.addEventListener('appinstalled', function () { tunda = null; segarkan(); });
  setInterval(function () { if (tunda) segarkan(); }, 1500);

  // iOS Safari tidak punya beforeinstallprompt → petunjuk manual (sekali)
  var iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (iOS && !standalone) {
    try { if (localStorage.getItem('lcms_iosHint')) return; } catch (e) { }
    window.addEventListener('load', function () {
      setTimeout(function () {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9000;background:#fff;border:1px solid #F37321;border-radius:12px;padding:12px 14px;font:13px Inter,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)';
        d.innerHTML = 'Pasang di iPhone: ketuk <b>Bagikan</b> lalu <b>Tambah ke Layar Utama</b>. <button type="button" style="margin-left:8px;border:0;background:#F37321;color:#fff;border-radius:8px;padding:4px 10px;font-weight:600">Mengerti</button>';
        d.querySelector('button').onclick = function () { try { localStorage.setItem('lcms_iosHint', '1'); } catch (e) { } d.remove(); };
        document.body.appendChild(d);
      }, 2500);
    });
  }
})();
