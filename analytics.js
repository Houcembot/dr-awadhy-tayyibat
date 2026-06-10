(function() {
  var API = 'https://tayyibat-admin.houcemben.workers.dev/api/track';
  var KEY = 'tayyibat:nav';

  var prev = null;
  try {
    var raw = sessionStorage.getItem(KEY);
    if (raw) prev = JSON.parse(raw);
  } catch (e) {}

  var now = Date.now();
  var cur = { path: location.pathname || '/', ts: now };
  try { sessionStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {}

  var body = JSON.stringify({
    path: cur.path,
    lang: document.documentElement.lang || (window.localStorage && localStorage.getItem('lang')) || 'fr',
    referer: document.referrer || null,
    prev_path: prev && prev.path ? prev.path : null,
    prev_ts: prev && prev.ts ? prev.ts : null
  });

  try {
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(API, blob);
    } else {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) {}
})();
