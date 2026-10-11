/*
 * Photo Widget: two demos.
 *
 * 1. "One crop, every shape" — CropState (a centre and a zoom) projected onto
 *    the Small, Medium and Large widget shapes. cropSize / rect / clamped are
 *    ported from Models.swift; the frame geometry from WidgetFace.swift; the
 *    drag, rubber-band, snap and anchored zoom from EditorStage.swift; the mat
 *    colours from WidgetAppearance.matColors.
 * 2. "Timing" — PhotoSchedule.swift ported line for line, SplitMix64 in BigInt.
 */
(function () {
  'use strict';

  var demo = document.querySelector('[data-pw-demo]');
  var sched = document.querySelector('[data-pw-schedule]');
  if (!demo && !sched) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var icon = (window.SITE && SITE.icon) || function () { return ''; };
  var DIR = 'Assets/web/photo-widget/';

  // Starting points are hand-placed stand-ins for Vision's saliency result.
  var PHOTOS = [
    { file: 'sunset', w: 960, h: 1200, focus: { x: 0.53, y: 0.5 }, alt: 'A silver Porsche Cayman parked on brick paving at sunset, trees and a building behind it' },
    { file: 'leaves', w: 1440, h: 960, focus: { x: 0.44, y: 0.47 }, alt: 'A silver BMW saloon seen through dark foliage, parked beside a garden' },
    { file: 'taillights', w: 960, h: 1200, focus: { x: 0.6, y: 0.47 }, alt: 'Close-up of a car’s glowing red taillight at dusk' },
    { file: 'dragon', w: 960, h: 1200, focus: { x: 0.62, y: 0.52 }, alt: 'A car at night in front of a green-lit dragon sculpture' },
    { file: 'angel-eyes', w: 959, h: 1200, focus: { x: 0.47, y: 0.47 }, alt: 'A BMW in a dark car park with its ring headlights glowing orange' }
  ];
  PHOTOS.forEach(function (p) {
    p.src = DIR + p.file + '.webp';
    // url() inside a custom property resolves against the stylesheet, so CSS gets an absolute one.
    p.url = 'url("' + new URL(p.src, document.baseURI).href + '")';
    p.aspect = p.w / p.h;
    p.crop = { cx: p.focus.x, cy: p.focus.y, zoom: 1 };
    p.avg = null;
  });

  /* ── Crop maths (Models.swift, CropState) ────────────────────────────── */

  var MIN_ZOOM = 1, MAX_ZOOM = 5;

  function cropSize(ia, ta, zoom) {
    var base = ta > ia ? { w: 1, h: ia / ta } : { w: ta / ia, h: 1 };
    var z = Math.max(zoom, 0.01);
    return { w: base.w / z, h: base.h / z };
  }

  function rectOf(s, ia, ta) {
    var c = cropSize(ia, ta, s.zoom);
    return { x: s.cx - c.w / 2, y: s.cy - c.h / 2, w: c.w, h: c.h };
  }

  function clampCenter(v, half) {
    return half >= 0.5 ? 0.5 : Math.min(Math.max(v, half), 1 - half);
  }

  function clamped(s, ia, ta) {
    var zoom = Math.min(Math.max(s.zoom, MIN_ZOOM), MAX_ZOOM);
    var c = cropSize(ia, ta, zoom);
    return { cx: clampCenter(s.cx, c.w / 2), cy: clampCenter(s.cy, c.h / 2), zoom: zoom };
  }

  /* EditorStage.swift: the same resistance curve UIScrollView uses. */
  function rubberBand(value, limit, dim) {
    var over = value - limit;
    if (over === 0) return value;
    var b = (1 - 1 / (Math.abs(over) * 0.55 / dim + 1)) * dim;
    return limit + (over > 0 ? b : -b);
  }

  function banded(raw, ia, ta, slotW, slotH) {
    var zoom = raw.zoom;
    if (zoom < MIN_ZOOM) zoom = MIN_ZOOM * Math.pow(zoom / MIN_ZOOM, 0.3);
    if (zoom > MAX_ZOOM) zoom = MAX_ZOOM * Math.pow(zoom / MAX_ZOOM, 0.3);
    var c = cropSize(ia, ta, zoom);
    var limX = clampCenter(raw.cx, c.w / 2), limY = clampCenter(raw.cy, c.h / 2);
    var x = rubberBand(raw.cx, limX, c.w), y = rubberBand(raw.cy, limY, c.h);
    var snapX = false, snapY = false;
    if (c.w < 0.999 && Math.abs(x - 0.5) * slotW / c.w < 7 && Math.abs(raw.cx - limX) < 0.0001) { x = 0.5; snapX = true; }
    if (c.h < 0.999 && Math.abs(y - 0.5) * slotH / c.h < 7 && Math.abs(raw.cy - limY) < 0.0001) { y = 0.5; snapY = true; }
    return { cx: x, cy: y, zoom: zoom, snapX: snapX, snapY: snapY };
  }

  /* Zooms so the point under the fingers stays put. */
  function zoomAt(s, factor, ax, ay, ia, ta) {
    var r = rectOf(s, ia, ta);
    ax = Math.min(Math.max(ax, 0), 1);
    ay = Math.min(Math.max(ay, 0), 1);
    var px = r.x + ax * r.w, py = r.y + ay * r.h;
    var z = s.zoom * factor;
    var c = cropSize(ia, ta, z);
    return { cx: px - ax * c.w + c.w / 2, cy: py - ay * c.h + c.h / 2, zoom: z };
  }

  /* ── Widget geometry (WidgetFace.swift, WidgetLayout) ────────────────── */

  var SIZES = {
    small: { w: 170, h: 170, roomy: false, cap: 13 },
    medium: { w: 364, h: 170, roomy: false, cap: 13 },
    large: { w: 364, h: 382, roomy: true, cap: 15 }
  };

  function layout(size, frame) {
    var S = SIZES[size], i = { t: 0, l: 0, b: 0, r: 0 }, pr = 0;
    var inset = S.roomy ? 12 : 10;
    if (frame === 'border') {
      i = { t: inset, l: inset, b: inset, r: inset };
      pr = Math.max(22 - inset, 4);
    } else if (frame === 'polaroid') {
      i = { t: inset, l: inset, b: S.roomy ? 40 : 30, r: inset };
      pr = 5;
    }
    return { i: i, pr: pr, aspect: (S.w - i.l - i.r) / (S.h - i.t - i.b) };
  }

  /* ── Mat colours (WidgetAppearance.matColors) ────────────────────────── */

  function toHsb(c) {
    var r = c[0], g = c[1], b = c[2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    return { h: h, s: max === 0 ? 0 : d / max, b: max };
  }

  function fromHsb(h, s, v) {
    h = (((h % 1) + 1) % 1) * 6;
    var c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c, rgb;
    switch (Math.floor(h)) {
      case 0: rgb = [c, x, 0]; break;
      case 1: rgb = [x, c, 0]; break;
      case 2: rgb = [0, c, x]; break;
      case 3: rgb = [0, x, c]; break;
      case 4: rgb = [x, 0, c]; break;
      default: rgb = [c, 0, x];
    }
    return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
  }

  function matColors(mat, avg) {
    var hsb = toHsb(avg || [0.6, 0.6, 0.62]);
    switch (mat) {
      case 'auto': return { mat: fromHsb(hsb.h, Math.min(hsb.s * 0.45, 0.22), 0.95), ink: fromHsb(hsb.h, Math.min(hsb.s, 0.5), 0.26) };
      case 'glow': return { mat: fromHsb(hsb.h, Math.min(hsb.s * 1.1, 0.8), hsb.b * 0.55), ink: [1, 1, 1] };
      case 'white': return { mat: [1, 1, 1], ink: [0.11, 0.11, 0.12] };
      case 'paper': return { mat: [0.96, 0.94, 0.89], ink: [0.27, 0.23, 0.19] };
      case 'charcoal': return { mat: [0.14, 0.14, 0.15], ink: [0.93, 0.92, 0.9] };
      default: return { mat: [0, 0, 0], ink: [0.92, 0.92, 0.92] };
    }
  }

  function css(c) {
    return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
  }

  // CIAreaAverage, done with a small canvas.
  function averageOf(img) {
    try {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      var d = ctx.getImageData(0, 0, 32, 32).data, r = 0, g = 0, b = 0, n = d.length / 4;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      return [r / n / 255, g / n / 255, b / n / 255];
    } catch (e) {
      return null;
    }
  }

  // Positions an <img> inside its slot so the slot shows exactly `r` of it.
  function place(img, r) {
    img.style.width = (100 / r.w) + '%';
    img.style.height = (100 / r.h) + '%';
    img.style.left = (-r.x / r.w * 100) + '%';
    img.style.top = (-r.y / r.h * 100) + '%';
  }

  var style = { photo: 0, frame: 'fullBleed', mat: 'auto', caption: false, text: 'Golden hour' };
  var listeners = [];
  function changed() { listeners.forEach(function (fn) { fn(); }); }

  function settle(el) {
    if (reduce || !el) return;
    el.classList.add('is-settling');
    clearTimeout(el._settle);
    el._settle = setTimeout(function () { el.classList.remove('is-settling'); }, 460);
  }

  /* Builds the inside of a widget: mat, glow, photo slot, guides, captions. */
  function buildWidget(el) {
    el.innerHTML =
      '<img class="pw-ghost" alt="" draggable="false">' +
      '<div class="pw-face">' +
        '<div class="pw-glow"></div>' +
        '<div class="pw-slot"><img class="pw-img" alt="" draggable="false">' +
          '<div class="pw-guides"><i class="g1"></i><i class="g2"></i><i class="g3"></i><i class="g4"></i><i class="sx"></i><i class="sy"></i></div>' +
          '<div class="pw-ocap" hidden><span></span></div>' +
        '</div>' +
        '<p class="pw-pcap" hidden></p>' +
      '</div>';
    return {
      el: el,
      size: el.getAttribute('data-size') || 'small',
      face: el.querySelector('.pw-face'),
      slot: el.querySelector('.pw-slot'),
      img: el.querySelector('.pw-img'),
      ghost: el.querySelector('.pw-ghost'),
      ocap: el.querySelector('.pw-ocap'),
      pcap: el.querySelector('.pw-pcap')
    };
  }

  /* Draws one widget face for photo p, framed by state s (already projected). */
  function paintWidget(wd, p, s) {
    var lay = layout(wd.size, style.frame);
    var st = wd.el.style;
    st.setProperty('--it', lay.i.t);
    st.setProperty('--il', lay.i.l);
    st.setProperty('--ib', lay.i.b);
    st.setProperty('--ir', lay.i.r);
    st.setProperty('--pr', lay.pr);
    st.setProperty('--cap', SIZES[wd.size].cap);
    if (wd.img.getAttribute('src') !== p.src) {
      wd.img.src = p.src;
      wd.ghost.src = p.src;
      wd.face.style.setProperty('--img', p.url);
    }
    place(wd.img, rectOf(s, p.aspect, lay.aspect));

    var colors = matColors(style.mat, p.avg);
    wd.face.style.setProperty('--mat', css(colors.mat));
    wd.face.style.setProperty('--ink', css(colors.ink));
    wd.face.classList.toggle('is-glow', style.mat === 'glow' && style.frame !== 'fullBleed');

    var text = style.caption ? style.text.trim() : '';
    var polaroid = style.frame === 'polaroid';
    wd.ocap.hidden = !text || polaroid;
    wd.pcap.hidden = !text || !polaroid;
    wd.ocap.firstChild.textContent = text;
    wd.pcap.textContent = text;
    return lay;
  }

  /* ════════════════════════════════════════════════════════════════════
     1. One crop, every shape
     ════════════════════════════════════════════════════════════════════ */

  if (demo) (function () {
    var stage = demo.querySelector('[data-stage]');
    var src = demo.querySelector('[data-src]');
    var srcImg = demo.querySelector('[data-src-img]');
    var focusBtn = demo.querySelector('[data-focus]');
    var focusLabel = demo.querySelector('[data-focus-label]');
    var zoomIn = demo.querySelector('[data-zoom]');
    var zoomOut = demo.querySelector('[data-zoom-out]');
    var readout = demo.querySelector('[data-readout]');
    var home = demo.querySelector('[data-home]');
    var strip = demo.querySelector('[data-strip]');
    var matsEl = demo.querySelector('[data-mats]');
    var capToggle = demo.querySelector('[data-cap-toggle]');
    var capText = demo.querySelector('[data-cap-text]');
    var wins = {};
    Array.prototype.forEach.call(demo.querySelectorAll('[data-win]'), function (w) { wins[w.getAttribute('data-win')] = w; });

    var widgets = Array.prototype.map.call(home.querySelectorAll('.pw-w'), buildWidget);
    var drag = null; // a widget being dragged on the home screen

    function photo() { return PHOTOS[style.photo]; }

    /* The film strip. */
    strip.innerHTML = PHOTOS.map(function (p, i) {
      return '<button type="button" aria-pressed="' + (i === 0) + '" data-pick="' + i + '"><img src="' + p.src + '" alt="' + p.alt + '" width="' + p.w + '" height="' + p.h + '" loading="lazy"></button>';
    }).join('');
    var stripBtns = Array.prototype.slice.call(strip.querySelectorAll('button'));

    /* Mats. */
    var MATS = [['auto', 'Auto'], ['glow', 'Glow'], ['white', 'White'], ['paper', 'Paper'], ['charcoal', 'Charcoal'], ['black', 'Black']];
    matsEl.innerHTML = MATS.map(function (m) {
      return '<button type="button" data-mat="' + m[0] + '" aria-pressed="' + (m[0] === 'auto') + '" aria-label="' + m[1] + '" title="' + m[1] + '"></button>';
    }).join('');
    var matBtns = Array.prototype.slice.call(matsEl.querySelectorAll('button'));

    function paintSwatches() {
      var p = photo();
      matBtns.forEach(function (b) {
        var m = b.getAttribute('data-mat');
        b.style.setProperty('--sw', m === 'glow'
          ? 'radial-gradient(circle at 35% 35%, rgba(255,255,255,.35), transparent 60%), ' + css(matColors('glow', p.avg).mat)
          : css(matColors(m, p.avg).mat));
      });
      matsEl.classList.toggle('is-off', style.frame === 'fullBleed');
    }

    /* Fit the source photo inside the stage. */
    function fitSource() {
      var p = photo();
      var W = stage.clientWidth - 32, H = stage.clientHeight - 32;
      var w = W, h = W / p.aspect;
      if (h > H) { h = H; w = H * p.aspect; }
      src.style.width = Math.round(w) + 'px';
      src.style.height = Math.round(h) + 'px';
    }

    function shownState(size, p) {
      var ta = layout(size, style.frame).aspect;
      if (drag && drag.size === size) return drag.shown;
      return clamped(p.crop, p.aspect, ta);
    }

    function render() {
      var p = photo();
      widgets.forEach(function (wd) {
        var s = shownState(wd.size, p);
        var lay = paintWidget(wd, p, s);
        var r = rectOf(s, p.aspect, lay.aspect);
        // Its window on the source photo.
        var win = wins[wd.size];
        win.style.left = r.x * 100 + '%';
        win.style.top = r.y * 100 + '%';
        win.style.width = r.w * 100 + '%';
        win.style.height = r.h * 100 + '%';
        win.style.backgroundSize = (100 / r.w) + '% ' + (100 / r.h) + '%';
        win.style.backgroundPosition = (r.w < 0.9999 ? r.x / (1 - r.w) * 100 : 0) + '% ' + (r.h < 0.9999 ? r.y / (1 - r.h) * 100 : 0) + '%';
        if (drag && drag.size === wd.size) placeGhost(wd, r);
      });
      focusBtn.style.left = p.crop.cx * 100 + '%';
      focusBtn.style.top = p.crop.cy * 100 + '%';
      focusLabel.textContent = 'Crop centre at ' + Math.round(p.crop.cx * 100) + '% across, ' + Math.round(p.crop.cy * 100) + '% down';
      zoomIn.value = p.crop.zoom;
      zoomOut.textContent = p.crop.zoom.toFixed(1) + '×';
      readout.innerHTML = 'CropState(centerX: <b>' + p.crop.cx.toFixed(2) + '</b>, centerY: <b>' + p.crop.cy.toFixed(2) + '</b>, zoom: <b>' + p.crop.zoom.toFixed(2) + '</b>)';
      changed();
    }

    function setPhoto(i) {
      style.photo = i;
      stripBtns.forEach(function (b, n) { b.setAttribute('aria-pressed', String(n === i)); });
      var p = photo();
      srcImg.src = p.src;
      srcImg.alt = p.alt;
      srcImg.width = p.w;
      srcImg.height = p.h;
      Object.keys(wins).forEach(function (k) { wins[k].style.setProperty('--img', p.url); });
      fitSource();
      render();
      paintSwatches();
    }

    /* Load each photo once to learn its average colour (for Auto and Glow mats). */
    PHOTOS.forEach(function (p) {
      var im = new Image();
      im.onload = function () {
        p.avg = averageOf(im);
        if (p === photo()) { paintSwatches(); render(); }
      };
      im.src = p.src;
    });

    /* ── Source stage: drag the centre, pinch or ctrl-scroll to zoom ──── */

    var pointers = {};
    var pinch = null;
    var grab = null;

    function toUnit(e) {
      var r = src.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }

    function setCentre(x, y) {
      var p = photo();
      p.crop.cx = Math.min(Math.max(x, 0), 1);
      p.crop.cy = Math.min(Math.max(y, 0), 1);
      render();
    }

    function setZoom(z) {
      var p = photo();
      p.crop.zoom = Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
      render();
    }

    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: photo().crop.zoom };
        grab = null;
        return;
      }
      var u = toUnit(e);
      var p = photo();
      if (e.target === focusBtn) {
        grab = { dx: p.crop.cx - u.x, dy: p.crop.cy - u.y };
      } else {
        grab = { dx: 0, dy: 0 };
        setCentre(u.x, u.y);
      }
      stage.classList.add('is-grabbing');
      e.preventDefault();
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (pinch && ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        setZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinch.d, 1));
        return;
      }
      if (grab) {
        var u = toUnit(e);
        setCentre(u.x + grab.dx, u.y + grab.dy);
      }
    });

    function release(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length) { grab = null; stage.classList.remove('is-grabbing'); }
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    stage.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return; // trackpad pinch arrives as ctrl + wheel
      e.preventDefault();
      setZoom(photo().crop.zoom * Math.exp(-e.deltaY * 0.01));
    }, { passive: false });

    stage.addEventListener('dblclick', function (e) {
      var u = toUnit(e);
      var p = photo();
      settle(demo);
      if (p.crop.zoom > 1.05) { p.crop.zoom = 1; render(); }
      else { p.crop.zoom = 2.2; setCentre(u.x, u.y); }
    });

    focusBtn.addEventListener('keydown', function (e) {
      var p = photo(), step = e.shiftKey ? 0.05 : 0.01;
      var k = e.key;
      if (k === 'ArrowLeft') setCentre(p.crop.cx - step, p.crop.cy);
      else if (k === 'ArrowRight') setCentre(p.crop.cx + step, p.crop.cy);
      else if (k === 'ArrowUp') setCentre(p.crop.cx, p.crop.cy - step);
      else if (k === 'ArrowDown') setCentre(p.crop.cx, p.crop.cy + step);
      else if (k === '+' || k === '=') setZoom(p.crop.zoom * 1.15);
      else if (k === '-' || k === '_') setZoom(p.crop.zoom / 1.15);
      else return;
      e.preventDefault();
    });

    zoomIn.addEventListener('input', function () { setZoom(parseFloat(zoomIn.value)); });

    demo.querySelector('[data-smart]').addEventListener('click', function () {
      var p = photo();
      settle(demo);
      p.crop = { cx: p.focus.x, cy: p.focus.y, zoom: 1 };
      render();
    });

    /* ── Widgets on the home screen: drag, rubber-band, snap ──────────── */

    function placeGhost(wd, r) {
      // The whole photo, faintly, around the widget while it's being moved.
      var sr = wd.slot.getBoundingClientRect(), wr = wd.el.getBoundingClientRect();
      var w = sr.width / r.w, h = sr.height / r.h;
      wd.ghost.style.width = w + 'px';
      wd.ghost.style.height = h + 'px';
      wd.ghost.style.left = (sr.left - wr.left - r.x * w) + 'px';
      wd.ghost.style.top = (sr.top - wr.top - r.y * h) + 'px';
    }

    function hot(size, on) {
      widgets.forEach(function (wd) { wd.el.classList.toggle('is-hot', on && wd.size === size); });
      Object.keys(wins).forEach(function (k) { wins[k].classList.toggle('is-hot', on && k === size); });
    }

    widgets.forEach(function (wd) {
      var el = wd.el;

      el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hot(wd.size, true); });
      el.addEventListener('pointerleave', function () { if (!drag) hot(wd.size, false); });

      el.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || drag) return;
        var p = photo();
        var ta = layout(wd.size, style.frame).aspect;
        var sr = wd.slot.getBoundingClientRect();
        var start = clamped(p.crop, p.aspect, ta);
        drag = { size: wd.size, wd: wd, id: e.pointerId, x: e.clientX, y: e.clientY, raw: start, shown: start, w: sr.width, h: sr.height, ta: ta, moved: false };
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', function (e) {
        if (!drag || drag.wd !== wd || e.pointerId !== drag.id) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 2) return;
        if (!drag.moved) { drag.moved = true; el.classList.add('is-dragging'); hot(wd.size, true); }
        drag.x = e.clientX;
        drag.y = e.clientY;
        var p = photo();
        var c = cropSize(p.aspect, drag.ta, drag.raw.zoom);
        drag.raw = { cx: drag.raw.cx - dx * c.w / drag.w, cy: drag.raw.cy - dy * c.h / drag.h, zoom: drag.raw.zoom };
        var b = banded(drag.raw, p.aspect, drag.ta, drag.w, drag.h);
        drag.shown = { cx: b.cx, cy: b.cy, zoom: b.zoom };
        el.classList.toggle('snap-x', b.snapX);
        el.classList.toggle('snap-y', b.snapY);
        // Every other shape follows the same centre.
        p.crop.cx = Math.min(Math.max(b.cx, 0), 1);
        p.crop.cy = Math.min(Math.max(b.cy, 0), 1);
        render();
      });

      function end(e) {
        if (!drag || drag.wd !== wd || e.pointerId !== drag.id) return;
        var p = photo();
        var moved = drag.moved;
        if (moved) {
          var b = banded(drag.raw, p.aspect, drag.ta, drag.w, drag.h);
          var settled = clamped({ cx: b.cx, cy: b.cy, zoom: b.zoom }, p.aspect, drag.ta);
          p.crop = settled;
        }
        drag = null;
        el.classList.remove('is-dragging', 'snap-x', 'snap-y');
        if (e.type === 'pointercancel' || e.pointerType !== 'mouse') hot(wd.size, false);
        if (moved) { settle(home); settle(demo); }
        render();
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      el.addEventListener('wheel', function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        var p = photo();
        var ta = layout(wd.size, style.frame).aspect;
        var sr = wd.slot.getBoundingClientRect();
        var next = zoomAt(clamped(p.crop, p.aspect, ta), Math.exp(-e.deltaY * 0.01), (e.clientX - sr.left) / sr.width, (e.clientY - sr.top) / sr.height, p.aspect, ta);
        p.crop = clamped(next, p.aspect, ta);
        render();
      }, { passive: false });

      // Double-tap: zoom in 2.2× under the pointer, or back out to 1×.
      el.addEventListener('dblclick', function (e) {
        var p = photo();
        var ta = layout(wd.size, style.frame).aspect;
        var sr = wd.slot.getBoundingClientRect();
        var committed = clamped(p.crop, p.aspect, ta);
        var target = committed.zoom > 1.05
          ? { cx: committed.cx, cy: committed.cy, zoom: 1 }
          : zoomAt(committed, 2.2, (e.clientX - sr.left) / sr.width, (e.clientY - sr.top) / sr.height, p.aspect, ta);
        p.crop = clamped(target, p.aspect, ta);
        settle(home);
        settle(demo);
        render();
      });
    });

    /* ── Style controls ───────────────────────────────────────────────── */

    var frameBtns = Array.prototype.slice.call(demo.querySelectorAll('[data-frame]'));

    function setFrame(f) {
      style.frame = f;
      frameBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-frame') === f)); });
      settle(home);
      settle(demo);
      render();
      paintSwatches();
    }

    frameBtns.forEach(function (b) {
      b.addEventListener('click', function () { setFrame(b.getAttribute('data-frame')); });
    });

    matBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        style.mat = b.getAttribute('data-mat');
        matBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        // A mat only shows around a framed photo.
        if (style.frame === 'fullBleed') setFrame('border');
        else render();
      });
    });

    capToggle.addEventListener('click', function () {
      style.caption = !style.caption;
      capToggle.setAttribute('aria-pressed', String(style.caption));
      capText.disabled = !style.caption;
      render();
    });

    capText.addEventListener('input', function () {
      style.text = capText.value;
      render();
    });

    stripBtns.forEach(function (b, i) {
      b.addEventListener('click', function () { setPhoto(i); });
    });

    if ('ResizeObserver' in window) new ResizeObserver(function () { fitSource(); }).observe(stage);
    else window.addEventListener('resize', fitSource);

    setPhoto(0);
  })();

  /* ════════════════════════════════════════════════════════════════════
     2. Timing — PhotoSchedule.swift
     ════════════════════════════════════════════════════════════════════ */

  if (sched && typeof BigInt === 'function') (function () {
    var M64 = (BigInt(1) << BigInt(64)) - BigInt(1);
    var GOLDEN = BigInt('0x9E3779B97F4A7C15');

    // A demo widget's id. seed(for:) reads the UUID's first eight bytes as a
    // little-endian UInt64, exactly as loadUnaligned does on an iPhone.
    var UUID = '3F2A9C4E-7B1D-4E8A-9C3F-5D6E7A8B9C0D';
    var SEED = (function () {
      var hex = UUID.replace(/-/g, '').slice(0, 16), v = BigInt(0);
      for (var i = 7; i >= 0; i--) v = (v << BigInt(8)) | BigInt(parseInt(hex.substr(i * 2, 2), 16));
      return v;
    })();

    function splitMix(state) {
      return function next() {
        state = (state + GOLDEN) & M64;
        var z = state;
        z = ((z ^ (z >> BigInt(30))) * BigInt('0xBF58476D1CE4E5B9')) & M64;
        z = ((z ^ (z >> BigInt(27))) * BigInt('0x94D049BB133111EB')) & M64;
        return z ^ (z >> BigInt(31));
      };
    }

    function permutation(count, seed) {
      var next = splitMix(seed), values = [];
      for (var n = 0; n < count; n++) values.push(n);
      for (var i = count - 1; i > 0; i--) {
        var j = Number(next() % BigInt(i + 1));
        var t = values[i]; values[i] = values[j]; values[j] = t;
      }
      return values;
    }

    // seed &+ UInt64(bitPattern: Int64(cycle)) &* 0x9E37_79B9_7F4A_7C15
    function cycleSeed(seed, cycle) {
      return (seed + ((BigInt.asUintN(64, BigInt(cycle)) * GOLDEN) & M64)) & M64;
    }

    /* A fresh permutation per cycle, never starting with the previous cycle's last photo. */
    function shuffled(count, seed, cycle) {
      var order = permutation(count, cycleSeed(seed, cycle));
      var previous = permutation(count, cycleSeed(seed, cycle - 1));
      if (order[0] === previous[count - 1] && count > 1) { var t = order[0]; order[0] = order[1]; order[1] = t; }
      return order;
    }

    function mod(a, n) { return ((a % n) + n) % n; }
    function floorDiv(a, n) { return Math.floor(a / n); }

    function zoneOffset(ms) { return -new Date(ms).getTimezoneOffset() * 60; }

    /* Monotonic counter that ticks once per interval, aligned to the local clock. */
    function slot(ms, seconds) { return Math.floor((ms / 1000 + zoneOffset(ms)) / seconds); }
    function slotStart(n, seconds) {
      var guess = n * seconds * 1000;
      return (n * seconds - zoneOffset(guess)) * 1000;
    }

    function photoFor(step, count, order) {
      if (count <= 1) return 0;
      if (order === 'inOrder') return mod(step, count);
      return shuffled(count, SEED, floorDiv(step, count))[mod(step, count)];
    }

    /* ── UI ─────────────────────────────────────────────────────────────── */

    var COUNT = PHOTOS.length;
    var cfg = { seconds: 3600, order: 'shuffle', offset: 0, picked: null };
    var rounds = sched.querySelector('[data-rounds]');
    var legend = sched.querySelector('[data-legend]');
    var nowText = sched.querySelector('[data-sched-now]');
    var resetBtn = sched.querySelector('[data-sched-reset]');
    var wd = buildWidget(sched.querySelector('[data-sched-widget]'));
    wd.size = 'small';
    var timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    var dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

    function label(step) {
      var ms = slotStart(step - cfg.offset, cfg.seconds);
      var t = timeFmt.format(ms);
      var today = new Date();
      var d = new Date(ms);
      return d.toDateString() === today.toDateString() ? t : dayFmt.format(ms) + ' ' + t;
    }

    function smallRect(p) {
      var ta = layout('small', 'fullBleed').aspect;
      return rectOf(clamped(p.crop, p.aspect, ta), p.aspect, ta);
    }

    function render() {
      var nowStep = slot(Date.now(), cfg.seconds) + cfg.offset;
      if (cfg.picked == null || cfg.picked < nowStep - COUNT * 3 || cfg.picked > nowStep + COUNT * 3) cfg.picked = nowStep;
      var first = floorDiv(nowStep, COUNT);
      var names = ['This round', 'Next round', 'After that'];
      var html = '', okOnce = true, okBoundary = true, prevLast = null;

      for (var r = 0; r < 3; r++) {
        var c = first + r, seen = {};
        html += '<div class="pw-round" role="group" aria-label="' + names[r] + '"><p class="pw-round__label">' + names[r] + '<small>cycle ' + (r + 1) + '</small></p>';
        for (var k = 0; k < COUNT; k++) {
          var step = c * COUNT + k;
          var idx = photoFor(step, COUNT, cfg.order);
          if (seen[idx]) okOnce = false;
          seen[idx] = true;
          if (k === 0 && prevLast != null && idx === prevLast) okBoundary = false;
          if (k === COUNT - 1) prevLast = idx;
          var p = PHOTOS[idx];
          var cls = 'pw-cell' + (step < nowStep ? ' is-past' : '') + (step === nowStep ? ' is-now' : '') + (step === cfg.picked ? ' is-picked' : '');
          var rr = smallRect(p);
          html += '<button type="button" class="' + cls + '" data-step="' + step + '" aria-pressed="' + (step === cfg.picked) + '" aria-label="' + label(step) + ': photo ' + (idx + 1) + (step === nowStep ? ', showing now' : '') + '">' +
            (step === nowStep ? '<span class="pw-cell__tag">Now</span>' : '') +
            '<span class="pw-cell__img"><img src="' + p.src + '" alt="" style="width:' + (100 / rr.w) + '%;height:' + (100 / rr.h) + '%;left:' + (-rr.x / rr.w * 100) + '%;top:' + (-rr.y / rr.h * 100) + '%"><span class="pw-cell__n">' + (idx + 1) + '</span></span>' +
            '<span class="pw-cell__t">' + label(step) + '</span>' +
          '</button>';
        }
        html += '</div>';
      }
      rounds.innerHTML = html;

      var ok = icon('check');
      legend.innerHTML = cfg.order === 'shuffle'
        ? '<span>Shuffled: each round is a fresh order.</span>' +
          (okOnce ? '<span class="pw-check">' + ok + 'Every photo once per round</span>' : '') +
          (okBoundary ? '<span class="pw-check">' + ok + 'No repeat across a boundary</span>' : '')
        : '<span>In order: the photos simply take turns, 1 to 5, then again.</span>' +
          (okOnce ? '<span class="pw-check">' + ok + 'Every photo once per round</span>' : '');

      // The widget shows the picked slot.
      var pickedIdx = photoFor(cfg.picked, COUNT, cfg.order);
      var pp = PHOTOS[pickedIdx];
      paintWidget(wd, pp, clamped(pp.crop, pp.aspect, layout('small', style.frame).aspect));
      wd.el.setAttribute('aria-label', 'Small widget showing photo ' + (pickedIdx + 1) + '. Tap for the next photo.');
      var endMs = slotStart(cfg.picked - cfg.offset + 1, cfg.seconds);
      nowText.innerHTML = cfg.picked === nowStep
        ? '<strong>Now</strong>, until ' + timeFmt.format(endMs) + ': photo ' + (pickedIdx + 1) + ' of ' + COUNT + '.'
        : '<strong>' + label(cfg.picked) + '</strong> to ' + timeFmt.format(endMs) + ': photo ' + (pickedIdx + 1) + ' of ' + COUNT + '.';
      resetBtn.hidden = cfg.offset === 0;
    }

    rounds.addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      cfg.picked = parseInt(b.getAttribute('data-step'), 10);
      render();
    });

    // NextPhotoIntent: the tap offset moves this widget one step ahead.
    wd.el.addEventListener('click', function () {
      var nowStep = slot(Date.now(), cfg.seconds) + cfg.offset;
      var following = cfg.picked === nowStep;
      cfg.offset++;
      if (following) cfg.picked = nowStep + 1;
      render();
    });

    resetBtn.addEventListener('click', function () {
      cfg.offset = 0;
      cfg.picked = null;
      render();
    });

    function wire(attr, key, parse) {
      var btns = Array.prototype.slice.call(sched.querySelectorAll('[' + attr + ']'));
      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          cfg[key] = parse(b.getAttribute(attr));
          btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
          cfg.picked = null;
          render();
        });
      });
    }
    wire('data-every', 'seconds', function (v) { return parseInt(v, 10); });
    wire('data-order', 'order', function (v) { return v; });

    // Crops and frames chosen above flow into this widget too — redrawn when
    // this section is on screen, not on every frame of a drag elsewhere.
    var queued = false, visible = true, stale = false;
    listeners.push(function () {
      if (!visible) { stale = true; return; }
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; render(); });
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && stale) { stale = false; render(); }
      }).observe(sched);
    }

    // Keep "now" honest if a slot boundary passes while the page is open.
    setInterval(function () { if (!document.hidden) render(); }, 30000);
    render();
  })();
})();
