/* Downball Manager cloud sync (Google Sheets via Apps Script)
   - Does nothing until a device enters the passcode, so visitors stay local-only.
   - Mirrors every localStorage write to the sheet and pulls on page load. */
(function () {
  'use strict';

  // >>> PASTE your Apps Script Web App URL here <<<
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbymFJXWLOU0mCRPTU8eWue0KMeGNPEWQ_yHqv_1w8sRof1DfDg2bXocOT2rV6ppS33ctg/exec';

  var ls;
  try { ls = window.localStorage; ls.getItem('dbm_sync_probe'); } catch (e) { return; }

  var SP = Storage.prototype;
  var rawSet = SP.setItem, rawGet = SP.getItem, rawRemove = SP.removeItem;
  var META_K = 'dbm_sync_meta', PASS_K = 'dbm_sync_passcode', FLAG_K = 'dbm_sync_reloaded';
  var configured = ENDPOINT.indexOf('PASTE_') === -1;

  function skip(k) { return typeof k === 'string' && k.indexOf('dbm_sync_') === 0; }
  function getPass() { return rawGet.call(ls, PASS_K) || ''; }

  var meta;
  try { meta = JSON.parse(rawGet.call(ls, META_K) || '{}'); } catch (e) { meta = {}; }
  function saveMeta() { try { rawSet.call(ls, META_K, JSON.stringify(meta)); } catch (e) {} }

  var timer = null, pushing = false, btn = null, status = 'off';

  // ---- track every write ----
  function touch(k, deleted) {
    meta[k] = { t: Date.now(), d: deleted ? 1 : 0, p: 1 };
    saveMeta();
    schedule();
  }
  SP.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === ls && !skip(k)) touch(k, false);
  };
  SP.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === ls && !skip(k)) touch(k, true);
  };

  // ---- network ----
  function api(body) {
    body.passcode = getPass();
    var text = JSON.stringify(body);
    return fetch(ENDPOINT, { method: 'POST', body: text, keepalive: text.length < 60000 })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          if (res.error === 'unauthorized') {
            rawRemove.call(ls, PASS_K);
            setStatus('off');
            alert('Wrong sync passcode. Cloud sync is off on this device.');
          }
          throw new Error(res.error || 'sync failed');
        }
        return res;
      });
  }

  function pending() { return Object.keys(meta).filter(function (k) { return meta[k].p; }); }

  function push() {
    if (!configured || !getPass() || pushing) return Promise.resolve();
    var keys = pending();
    if (!keys.length) return Promise.resolve();
    var sent = {}, changes = keys.map(function (k) {
      var m = meta[k], v = rawGet.call(ls, k);
      sent[k] = m.t;
      if (m.d || v === null) return { key: k, d: 1, t: m.t };
      return { key: k, value: v, t: m.t };
    });
    pushing = true;
    setStatus('syncing');
    return api({ action: 'push', changes: changes }).then(function () {
      keys.forEach(function (k) { if (meta[k] && meta[k].t === sent[k]) meta[k].p = 0; });
      saveMeta();
      setStatus(pending().length ? 'pending' : 'ok');
    }).catch(function () { setStatus('err'); })
      .then(function () { pushing = false; });
  }

  function pull() {
    return api({ action: 'pull' }).then(function (res) {
      var items = res.items || {}, changed = false;
      Object.keys(items).forEach(function (k) {
        if (skip(k)) return;
        var it = items[k], m = meta[k], lt = m ? m.t : 0;
        if (it.t > lt) {
          if (it.d) rawRemove.call(ls, k); else rawSet.call(ls, k, it.value);
          meta[k] = { t: it.t, d: it.d ? 1 : 0, p: 0 };
          changed = true;
        } else if (it.t < lt && m) {
          m.p = 1;
        }
      });
      var local = [];
      for (var i = 0; i < ls.length; i++) local.push(ls.key(i));
      local.forEach(function (k) {
        if (skip(k) || items[k]) return;
        if (!meta[k]) meta[k] = { t: Date.now(), d: 0, p: 1 }; // existing data from before sync was on
      });
      Object.keys(meta).forEach(function (k) { if (!items[k]) meta[k].p = 1; });
      saveMeta();
      return changed;
    });
  }

  function sync() {
    if (!configured || !getPass()) { setStatus('off'); return Promise.resolve(); }
    setStatus('syncing');
    return pull().then(function (changed) {
      if (changed && !sessionStorage.getItem(FLAG_K)) {
        sessionStorage.setItem(FLAG_K, '1');
        location.reload(); // reload so the app starts with the cloud data
        return;
      }
      sessionStorage.removeItem(FLAG_K);
      return push();
    }).catch(function () { setStatus('err'); });
  }

  function schedule() {
    if (!configured || !getPass()) return;
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(push, 3000);
  }

  // ---- little status button ----
  var LABELS = {
    off: '\u2601 Sync off', syncing: '\u2601 Syncing\u2026', ok: '\u2601 Synced',
    pending: '\u2601 Saving\u2026', err: '\u2601 Sync error'
  };
  function setStatus(s) {
    status = s;
    if (btn) { btn.textContent = LABELS[s]; btn.style.opacity = s === 'ok' || s === 'off' ? '0.55' : '1'; }
  }
  function onClick() {
    if (!configured) { alert('Cloud sync is not set up yet: paste the Web App URL into sync.js.'); return; }
    if (!getPass()) {
      var p = prompt('Enter your sync passcode to save data to the cloud on this device:');
      if (!p) return;
      rawSet.call(ls, PASS_K, p.trim());
      sync();
      return;
    }
    var a = prompt('Press OK to sync now, or type OFF to disconnect this device.');
    if (a === null) return;
    if (a.trim().toLowerCase() === 'off') { rawRemove.call(ls, PASS_K); setStatus('off'); return; }
    sync();
  }
  function buildUi() {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'dbm-sync-btn';
    btn.setAttribute('style',
      'position:fixed;right:10px;bottom:10px;z-index:2147483000;padding:5px 11px;' +
      'font:600 11px Inter,sans-serif;letter-spacing:.04em;color:#F4EFE6;background:rgba(14,33,25,.92);' +
      'border:1px solid #E0B04D;border-radius:999px;cursor:pointer;');
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
    setStatus(getPass() && configured ? 'syncing' : 'off');
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { clearTimeout(timer); push(); }
  });
  setInterval(function () { if (pending().length) push(); }, 60000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { buildUi(); sync(); });
  } else { buildUi(); sync(); }
})();
