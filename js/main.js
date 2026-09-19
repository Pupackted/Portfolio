/*
 * Shared behaviour for every page.
 *
 * Everything here is progressive: the pages are complete, readable documents
 * without it, and each feature is attached only to the elements that opt in
 * with a data attribute. Nothing measures layout in a scroll handler without a
 * requestAnimationFrame in between.
 */
(function () {
  'use strict';

  var SITE = window.SITE || {};
  var root = document.documentElement;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var icon = SITE.icon || function () { return ''; };

  /* ── Modifier key label ──────────────────────────────────────────────── */

  if (!isMac) $$('[data-mod-key]').forEach(function (el) { el.textContent = 'Ctrl'; });

  /* ── Scroll-driven bits, batched into one frame ──────────────────────── */

  var nav = $('[data-nav]');
  var progress = $('[data-progress]');
  var parallaxEls = [];
  var sceneEls = [];
  var lastY = window.scrollY;
  var ticking = false;
  var menuOpen = false;

  function onScrollFrame() {
    ticking = false;
    var y = window.scrollY;
    var vh = window.innerHeight;
    var max = Math.max(1, document.documentElement.scrollHeight - vh);

    if (progress) progress.style.setProperty('--progress', (y / max).toFixed(4));

    if (nav) {
      nav.classList.toggle('is-scrolled', y > 24);
      // Hide on a deliberate downward scroll, return the moment the reader
      // scrolls back up. Never while the mobile menu is open.
      var goingDown = y > lastY + 4;
      var goingUp = y < lastY - 4;
      if (!menuOpen) {
        if (goingDown && y > 480) nav.classList.add('is-hidden');
        else if (goingUp || y < 480) nav.classList.remove('is-hidden');
      }
    }
    lastY = y;

    if (!reducedMotion) {
      for (var i = 0; i < parallaxEls.length; i++) {
        var p = parallaxEls[i];
        var r = p.el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) continue;
        var offset = (r.top + r.height / 2 - vh / 2) * -p.speed;
        p.el.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0)';
      }
    }

    for (var j = 0; j < sceneEls.length; j++) {
      var s = sceneEls[j];
      var rect = s.getBoundingClientRect();
      // 0 when the scene's top meets the viewport top, 1 when its bottom
      // meets the viewport bottom — the natural range of a sticky scene.
      var total = rect.height - vh;
      var pr = total > 0 ? clamp(-rect.top / total, 0, 1) : clamp(1 - rect.top / vh, 0, 1);
      s.style.setProperty('--p', pr.toFixed(4));
      s.dispatchEvent(new CustomEvent('scene', { detail: pr }));
    }
  }

  function requestScrollFrame() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScrollFrame);
    }
  }

  window.addEventListener('scroll', requestScrollFrame, { passive: true });
  window.addEventListener('resize', requestScrollFrame, { passive: true });

  function collectScrollEls() {
    parallaxEls = $$('[data-parallax]').map(function (el) {
      return { el: el, speed: parseFloat(el.getAttribute('data-parallax')) || 0.1 };
    });
    sceneEls = $$('[data-scene]');
    requestScrollFrame();
  }

  /* ── Nav: gliding indicator, active section, mobile sheet ─────────────── */

  function initNav() {
    if (!nav) return;
    var linksWrap = $('.nav__links', nav);
    var indicator = $('.nav__indicator', nav);
    var links = $$('.nav__link', nav);

    function moveIndicator(link) {
      if (!indicator) return;
      if (!link) {
        indicator.style.opacity = '0';
        return;
      }
      indicator.style.opacity = '1';
      indicator.style.width = link.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + link.offsetLeft + 'px)';
    }

    function activeLink() {
      return links.filter(function (l) { return l.getAttribute('aria-current') === 'page' || l.classList.contains('is-active'); })[0];
    }

    links.forEach(function (link) {
      link.addEventListener('mouseenter', function () { moveIndicator(link); });
      link.addEventListener('focus', function () { moveIndicator(link); });
    });
    if (linksWrap) linksWrap.addEventListener('mouseleave', function () { moveIndicator(activeLink()); });
    function placeInstantly() {
      if (indicator) indicator.style.transition = 'none';
      moveIndicator(activeLink());
      requestAnimationFrame(function () { if (indicator) indicator.style.transition = ''; });
    }
    // Measured again once fonts and layout have settled: a link measured
    // before the web font arrives (or while the page is still hidden) is 0 wide.
    requestAnimationFrame(placeInstantly);
    window.addEventListener('load', placeInstantly);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeInstantly);
    if ('ResizeObserver' in window && linksWrap) {
      new ResizeObserver(function () {
        if (!linksWrap.matches(':hover')) placeInstantly();
      }).observe(linksWrap);
    }

    // On the home page the current link follows the section being read.
    var sections = links
      .map(function (l) {
        var href = l.getAttribute('href') || '';
        return href.charAt(0) === '#' ? { link: l, el: document.getElementById(href.slice(1)) } : null;
      })
      .filter(function (x) { return x && x.el; });

    if (sections.length && 'IntersectionObserver' in window) {
      var visible = new Map();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { visible.set(e.target, e.isIntersecting ? e.intersectionRatio : 0); });
        var best = null;
        var bestRatio = 0;
        sections.forEach(function (s) {
          var ratio = visible.get(s.el) || 0;
          if (ratio > bestRatio) { best = s; bestRatio = ratio; }
        });
        links.forEach(function (l) { l.classList.remove('is-active'); });
        if (best) best.link.classList.add('is-active');
        if (!linksWrap.matches(':hover')) moveIndicator(activeLink());
      }, { rootMargin: '-35% 0px -45% 0px', threshold: [0, 0.01, 0.25, 0.5, 1] });
      sections.forEach(function (s) { io.observe(s.el); });
    }

    // Mobile sheet.
    var toggle = $('[data-menu-toggle]');
    var sheet = $('[data-menu-sheet]');
    if (!toggle || !sheet) return;

    function setMenu(open) {
      menuOpen = open;
      sheet.classList.toggle('is-open', open);
      nav.classList.toggle('is-open', open);
      nav.classList.remove('is-hidden');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.body.style.overflow = open ? 'hidden' : '';
    }

    toggle.addEventListener('click', function () { setMenu(!menuOpen); });
    $$('a', sheet).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 820 && menuOpen) setMenu(false); });
  }

  /* ── Split headlines into words ──────────────────────────────────────── */

  function splitWords(el) {
    if (el.getAttribute('data-split-done')) return;
    el.setAttribute('data-split-done', '1');
    var index = 0;

    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var parts = child.textContent.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          parts.forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
              return;
            }
            var outer = document.createElement('span');
            outer.className = 'w';
            var inner = document.createElement('span');
            inner.textContent = part;
            inner.style.setProperty('--wi', index++);
            outer.appendChild(inner);
            frag.appendChild(outer);
          });
          child.parentNode.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR' && !child.hasAttribute('data-split-skip')) {
          walk(child);
        }
      });
    })(el);

    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  }

  /* ── Reveal on scroll ─────────────────────────────────────────────────── */

  var revealIO = null;

  function initReveal(scope) {
    var ctx = scope || document;
    $$('[data-split]', ctx).forEach(splitWords);
    $$('[data-stagger]', ctx).forEach(function (el) {
      Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--si', i); });
    });

    var targets = $$('[data-reveal], [data-split], [data-stagger]', ctx).filter(function (el) {
      return !el.classList.contains('is-in');
    });

    if (reducedMotion || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          entry.target.dispatchEvent(new CustomEvent('reveal'));
          revealIO.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    }
    targets.forEach(function (el) { revealIO.observe(el); });
  }

  window.SITE.reveal = initReveal;

  /* ── Animated counters ────────────────────────────────────────────────── */

  function formatNumber(n, decimals) {
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function initCounters() {
    var counters = $$('[data-count]');
    if (!counters.length) return;

    function run(el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
      var prefix = el.getAttribute('data-prefix') || '';
      var suffix = el.getAttribute('data-suffix') || '';
      var duration = parseInt(el.getAttribute('data-duration') || '1800', 10);
      var start = null;

      if (reducedMotion) {
        el.textContent = prefix + formatNumber(target, decimals) + suffix;
        return;
      }

      function frame(t) {
        if (start === null) start = t;
        var k = clamp((t - start) / duration, 0, 1);
        var eased = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
        el.textContent = prefix + formatNumber(target * eased, decimals) + suffix;
        if (k < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { io.observe(el); });
  }

  /* ── Pointer effects: spotlight, magnetic, tilt ───────────────────────── */

  function initPointerFx() {
    if (!finePointer) return;

    $$('[data-spotlight]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }, { passive: true });
    });

    if (reducedMotion) return;

    $$('[data-magnetic]').forEach(function (el) {
      var strength = parseFloat(el.getAttribute('data-magnetic')) || 0.25;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * strength;
        var y = (e.clientY - r.top - r.height / 2) * strength;
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      });
      el.addEventListener('pointerleave', function () {
        el.style.transition = 'transform 0.7s cubic-bezier(0.34, 1.4, 0.64, 1)';
        el.style.transform = '';
        setTimeout(function () { el.style.transition = ''; }, 700);
      });
    });

    $$('[data-tilt]').forEach(function (el) {
      var max = parseFloat(el.getAttribute('data-tilt')) || 6;
      var raf = 0;
      el.addEventListener('pointermove', function (e) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          var r = el.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          el.style.transform = 'perspective(1100px) rotateX(' + (-py * max).toFixed(2) + 'deg) rotateY(' + (px * max).toFixed(2) + 'deg)';
          el.style.setProperty('--gx', (px * 100 + 50).toFixed(1) + '%');
          el.style.setProperty('--gy', (py * 100 + 50).toFixed(1) + '%');
        });
      });
      el.addEventListener('pointerleave', function () {
        cancelAnimationFrame(raf);
        el.style.transition = 'transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = '';
        setTimeout(function () { el.style.transition = ''; }, 900);
      });
    });
  }

  /* ── Toast ────────────────────────────────────────────────────────────── */

  var toastEl = null;
  var toastTimer = 0;

  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast glass';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = icon('check') + '<span></span>';
    toastEl.lastChild.textContent = message;
    requestAnimationFrame(function () { toastEl.classList.add('is-visible'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 2200);
  }

  window.SITE.toast = toast;

  /* ── Copy to clipboard ────────────────────────────────────────────────── */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); resolve(); } catch (err) { reject(err); }
      document.body.removeChild(ta);
    });
  }

  function initCopy() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy]');
      if (!btn) return;
      var text = btn.getAttribute('data-copy');
      copyText(text).then(function () {
        btn.classList.add('is-copied');
        toast('Email copied to clipboard');
        setTimeout(function () { btn.classList.remove('is-copied'); }, 1800);
      }, function () {
        window.location.href = 'mailto:' + text;
      });
    });
  }

  /* ── Local time in Jakarta ────────────────────────────────────────────── */

  function initClock() {
    var clocks = $$('[data-clock]');
    if (!clocks.length) return;
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });
    } catch (err) {
      return;
    }
    function tick() {
      var t = fmt.format(new Date()) + ' WIB';
      clocks.forEach(function (c) { c.textContent = t; });
    }
    tick();
    setInterval(tick, 15000);
  }

  /* ── Rotating word ────────────────────────────────────────────────────── */

  function initRotators() {
    $$('[data-rotate]').forEach(function (el) {
      var words;
      try { words = JSON.parse(el.getAttribute('data-rotate')); } catch (err) { return; }
      if (!words || words.length < 2) return;
      var i = 0;
      var interval = parseInt(el.getAttribute('data-interval') || '2400', 10);

      el.classList.add('rotator');
      el.innerHTML = '';
      var spans = words.map(function (w, idx) {
        var s = document.createElement('span');
        s.className = 'rotator__word' + (idx === 0 ? ' is-current' : '');
        s.textContent = w;
        if (idx !== 0) s.setAttribute('aria-hidden', 'true');
        el.appendChild(s);
        return s;
      });

      if (reducedMotion) return;

      setInterval(function () {
        if (document.hidden) return;
        var prev = spans[i];
        i = (i + 1) % spans.length;
        var next = spans[i];
        prev.classList.remove('is-current');
        prev.classList.add('is-leaving');
        prev.setAttribute('aria-hidden', 'true');
        next.classList.remove('is-leaving');
        next.classList.add('is-current');
        next.removeAttribute('aria-hidden');
        setTimeout(function () { prev.classList.remove('is-leaving'); }, 900);
      }, interval);
    });
  }

  /* ── Lightbox with a FLIP zoom from the thumbnail ─────────────────────── */

  function initLightbox() {
    var thumbs = $$('img[data-lightbox]');
    if (!thumbs.length) return;

    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Image viewer');
    box.innerHTML =
      '<img class="lightbox__img" alt="">' +
      '<p class="lightbox__caption"></p>' +
      '<button class="icon-btn lightbox__close" type="button" aria-label="Close">' + icon('x') + '</button>' +
      '<button class="icon-btn lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous image">' + icon('chevron-left') + '</button>' +
      '<button class="icon-btn lightbox__nav lightbox__nav--next" type="button" aria-label="Next image">' + icon('chevron-right') + '</button>';
    document.body.appendChild(box);

    var img = $('.lightbox__img', box);
    var caption = $('.lightbox__caption', box);
    var group = [];
    var index = 0;
    var origin = null;
    var lastFocus = null;

    function flipFrom(el) {
      var from = el.getBoundingClientRect();
      var to = img.getBoundingClientRect();
      if (!to.width || reducedMotion) return;
      var sx = from.width / to.width;
      var sy = from.height / to.height;
      img.style.transition = 'none';
      img.style.transform = 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(' + sx + ',' + sy + ')';
      img.getBoundingClientRect();
      img.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      img.style.transform = '';
    }

    function show(i, animateFrom) {
      index = (i + group.length) % group.length;
      var t = group[index];
      origin = t;
      img.src = t.currentSrc || t.src;
      img.alt = t.alt || '';
      caption.textContent = t.getAttribute('data-caption') || t.alt || '';
      var multi = group.length > 1;
      $$('.lightbox__nav', box).forEach(function (b) { b.hidden = !multi; });
      if (animateFrom) {
        var go = function () { requestAnimationFrame(function () { flipFrom(animateFrom); }); };
        if (img.complete && img.naturalWidth) go();
        else img.onload = function () { img.onload = null; go(); };
      }
    }

    function open(t) {
      var name = t.getAttribute('data-lightbox');
      group = thumbs.filter(function (x) { return x.getAttribute('data-lightbox') === name; });
      lastFocus = document.activeElement;
      box.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      show(group.indexOf(t), t);
      $('.lightbox__close', box).focus({ preventScroll: true });
    }

    function close() {
      if (!box.classList.contains('is-open')) return;
      var target = origin;
      if (target && !reducedMotion) {
        var from = img.getBoundingClientRect();
        var to = target.getBoundingClientRect();
        img.style.transition = 'transform 0.45s cubic-bezier(0.65, 0, 0.35, 1)';
        img.style.transform = 'translate(' + (to.left - from.left) + 'px,' + (to.top - from.top) + 'px) scale(' + to.width / from.width + ',' + to.height / from.height + ')';
      }
      box.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(function () {
        img.style.transition = 'none';
        img.style.transform = '';
      }, 460);
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    }

    thumbs.forEach(function (t) {
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
      t.addEventListener('click', function () { open(t); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t); }
      });
    });

    box.addEventListener('click', function (e) {
      if (e.target === box || e.target === img) close();
    });
    $('.lightbox__close', box).addEventListener('click', close);
    $('.lightbox__nav--prev', box).addEventListener('click', function (e) { e.stopPropagation(); show(index - 1); });
    $('.lightbox__nav--next', box).addEventListener('click', function (e) { e.stopPropagation(); show(index + 1); });

    document.addEventListener('keydown', function (e) {
      if (!box.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft' && group.length > 1) show(index - 1);
      if (e.key === 'ArrowRight' && group.length > 1) show(index + 1);
    });

    var touchX = null;
    box.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (touchX === null || group.length < 2) return;
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      touchX = null;
    }, { passive: true });
  }

  /* ── Command palette ──────────────────────────────────────────────────── */

  function initCommandPalette() {
    var projects = SITE.PROJECTS || [];
    var onHome = /(^|\/)(index\.html)?$/.test(location.pathname);
    var home = function (hash) { return onHome ? hash : 'index.html' + hash; };

    var items = [
      { group: 'Navigate', label: 'Home', hint: 'Start', icon: 'home', href: onHome ? '#top' : 'index.html' },
      { group: 'Navigate', label: 'Selected work', icon: 'grid', href: home('#work') },
      { group: 'Navigate', label: 'Experience', icon: 'briefcase', href: home('#experience') },
      { group: 'Navigate', label: 'About me', icon: 'user', href: 'profile.html' },
      { group: 'Navigate', label: 'Contact', icon: 'mail', href: '#contact' },
    ];

    projects.forEach(function (p) {
      items.push({ group: 'Projects', label: p.name, hint: p.kind, img: p.icon, icon: 'box', href: p.href, keywords: p.line });
    });

    items.push(
      { group: 'Actions', label: 'Copy email address', hint: SITE.EMAIL, icon: 'copy', run: function () { copyText(SITE.EMAIL).then(function () { toast('Email copied to clipboard'); }); } },
      { group: 'Actions', label: 'Open résumé (PDF)', icon: 'file', href: SITE.CV, external: true },
      { group: 'Actions', label: 'Send an email', icon: 'mail', href: 'mailto:' + SITE.EMAIL },
      { group: 'Actions', label: 'LinkedIn', hint: 'Profile', icon: 'linkedin', href: SITE.LINKEDIN, external: true },
      { group: 'Actions', label: 'GitHub', hint: '@Pupackted', icon: 'github', href: SITE.GITHUB, external: true },
      { group: 'Actions', label: 'RideCheck on the App Store', icon: 'apple', href: 'https://apps.apple.com/id/app/ridecheck/id6748782930', external: true },
      { group: 'Actions', label: 'RideCheck on Google Play', icon: 'play-store', href: 'https://play.google.com/store/apps/details?id=com.ridecheck.android', external: true },
      { group: 'Actions', label: 'ridecheck.id', hint: 'Website', icon: 'globe', href: 'https://www.ridecheck.id/', external: true }
    );

    var el = null;
    var input = null;
    var list = null;
    var filtered = [];
    var active = 0;
    var lastFocus = null;

    function build() {
      el = document.createElement('div');
      el.className = 'cmdk';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', 'Command menu');
      el.innerHTML =
        '<div class="cmdk__panel">' +
          '<div class="cmdk__search">' + icon('search') +
            '<input class="cmdk__input" type="text" placeholder="Search pages, projects, actions…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list">' +
            '<kbd>esc</kbd>' +
          '</div>' +
          '<div class="cmdk__list" id="cmdk-list" role="listbox"></div>' +
          '<div class="cmdk__foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span class="hide-sm"><kbd>' + (isMac ? '⌘' : 'Ctrl') + '</kbd><kbd>K</kbd> toggle</span></div>' +
        '</div>';
      document.body.appendChild(el);
      input = $('.cmdk__input', el);
      list = $('.cmdk__list', el);

      input.addEventListener('input', render);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); runItem(filtered[active]); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') { e.preventDefault(); setActive(active + (e.shiftKey ? -1 : 1)); }
      });
      el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    }

    function score(item, q) {
      if (!q) return 1;
      var hay = (item.label + ' ' + (item.hint || '') + ' ' + (item.keywords || '') + ' ' + item.group).toLowerCase();
      var idx = hay.indexOf(q);
      if (idx === 0) return 100;
      if (idx > 0) return 60 - Math.min(idx, 50);
      // Subsequence match on the label as a fallback: "rdck" still finds
      // RideCheck, without every long description matching everything.
      var label = item.label.toLowerCase();
      var pos = 0;
      for (var i = 0; i < q.length; i++) {
        pos = label.indexOf(q.charAt(i), pos);
        if (pos === -1) return 0;
        pos++;
      }
      return 5;
    }

    function render() {
      var q = input.value.trim().toLowerCase();
      filtered = items
        .map(function (it, i) { return { it: it, s: score(it, q), i: i }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return q ? b.s - a.s || a.i - b.i : a.i - b.i; })
        .map(function (x) { return x.it; });

      if (!filtered.length) {
        list.innerHTML = '<p class="cmdk__empty">No results for “' + input.value.replace(/[<>&]/g, '') + '”</p>';
        return;
      }

      var html = '';
      var lastGroup = null;
      filtered.forEach(function (it, i) {
        if (!q && it.group !== lastGroup) {
          html += '<p class="cmdk__group" role="presentation">' + it.group + '</p>';
          lastGroup = it.group;
        }
        var ico = it.img ? '<img src="' + it.img + '" alt="">' : icon(it.icon);
        html += '<button class="cmdk__item" type="button" role="option" id="cmdk-' + i + '" data-i="' + i + '">' +
          '<span class="cmdk__icon">' + ico + '</span>' +
          '<span class="cmdk__label">' + it.label + '</span>' +
          (it.hint ? '<span class="cmdk__hint">' + it.hint + '</span>' : '') +
          (it.external ? icon('arrow-up-right') : '') +
        '</button>';
      });
      list.innerHTML = html;
      $$('.cmdk__item', list).forEach(function (b) {
        b.addEventListener('mousemove', function () { setActive(parseInt(b.getAttribute('data-i'), 10), true); });
        b.addEventListener('click', function () { runItem(filtered[parseInt(b.getAttribute('data-i'), 10)]); });
      });
      setActive(0);
    }

    function setActive(i, fromMouse) {
      if (!filtered.length) return;
      active = (i + filtered.length) % filtered.length;
      $$('.cmdk__item', list).forEach(function (b) {
        var on = parseInt(b.getAttribute('data-i'), 10) === active;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
        if (on && !fromMouse) b.scrollIntoView({ block: 'nearest' });
      });
      input.setAttribute('aria-activedescendant', 'cmdk-' + active);
    }

    function runItem(it) {
      if (!it) return;
      close();
      if (it.run) return it.run();
      if (it.external) return window.open(it.href, '_blank', 'noopener');
      if (it.href.charAt(0) === '#') {
        var target = it.href === '#top' ? document.body : document.getElementById(it.href.slice(1));
        if (target) target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        if (it.href !== '#top') history.replaceState(null, '', it.href);
        return;
      }
      window.location.href = it.href;
    }

    function open() {
      if (!el) build();
      lastFocus = document.activeElement;
      input.value = '';
      render();
      el.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      setTimeout(function () { input.focus(); }, 20);
    }

    function close() {
      if (!el || !el.classList.contains('is-open')) return;
      el.classList.remove('is-open');
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (el && el.classList.contains('is-open')) close();
        else open();
      } else if (e.key === '/' && !typing && !(el && el.classList.contains('is-open'))) {
        e.preventDefault();
        open();
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-cmdk-open]')) open();
    });
  }

  /* ── Tabs with a sliding indicator (used on a few case studies) ───────── */

  function initSegmented() {
    $$('[data-segmented]').forEach(function (group) {
      var thumb = document.createElement('span');
      thumb.className = 'segmented__thumb';
      group.appendChild(thumb);
      var buttons = $$('button', group);
      function place(btn, instant) {
        if (instant) thumb.style.transition = 'none';
        thumb.style.width = btn.offsetWidth + 'px';
        thumb.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
        if (instant) requestAnimationFrame(function () { thumb.style.transition = ''; });
      }
      function select(btn) {
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        place(btn);
      }
      buttons.forEach(function (b) { b.addEventListener('click', function () { select(b); }); });
      var initial = buttons.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })[0] || buttons[0];
      requestAnimationFrame(function () { place(initial, true); });
      window.addEventListener('resize', function () {
        var cur = buttons.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })[0];
        if (cur) place(cur, true);
      });
    });
  }

  /* ── Accordions (experience list) ─────────────────────────────────────── */

  function initAccordions() {
    $$('[data-accordion]').forEach(function (item) {
      var head = $('[data-accordion-head]', item);
      if (!head) return;
      head.addEventListener('click', function () {
        var open = !item.classList.contains('is-open');
        item.classList.toggle('is-open', open);
        head.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────────────── */

  function boot() {
    initNav();
    initReveal();
    initCounters();
    initPointerFx();
    initCopy();
    initClock();
    initRotators();
    initLightbox();
    initCommandPalette();
    initSegmented();
    initAccordions();
    collectScrollEls();
    root.classList.add('is-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
