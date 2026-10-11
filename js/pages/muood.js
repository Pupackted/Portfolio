/*
 * MUOOD: the screen tour and the USB ⇄ Wi-Fi handoff simulation.
 *
 * The handoff runs the app's real rules in real time: a route that has been
 * offline for 5 s triggers a look at the other route, checked every 3 s, and
 * whichever answers first wins (Promise.any in the app).
 */
(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ── Tour ───────────────────────────────────────────────────────────── */

  var CAPTIONS = {
    'Now Playing': '<b>Now Playing.</b> Apple Music, picked up the moment it changes. The background drifts in colours sampled from the album cover.',
    'Lyrics': '<b>Lyrics.</b> Synced line by line from LRCLIB, or from the lyrics stored in Music. Tap a line to jump there.',
    'Controls': '<b>Controls.</b> Sound output, mic mute, Dark Mode, Keep Awake and Display Off — and the same volume the Mac’s own keys change.',
    'Vitals': '<b>Vitals.</b> CPU, memory pressure, battery, network, GPU and storage, read from macOS’s own tools. Tap a card for detail.',
    'Deck': '<b>Deck.</b> Buttons from a config file: apps, links, Shortcuts, shell commands, AppleScript. The risky ones need a hold.',
    'Clock': '<b>Clock.</b> StandBy-style, with the weather and what’s next from the Mac’s calendar.',
    'Weather': '<b>Weather.</b> From Open-Meteo, with no API key. The city is guessed from the Mac’s time zone.',
    'Focus': '<b>Focus.</b> A pomodoro that runs on the Mac and ends with a Mac notification, next to today’s tasks.',
    'Today': '<b>Today.</b> Screen time for the Mac: the front app hour by hour, and the week so far.',
    'Photos': '<b>Photos.</b> A folder or the Mac’s wallpapers, resized on the Mac before they reach the phone, drifting slowly.',
    'Night Stand': '<b>Night Stand.</b> A dim amber clock, the sun and moon, tomorrow’s first event — and a warning if the phone stops charging.'
  };

  function initTour() {
    var root = $('[data-mu-tour]');
    if (!root) return;
    var track = $('[data-track]', root);
    var slides = $$('.mu-tour__slide', track);
    var tabs = $('[data-tabs]', root);
    var caption = $('[data-caption]', root);
    var current = -1;

    tabs.innerHTML = slides.map(function (s, i) {
      return '<button type="button" data-i="' + i + '" aria-pressed="false">' + s.getAttribute('data-name') + '</button>';
    }).join('');
    var buttons = $$('button', tabs);

    function mark(i) {
      if (i === current) return;
      current = i;
      buttons.forEach(function (b, j) { b.setAttribute('aria-pressed', String(i === j)); });
      var b = buttons[i];
      // Keep the active tab visible without scrolling the page.
      tabs.scrollTo({ left: b.offsetLeft - tabs.clientWidth / 2 + b.offsetWidth / 2, behavior: 'smooth' });
      caption.innerHTML = CAPTIONS[slides[i].getAttribute('data-name')] || '';
    }

    function go(i) {
      i = (i + slides.length) % slides.length;
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      mark(i);
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () { go(+b.getAttribute('data-i')); });
    });
    $('[data-prev]', root).addEventListener('click', function () { go(current - 1); });
    $('[data-next]', root).addEventListener('click', function () { go(current + 1); });

    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
    });

    var raf = 0;
    track.addEventListener('scroll', function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        mark(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
      });
    }, { passive: true });

    mark(0);
  }

  /* ── Handoff ────────────────────────────────────────────────────────── */

  var SWITCH_AFTER_MS = 5000;
  var CHECK_EVERY_MS = 3000;

  function initHandoff() {
    var root = $('[data-mu-handoff]');
    if (!root) return;

    var routes = { usb: $('[data-route="usb"]', root), wifi: $('[data-route="wifi"]', root) };
    var phone = $('.mu-node--phone', root);
    var phoneState = $('[data-phone-state]', root);
    var logEl = $('[data-log]', root);
    var NAMES = { usb: 'USB', wifi: 'Wi-Fi' };
    var ADDR = { usb: 'http://localhost:6663', wifi: 'http://192.168.1.20:6663' };

    var s = { via: 'usb', status: 'connected', up: { usb: true, wifi: true }, offlineSince: 0, switching: false, t0: 0 };
    var checker = 0;
    var ticker = 0;

    function stamp() {
      if (!s.t0) return '0.0s';
      return ((Date.now() - s.t0) / 1000).toFixed(1) + 's';
    }

    function log(text, kind) {
      var li = document.createElement('li');
      if (kind) li.className = 'is-' + kind;
      li.innerHTML = '<time>' + stamp() + '</time><span>' + text + '</span>';
      logEl.appendChild(li);
      while (logEl.children.length > 7) logEl.removeChild(logEl.firstChild);
    }

    function render() {
      ['usb', 'wifi'].forEach(function (k) {
        var r = routes[k];
        r.classList.toggle('is-active', s.via === k && s.status === 'connected');
        r.classList.toggle('is-down', !s.up[k]);
        r.classList.toggle('is-trying', s.switching && s.via !== k && s.up[k]);
      });
      phone.setAttribute('data-state', s.status);
      if (s.status === 'connected') {
        phoneState.textContent = 'Connected · ' + NAMES[s.via];
      } else if (s.switching) {
        phoneState.textContent = 'Trying the other route…';
      } else {
        phoneState.textContent = 'Offline ' + Math.floor((Date.now() - s.offlineSince) / 1000) + 's';
      }
    }

    function other(k) { return k === 'usb' ? 'wifi' : 'usb'; }

    // The app's tryOtherRoute(), in miniature.
    function tryOtherRoute() {
      if (s.switching || s.status !== 'offline' || Date.now() - s.offlineSince < SWITCH_AFTER_MS) return;
      var target = other(s.via);
      if (!s.up[target]) {
        log('Nowhere else to go (yet). Waiting.', 'warn');
        return;
      }
      s.switching = true;
      log('Silent for ' + Math.round((Date.now() - s.offlineSince) / 1000) + 's — asking ' + NAMES[target] + '…');
      render();
      setTimeout(function () {
        if (s.status !== 'offline') { s.switching = false; render(); return; }
        if (!s.up[target]) { s.switching = false; log(NAMES[target] + ' didn’t answer either.', 'warn'); render(); return; }
        s.via = target;
        s.status = 'connected';
        s.switching = false;
        log('location.replace(<span class="mono">' + ADDR[target] + '</span>)');
        log('Connected over ' + NAMES[target] + '. Music never stopped on the Mac.', 'good');
        render();
      }, 600);
    }

    function start() {
      if (checker) return;
      s.t0 = Date.now();
      checker = setInterval(tryOtherRoute, CHECK_EVERY_MS);
      ticker = setInterval(render, 250);
    }

    function toggle(k, btn) {
      start();
      s.up[k] = !s.up[k];
      btn.setAttribute('aria-pressed', String(!s.up[k]));
      btn.querySelector('span').textContent = k === 'usb'
        ? (s.up.usb ? 'Unplug USB' : 'Plug USB back in')
        : (s.up.wifi ? 'Drop Wi-Fi' : 'Bring Wi-Fi back');

      if (!s.up[k]) {
        if (s.via === k && s.status === 'connected') {
          s.status = 'offline';
          s.offlineSince = Date.now();
          log(NAMES[k] + ' went quiet. The stream is offline.', 'warn');
        } else {
          log(NAMES[k] + ' is down — not in use, so nothing changes.');
        }
      } else {
        if (s.via === k && s.status === 'offline') {
          s.status = 'connected';
          log(NAMES[k] + ' came back by itself — staying put.', 'good');
        } else {
          log(NAMES[k] + ' is back, remembered as the fallback.');
        }
      }
      render();
    }

    $$('[data-toggle]', root).forEach(function (btn) {
      btn.addEventListener('click', function () { toggle(btn.getAttribute('data-toggle'), btn); });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && ticker) { clearInterval(ticker); ticker = 0; }
      else if (!document.hidden && checker && !ticker) { ticker = setInterval(render, 250); }
    });

    log('Connected over USB. Wi-Fi addresses arrive with every heartbeat.', 'good');
    render();
  }

  initTour();
  initHandoff();
})();
