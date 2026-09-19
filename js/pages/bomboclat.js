/*
 * BomBocLat, playable: the game's rules in a few hundred lines of DOM.
 *
 * A hidden fuse of 10–15 s per round, a pass button that refuses to fire
 * while it cools down after you receive the bomb, and three hearts each. The
 * fuse is a countdown advanced by requestAnimationFrame, so pausing (off
 * screen, hidden tab) is simply not advancing it.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-game]');
  if (!root) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var q = function (sel) { return root.querySelector(sel); };

  var screen = q('[data-screen]');
  var flash = q('[data-flash]');
  var bomb = q('[data-bomb]');
  var boom = q('[data-boom]');
  var statusEl = q('[data-status]');
  var roundEl = q('[data-round]');
  var overlay = q('[data-overlay]');
  var overlayTitle = q('[data-overlay-title]');
  var startBtn = q('[data-start]');
  var helpEl = q('[data-help]');
  var p2Name = q('[data-p2-name]');
  var modeBtns = Array.prototype.slice.call(root.querySelectorAll('[data-mode]'));
  var passBtns = [q('[data-pass="0"]'), q('[data-pass="1"]')];
  var fighters = [q('[data-fighter="0"]'), q('[data-fighter="1"]')];
  var heartsEls = [q('[data-hearts="0"]'), q('[data-hearts="1"]')];

  var NAMES = ['Adrian', 'Angel'];
  var COOLDOWN = 900;
  var HEARTS = 3;

  var state = {
    mode: 'cpu',
    running: false,
    between: false,
    paused: false,
    visible: false,
    holder: 0,
    hearts: [HEARTS, HEARTS],
    round: 1,
    fuseLeft: 0,
    lastTick: 0,
    cool: [0, 0],
    cpuAt: 0,
  };
  var rafId = 0;

  /* ── Pixel explosion, generated once ────────────────────────────────── */

  (function drawBoom() {
    var seed = 11;
    function rnd() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }
    var colors = ['#fffbe6', '#ffe680', '#ffc233', '#ff8a00', '#e8431f', '#8a2300'];
    var rects = '';
    for (var y = 0; y < 18; y++) {
      for (var x = 0; x < 18; x++) {
        var d = Math.hypot(x - 8.5, (y - 8.5) * 1.08) + (rnd() - 0.5) * 2.4;
        if (d > 8.6) continue;
        if (d > 6.8 && rnd() > 0.5) continue;
        var c = colors[Math.min(colors.length - 1, Math.floor(d / 1.5))];
        rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + c + '"/>';
      }
    }
    // Debris flung past the edge of the cloud.
    [[0, 3], [1, 15], [16, 1], [17, 12], [4, 17], [13, 17], [8, 0], [17, 7]].forEach(function (p) {
      rects += '<rect x="' + p[0] + '" y="' + p[1] + '" width="1" height="1" fill="#8a2300"/>';
    });
    boom.innerHTML = '<svg viewBox="0 0 18 18" shape-rendering="crispEdges" aria-hidden="true">' + rects + '</svg>';
  })();

  /* ── Rendering helpers ──────────────────────────────────────────────── */

  function announce(text) {
    statusEl.textContent = text;
  }

  function renderHearts() {
    heartsEls.forEach(function (el, i) {
      Array.prototype.forEach.call(el.children, function (heart, h) {
        heart.classList.toggle('is-lost', h >= state.hearts[i]);
      });
      el.setAttribute('aria-label', NAMES[i] + ' has ' + state.hearts[i] + (state.hearts[i] === 1 ? ' heart' : ' hearts'));
    });
  }

  function renderHolder(hop) {
    bomb.setAttribute('data-side', String(state.holder));
    fighters.forEach(function (f, i) { f.classList.toggle('is-holding', state.running && !state.between && i === state.holder); });
    if (hop && !reducedMotion) {
      bomb.classList.remove('is-idle', 'is-hopping');
      void bomb.offsetWidth;
      bomb.classList.add('is-hopping');
      setTimeout(function () {
        bomb.classList.remove('is-hopping');
        bomb.classList.add('is-idle');
      }, 520);
    }
  }

  function startCool(p, ms) {
    var btn = passBtns[p];
    btn.style.setProperty('--cool', ms + 'ms');
    btn.classList.remove('is-cooling');
    void btn.offsetWidth;
    btn.classList.add('is-cooling');
  }

  function pressVisual(btn) {
    btn.classList.add('is-pressed');
    setTimeout(function () { btn.classList.remove('is-pressed'); }, 120);
  }

  function nope(btn) {
    btn.classList.remove('is-nope');
    void btn.offsetWidth;
    btn.classList.add('is-nope');
  }

  function setMode(mode) {
    state.mode = mode;
    modeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
    var cpu = mode === 'cpu';
    p2Name.textContent = cpu ? 'Angel · CPU' : 'Angel';
    helpEl.textContent = cpu ? 'A to pass · Space to start' : 'A and L to pass · Space to start';
    passBtns[1].classList.toggle('is-cpu', cpu);
    passBtns[1].setAttribute('aria-disabled', String(cpu));
    passBtns[1].querySelector('kbd').textContent = cpu ? 'CPU' : 'L';
  }

  /* ── The loop ───────────────────────────────────────────────────────── */

  function requestLoop() {
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function loop(now) {
    rafId = 0;
    if (!state.running || state.between || state.paused) return;
    var dt = Math.min(now - state.lastTick, 100);
    state.lastTick = now;
    state.fuseLeft -= dt;

    if (state.mode === 'cpu' && state.holder === 1 && now >= state.cpuAt && now >= state.cool[1]) {
      pressVisual(passBtns[1]);
      pass(1, true);
    }

    if (state.fuseLeft <= 0) {
      explode();
      return;
    }
    requestLoop();
  }

  function scheduleCpu(now) {
    // Human-ish: usually quick, sometimes it hesitates, occasionally it freezes.
    var r = Math.random();
    var reaction = r < 0.7 ? 250 + Math.random() * 700 : r < 0.92 ? 900 + Math.random() * 900 : 1800 + Math.random() * 1400;
    state.cpuAt = now + COOLDOWN + reaction;
  }

  function pass(p, fromCpu) {
    if (!state.running || state.between || state.paused) return;
    if (!fromCpu && p === 1 && state.mode === 'cpu') return;
    var btn = passBtns[p];
    if (state.holder !== p) {
      if (!fromCpu) nope(btn);
      return;
    }
    var now = performance.now();
    if (now < state.cool[p]) {
      if (!fromCpu) nope(btn);
      return;
    }
    var to = 1 - p;
    state.holder = to;
    state.cool[to] = now + COOLDOWN;
    startCool(to, COOLDOWN);
    if (state.mode === 'cpu' && to === 1) scheduleCpu(now);
    renderHolder(true);
    announce(NAMES[to] + ' has the bomb');
  }

  function startRound(holder) {
    var now = performance.now();
    state.between = false;
    state.holder = holder;
    state.fuseLeft = 10000 + Math.random() * 5000; // hidden, never shown
    state.cool = [0, 0];
    state.cool[holder] = now + 500;
    startCool(holder, 500);
    if (state.mode === 'cpu' && holder === 1) scheduleCpu(now);
    roundEl.textContent = 'Round ' + state.round;
    bomb.classList.remove('is-gone');
    renderHolder(false);
    announce(NAMES[holder] + ' starts with the bomb');
    state.lastTick = now;
    requestLoop();
  }

  function explode() {
    state.between = true;
    var loser = state.holder;
    state.hearts[loser] = Math.max(0, state.hearts[loser] - 1);
    renderHearts();
    renderHolder(false);

    boom.style.left = loser === 0 ? '16%' : '84%';
    boom.classList.remove('is-on');
    void boom.offsetWidth;
    boom.classList.add('is-on');
    bomb.classList.add('is-gone');
    fighters[loser].classList.add('is-hit');
    if (!reducedMotion) {
      screen.classList.remove('is-shaking');
      flash.classList.remove('is-on');
      void screen.offsetWidth;
      screen.classList.add('is-shaking');
      flash.classList.add('is-on');
    }
    announce('Boom! ' + NAMES[loser] + ' loses a heart');

    setTimeout(function () {
      fighters[loser].classList.remove('is-hit');
      if (state.hearts[loser] <= 0) {
        gameOver(1 - loser);
      } else {
        state.round++;
        startRound(Math.random() < 0.5 ? 0 : 1);
      }
    }, 1700);
  }

  function gameOver(winner) {
    state.running = false;
    renderHolder(false);
    var cpuWon = state.mode === 'cpu' && winner === 1;
    overlayTitle.textContent = cpuWon ? 'Angel wins' : NAMES[winner] + ' wins!';
    startBtn.textContent = 'Play again';
    announce(cpuWon ? 'The CPU got you. Again?' : NAMES[winner] + ' wins the game');
    overlay.hidden = false;
    startBtn.focus({ preventScroll: true });
  }

  function start() {
    state.hearts = [HEARTS, HEARTS];
    state.round = 1;
    state.running = true;
    state.paused = !state.visible && 'IntersectionObserver' in window;
    renderHearts();
    overlay.hidden = true;
    passBtns[0].focus({ preventScroll: true });
    startRound(Math.random() < 0.5 ? 0 : 1);
  }

  /* ── Input ──────────────────────────────────────────────────────────── */

  passBtns[0].addEventListener('click', function () { pass(0, false); });
  passBtns[1].addEventListener('click', function () { pass(1, false); });
  startBtn.addEventListener('click', start);
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });

  document.addEventListener('keydown', function (e) {
    if (!state.visible || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    var key = e.key.toLowerCase();
    if (key === 'a') {
      pressVisual(passBtns[0]);
      pass(0, false);
    } else if (key === 'l' && state.mode === '2p') {
      pressVisual(passBtns[1]);
      pass(1, false);
    } else if ((key === ' ' || key === 'enter') && !overlay.hidden && document.activeElement !== startBtn) {
      e.preventDefault();
      start();
    }
  });

  /* ── Pause when nobody's looking ────────────────────────────────────── */

  function setPaused(paused) {
    if (paused === state.paused) return;
    state.paused = paused;
    if (!paused) {
      state.lastTick = performance.now();
      if (state.mode === 'cpu' && state.holder === 1) state.cpuAt = Math.max(state.cpuAt, state.lastTick + 300);
      requestLoop();
    }
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      state.visible = entries[0].isIntersecting;
      setPaused(!state.visible || document.hidden);
    }, { threshold: 0.35 }).observe(root);
  } else {
    state.visible = true;
  }

  document.addEventListener('visibilitychange', function () {
    setPaused(document.hidden || !state.visible);
  });

  setMode('cpu');
  renderHearts();
})();
