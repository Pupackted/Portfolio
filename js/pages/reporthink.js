/*
 * Reporthink Template Editor, in miniature.
 *
 * The template's palette is a handful of CSS variables on .desk, so a swatch
 * recolours every page and thumbnail at once. Text is contenteditable, and
 * formatting applies to the whole block, like the real editor's per-element
 * controls. A replaced photo is read as an object URL and never leaves the
 * browser. Pages reorder by dragging their thumbnails (FLIP-animated) or with
 * the arrow buttons that appear when a thumbnail has focus.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

  var PALETTES = {
    natural: { pg: '#4a3f38', c1: '#f15a24', c2: '#f7c331', c3: '#8cc63f' },
    ocean: { pg: '#10264a', c1: '#2d7ff9', c2: '#7cc7ff', c3: '#ffd166' },
    forest: { pg: '#0f3a2b', c1: '#2e9d57', c2: '#c6f068', c3: '#7ed3a1' },
    mono: { pg: '#1f2023', c1: '#55585f', c2: '#f5f5f7', c3: '#a1a1a8' },
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function toast(message) { if (window.SITE && window.SITE.toast) window.SITE.toast(message); }

  initEditor();
  initAnnotations();
  initErd();
  initRail();

  /* ── The editor ─────────────────────────────────────────────────────── */

  function initEditor() {
    var desk = $('[data-desk]');
    if (!desk) return;

    var a4 = $('[data-a4]', desk);
    var strip = $('[data-strip]', desk);
    var live = $('[data-live]', desk);
    var pageLabel = $('[data-page-label]', desk);
    var docName = $('[data-doc-name]', desk);
    var saved = $('[data-saved]', desk);
    var savedText = saved.lastElementChild;
    var hint = $('[data-tools-hint]', desk);
    var tools = $$('.tool', desk);
    var swatches = $$('[data-palette]', desk);
    var pages = {};
    $$('[data-page]', a4).forEach(function (p) { pages[p.getAttribute('data-page')] = p; });

    var current = 'cover';
    var active = null; // the text block the toolbar acts on
    var saveTimer = 0;

    function announce(text) {
      live.textContent = text;
    }

    function markDirty() {
      saved.classList.add('is-saving');
      savedText.textContent = 'Saving…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saved.classList.remove('is-saving');
        savedText.textContent = 'Saved';
      }, 800);
    }

    /* Palette */

    swatches.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var palette = PALETTES[btn.getAttribute('data-palette')];
        Object.keys(palette).forEach(function (k) { desk.style.setProperty('--' + k, palette[k]); });
        swatches.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        markDirty();
      });
    });

    /* Text */

    function isBold(el) {
      return parseInt(getComputedStyle(el).fontWeight, 10) >= 600;
    }

    function alignOf(el) {
      var m = /\bal-(left|center|right)\b/.exec(el.className);
      if (m) return m[1];
      var a = getComputedStyle(el).textAlign;
      return a === 'center' ? 'center' : a === 'right' || a === 'end' ? 'right' : 'left';
    }

    function setActive(el) {
      if (active === el) return;
      if (active) active.classList.remove('is-target');
      active = el;
      if (active) active.classList.add('is-target');
      syncTools();
    }

    function syncTools() {
      tools.forEach(function (t) {
        var on = false;
        if (active) {
          var tool = t.getAttribute('data-tool');
          var align = t.getAttribute('data-align');
          if (tool === 'b') on = isBold(active);
          else if (tool === 'i') on = active.classList.contains('is-i');
          else if (align) on = alignOf(active) === align;
        }
        t.setAttribute('aria-pressed', String(on));
        t.setAttribute('aria-disabled', String(!active));
      });
      hint.textContent = active
        ? 'Formatting: ' + (active.getAttribute('data-label') || 'text')
        : 'Click any text on the page to edit it.';
    }

    function apply(tool, align) {
      if (!active) {
        hint.textContent = 'Click some text on the page first.';
        return;
      }
      if (tool === 'b') {
        var bold = isBold(active);
        active.classList.toggle('is-b', !bold);
        active.classList.toggle('no-b', bold);
      } else if (tool === 'i') {
        active.classList.toggle('is-i');
      } else if (align) {
        active.classList.remove('al-left', 'al-center', 'al-right');
        active.classList.add('al-' + align);
      }
      syncTools();
      markDirty();
    }

    function pick(e) {
      var el = e.target.closest && e.target.closest('[contenteditable]');
      if (el) setActive(el);
    }

    desk.addEventListener('focusin', pick);
    a4.addEventListener('click', pick);

    tools.forEach(function (t) {
      // Keep the caret in the text while the toolbar is used.
      t.addEventListener('mousedown', function (e) { e.preventDefault(); });
      t.addEventListener('click', function () { apply(t.getAttribute('data-tool'), t.getAttribute('data-align')); });
    });

    a4.addEventListener('keydown', function (e) {
      var el = e.target.closest && e.target.closest('[contenteditable]');
      if (!el) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'b' || e.key === 'i')) {
        e.preventDefault();
        apply(e.key, null);
      } else if (e.key === 'Enter' && !el.hasAttribute('data-multiline')) {
        e.preventDefault();
        el.blur();
      } else if (e.key === 'Escape') {
        el.blur();
      }
    });

    a4.addEventListener('input', function (e) {
      var el = e.target;
      if (el.hasAttribute && el.hasAttribute('data-doc-source')) {
        docName.textContent = el.textContent.trim().slice(0, 48) || 'Untitled report';
      }
      markDirty();
    });

    /* Photo */

    var photo = $('[data-photo]', desk);
    var photoImg = $('[data-photo-img]', desk);
    var photoInput = $('[data-photo-input]', desk);
    var objectUrl = null;

    function hasFiles(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
    }

    function usePhoto(file) {
      if (!/^image\//.test(file.type)) {
        toast('That isn’t an image. Try a JPG or PNG.');
        return;
      }
      var url = URL.createObjectURL(file);
      var probe = new Image();
      probe.onload = function () {
        photoImg.style.opacity = '0';
        setTimeout(function () {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = url;
          photoImg.src = url;
          photoImg.alt = 'Your photo';
          photoImg.style.opacity = '';
        }, reducedMotion ? 0 : 200);
        markDirty();
        announce('Cover photo replaced');
      };
      probe.onerror = function () {
        URL.revokeObjectURL(url);
        toast('Couldn’t read that image.');
      };
      probe.src = url;
    }

    $('[data-photo-pick]', desk).addEventListener('click', function () { photoInput.click(); });
    photoInput.addEventListener('change', function () {
      if (photoInput.files && photoInput.files[0]) usePhoto(photoInput.files[0]);
      photoInput.value = '';
    });

    // A stray drop anywhere on the desk shouldn't navigate away to the file.
    desk.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    desk.addEventListener('drop', function (e) { if (hasFiles(e)) e.preventDefault(); });

    photo.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      photo.classList.add('is-drag');
    });
    photo.addEventListener('dragleave', function (e) {
      if (!photo.contains(e.relatedTarget)) photo.classList.remove('is-drag');
    });
    photo.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      photo.classList.remove('is-drag');
      if (e.dataTransfer.files[0]) usePhoto(e.dataTransfer.files[0]);
    });

    /* Pages */

    function thumbs() {
      return $$('.thumb', strip);
    }

    function ids() {
      return thumbs().map(function (t) { return t.getAttribute('data-thumb'); });
    }

    function syncStrip() {
      var list = thumbs();
      var index = 0;
      list.forEach(function (t, i) {
        var on = t.getAttribute('data-thumb') === current;
        var hit = $('.thumb__hit', t);
        t.classList.toggle('is-current', on);
        if (on) {
          index = i;
          hit.setAttribute('aria-current', 'true');
        } else {
          hit.removeAttribute('aria-current');
        }
      });
      pageLabel.textContent = 'Page ' + (index + 1) + ' of ' + list.length + ' · ' + list[index].getAttribute('data-name');
    }

    function show(id) {
      if (id === current || !pages[id]) return;
      var order = ids();
      var forward = order.indexOf(id) > order.indexOf(current);
      var next = pages[id];
      var prev = pages[current];
      // Enter from the side you're heading towards; leave towards the other.
      next.style.transition = 'none';
      next.style.setProperty('--from', forward ? '6%' : '-6%');
      void next.offsetWidth;
      next.style.transition = '';
      prev.style.setProperty('--from', forward ? '-6%' : '6%');
      prev.classList.remove('is-current');
      next.classList.add('is-current');
      current = id;
      if (active && !next.contains(active)) setActive(null);
      syncStrip();
    }

    // FLIP: measure, change the order, then animate each thumb from where it was.
    function flip(mutate, skip) {
      var list = thumbs();
      var before = list.map(function (t) { return t.getBoundingClientRect().left; });
      list.forEach(function (t) {
        if (t !== skip && t.getAnimations) t.getAnimations().forEach(function (a) { a.cancel(); });
      });
      mutate();
      if (reducedMotion) return;
      list.forEach(function (t, i) {
        if (t === skip) return;
        var dx = before[i] - t.getBoundingClientRect().left;
        if (Math.abs(dx) < 0.5) return;
        t.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: EASE });
      });
    }

    function committed(thumb) {
      var list = thumbs();
      syncStrip();
      markDirty();
      announce(thumb.getAttribute('data-name') + ' moved to page ' + (list.indexOf(thumb) + 1) + ' of ' + list.length);
    }

    // Arrow buttons move the neighbour rather than the thumb itself, so the
    // focused button never leaves the DOM (which would drop its focus).
    function moveBy(thumb, dir) {
      var list = thumbs();
      var other = list[list.indexOf(thumb) + dir];
      if (!other) return;
      flip(function () {
        strip.insertBefore(other, dir < 0 ? thumb.nextSibling : thumb);
      });
      committed(thumb);
    }

    var suppressClick = false;

    strip.addEventListener('click', function (e) {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var move = e.target.closest('[data-move]');
      if (move) {
        moveBy(move.closest('.thumb'), parseInt(move.getAttribute('data-move'), 10));
        return;
      }
      var hit = e.target.closest('.thumb__hit');
      if (hit) show(hit.closest('.thumb').getAttribute('data-thumb'));
    }, true);

    strip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('.thumb__move')) return;
      var thumb = e.target.closest('.thumb');
      if (!thumb) return;

      var pointer = e.pointerId;
      var startX = e.clientX;
      var startY = e.clientY;
      var originLeft = thumb.offsetLeft;
      var slots = thumbs().map(function (t) { return t.offsetLeft; });
      var startOrder = ids().join();
      var dragging = false;

      function onMove(ev) {
        if (ev.pointerId !== pointer) return;
        var dx = ev.clientX - startX;
        if (!dragging) {
          if (Math.abs(dx) < 6) {
            if (Math.abs(ev.clientY - startY) > 10) end();
            return;
          }
          dragging = true;
          thumb.classList.add('is-dragging');
        }
        ev.preventDefault();
        var left = Math.min(Math.max(originLeft + dx, slots[0] - 14), slots[slots.length - 1] + 14);
        var mid = left + thumb.offsetWidth / 2;
        var list = thumbs();
        var i = list.indexOf(thumb);
        var next = list[i + 1];
        var prev = list[i - 1];
        if (next && mid > next.offsetLeft + next.offsetWidth / 2) {
          flip(function () { strip.insertBefore(next, thumb); }, thumb);
        } else if (prev && mid < prev.offsetLeft + prev.offsetWidth / 2) {
          flip(function () { strip.insertBefore(prev, thumb.nextSibling); }, thumb);
        }
        thumb.style.transform = 'translateX(' + (left - thumb.offsetLeft) + 'px)';
      }

      function end(ev) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (!dragging) return;
        if (ev && ev.type === 'pointerup') {
          // Swallow the click that follows the drop, but only that one.
          suppressClick = true;
          setTimeout(function () { suppressClick = false; }, 0);
        }
        var from = thumb.style.transform;
        thumb.style.transform = '';
        thumb.classList.remove('is-dragging');
        if (!reducedMotion && from) {
          thumb.animate([{ transform: from }, { transform: 'translateX(0)' }], { duration: 320, easing: EASE });
        }
        if (ids().join() !== startOrder) committed(thumb);
      }

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });

    /* Export */

    var exportBtn = $('[data-export]', desk);
    var exportLabel = $('[data-export-label]', desk);
    var exportIcon = $('use', exportBtn);
    var exporting = false;

    function exported() {
      var name = (docName.textContent || 'Report').trim();
      var count = thumbs().length;
      exportBtn.classList.add('is-done');
      exportLabel.textContent = 'Exported';
      exportIcon.setAttribute('href', '#i-check');
      toast(name + '.pdf · ' + count + ' A4 pages (a demo, so no download)');
      setTimeout(function () {
        exportBtn.classList.remove('is-done');
        exportLabel.textContent = 'Export PDF';
        exportIcon.setAttribute('href', '#i-download');
        exporting = false;
      }, 2400);
    }

    exportBtn.addEventListener('click', function () {
      if (exporting) return;
      exporting = true;
      var focused = document.activeElement;
      if (focused && a4.contains(focused)) focused.blur();

      if (reducedMotion || !a4.animate) {
        exported();
        return;
      }

      // Fly a copy of the current page into the button.
      var from = a4.getBoundingClientRect();
      var to = exportBtn.getBoundingClientRect();
      var fly = a4.cloneNode(true);
      fly.removeAttribute('data-a4');
      fly.classList.add('fly');
      fly.setAttribute('aria-hidden', 'true');
      $$('[contenteditable]', fly).forEach(function (el) { el.removeAttribute('contenteditable'); });
      $$('button, input', fly).forEach(function (el) { el.remove(); });
      var vars = getComputedStyle(desk);
      ['--pg', '--c1', '--c2', '--c3', '--ink'].forEach(function (k) { fly.style.setProperty(k, vars.getPropertyValue(k)); });
      fly.style.left = from.left + 'px';
      fly.style.top = from.top + 'px';
      fly.style.width = from.width + 'px';
      fly.style.height = from.height + 'px';
      document.body.appendChild(fly);

      var s = Math.max(0.06, (to.height * 0.9) / from.height);
      var dx = to.left + to.width / 2 - from.left - (from.width * s) / 2;
      var dy = to.top + to.height / 2 - from.top - (from.height * s) / 2;
      var lift = Math.min(dy * 0.15, 0) - 40;
      var anim = fly.animate([
        { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + dx * 0.18 + 'px, ' + lift + 'px) scale(0.6) rotate(-5deg)', opacity: 1, offset: 0.38 },
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ') rotate(0deg)', opacity: 0.15 },
      ], { duration: 950, easing: 'cubic-bezier(0.5, 0, 0.2, 1)' });
      anim.onfinish = function () {
        fly.remove();
        exportBtn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 420, easing: EASE });
        exported();
      };
    });

    syncStrip();
    syncTools();
  }

  /* ── Annotated screenshot ───────────────────────────────────────────── */

  function initAnnotations() {
    var root = $('[data-anno]');
    if (!root) return;
    var spots = $$('[data-spot]', root);
    var items = $$('[data-item]', root);

    function set(n) {
      spots.forEach(function (s) { s.classList.toggle('is-active', s.getAttribute('data-spot') === n); });
      items.forEach(function (i) { i.classList.toggle('is-active', i.getAttribute('data-item') === n); });
    }

    spots.forEach(function (s) {
      var n = s.getAttribute('data-spot');
      ['click', 'mouseenter', 'focus'].forEach(function (type) { s.addEventListener(type, function () { set(n); }); });
    });
    items.forEach(function (i) {
      var n = i.getAttribute('data-item');
      ['click', 'mouseenter'].forEach(function (type) { i.addEventListener(type, function () { set(n); }); });
    });
    set('1');
  }

  /* ── ERD relationship lines ─────────────────────────────────────────── */

  function initErd() {
    var erd = $('[data-erd]');
    if (!erd) return;
    var svg = $('.erd__svg', erd);
    var LINKS = [['template', 'part'], ['template', 'doc'], ['user', 'doc']];

    function box(name) {
      var el = $('[data-entity="' + name + '"]', erd);
      return { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    }

    function text(x, y, t) {
      return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">' + t + '</text>';
    }

    function draw() {
      if (getComputedStyle(svg).display === 'none') return;
      svg.setAttribute('viewBox', '0 0 ' + erd.clientWidth + ' ' + erd.clientHeight);
      var out = '';
      LINKS.forEach(function (link) {
        var a = box(link[0]);
        var b = box(link[1]);
        var d;
        if (Math.abs(a.t - b.t) < 4) {
          // Side by side: straight across the gap, level with the first field.
          var y = a.t + 58;
          d = 'M' + (a.l + a.w) + ' ' + y + 'H' + b.l;
          out += text(a.l + a.w + 6, y - 7, '1') + text(b.l - 14, y - 7, 'N');
        } else {
          // Diagonal: out of the bottom of one, into the top of the other.
          var x1 = a.l + a.w * 0.72;
          var y1 = a.t + a.h;
          var x2 = b.l + b.w * 0.28;
          var y2 = b.t;
          var k = (y2 - y1) * 0.6;
          d = 'M' + x1 + ' ' + y1 + 'C' + x1 + ' ' + (y1 + k) + ' ' + x2 + ' ' + (y2 - k) + ' ' + x2 + ' ' + y2;
          out += text(x1 + 6, y1 + 15, '1') + text(x2 + 6, y2 - 7, 'N');
        }
        out += '<path d="' + d + '"/>';
      });
      svg.innerHTML = out;
    }

    draw();
    if ('ResizeObserver' in window) new ResizeObserver(draw).observe(erd);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }

  /* ── Screens rail ───────────────────────────────────────────────────── */

  function initRail() {
    var rail = $('[data-rp-rail]');
    var prev = $('[data-rail-prev]');
    var next = $('[data-rail-next]');
    if (!rail || !prev || !next) return;

    function step() {
      var first = rail.firstElementChild;
      var gap = parseFloat(getComputedStyle(rail).columnGap) || 18;
      return first ? first.getBoundingClientRect().width + gap : rail.clientWidth * 0.8;
    }

    function sync() {
      prev.disabled = rail.scrollLeft <= 2;
      next.disabled = rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
    }

    function go(dir) {
      rail.scrollBy({ left: dir * step(), behavior: reducedMotion ? 'auto' : 'smooth' });
    }

    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    rail.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  }
})();
