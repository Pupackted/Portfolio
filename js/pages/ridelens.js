/*
 * RideLens: the before/after slider, the poster rail buttons, and the Reel,
 * which only plays while it's on screen (and never on its own when the
 * reader has asked for reduced motion).
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ── Before / after ─────────────────────────────────────────────────── */

  function initCompare() {
    var root = $('[data-rl-compare]');
    if (!root) return;
    var frame = $('.rl-compare__frame', root);
    var range = $('[data-range]', root);
    var img = $('[data-after-img]', root);
    var before = $('[data-before-img]', root);
    var label = $('[data-after-label]', root);
    var buttons = $$('[data-variant]', root);
    var pending = 0;

    function decode(src) {
      var i = new Image();
      i.src = src;
      return i.decode ? i.decode().catch(function () {}) : Promise.resolve();
    }

    function set(v) {
      frame.style.setProperty('--pos', v + '%');
      range.setAttribute('aria-valuetext', v + '% before, ' + (100 - v) + '% after');
    }

    range.addEventListener('input', function () { set(+range.value); });
    set(+range.value);

    // Each variant is its own photo, so the before changes too. Both halves
    // are decoded first, so the slider never shows two different shots.
    buttons.forEach(function (b) {
      var warm = function () { decode(b.getAttribute('data-before')); decode(b.getAttribute('data-variant')); };
      b.addEventListener('pointerenter', warm, { once: true });
      b.addEventListener('focus', warm, { once: true });
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        var ticket = ++pending;
        Promise.all([decode(b.getAttribute('data-before')), decode(b.getAttribute('data-variant'))]).then(function () {
          if (ticket !== pending) return;
          before.src = b.getAttribute('data-before');
          before.alt = b.getAttribute('data-before-alt');
          img.src = b.getAttribute('data-variant');
          img.alt = b.getAttribute('data-alt');
          label.textContent = b.getAttribute('data-label');
        });
      });
    });
  }

  /* ── Poster rail ────────────────────────────────────────────────────── */

  function initRail() {
    var rail = $('.rl-rail');
    if (!rail) return;
    function step(dir) {
      var card = $('.rl-poster', rail);
      var by = card ? (card.getBoundingClientRect().width + 16) * 2 : 400;
      rail.scrollBy({ left: dir * by, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    var prev = $('[data-rail-prev]');
    var next = $('[data-rail-next]');
    if (prev) prev.addEventListener('click', function () { step(-1); });
    if (next) next.addEventListener('click', function () { step(1); });
    rail.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });
  }

  /* ── Reel ───────────────────────────────────────────────────────────── */

  function initReel() {
    var video = $('[data-reel]');
    if (!video) return;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      // Leave it still, but playable on request.
      video.controls = true;
      video.preload = 'metadata';
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      var on = entries[0].isIntersecting;
      if (on) {
        if (video.preload === 'none') video.preload = 'auto';
        var p = video.play();
        if (p && p.catch) p.catch(function () { video.controls = true; });
      } else {
        video.pause();
      }
    }, { threshold: 0.4 });
    io.observe(video);
  }

  initCompare();
  initRail();
  initReel();
})();
