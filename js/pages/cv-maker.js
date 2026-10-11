/*
 * CV Maker: a working miniature of the builder.
 *
 * The renderer (src/lib/render-resume.ts), the inline-markup sanitiser
 * (src/lib/inline.ts) and the paginator (ResumePreview.tsx) are ported from
 * the app with as little change as plain JavaScript allows: the CV is a flat
 * list of blocks, each block is measured off-screen at the printed text width,
 * and the blocks are dealt onto A4 sheets. Undo coalescing follows the app's
 * store. Saving is only mimicked — nothing leaves the page. Alex Morgan is
 * invented.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-cv-demo]');
  var heroSheet = document.querySelector('[data-cv-hero]');
  if (!root && !heroSheet) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var icon = (window.SITE && window.SITE.icon) || function () { return ''; };

  /* ── The document ───────────────────────────────────────────────────── */

  var FONTS = {
    arial: { label: 'Arial', family: 'Arimo', value: '"Arimo", Arial, Helvetica, sans-serif' },
    calibri: { label: 'Calibri', family: 'Carlito', value: '"Carlito", Calibri, Candara, sans-serif' },
    georgia: { label: 'Georgia', family: 'Gelasio', value: '"Gelasio", Georgia, serif' }
  };

  var DEFAULT_DESIGN = {
    fontFamily: FONTS.arial.value,
    fontSize: 10.5,
    lineHeight: 1.35,
    marginX: 16,
    marginY: 14,
    sectionGap: 10,
    entryGap: 7,
    accent: '#000000',
    showDividers: true,
    uppercaseHeadings: true
  };

  // The fastest lever for fitting a page (src/lib/types.ts).
  var DENSITY_PRESETS = {
    compact: { fontSize: 9.5, lineHeight: 1.2, sectionGap: 7, entryGap: 5, marginY: 11, marginX: 13 },
    normal: { fontSize: 10.5, lineHeight: 1.35, sectionGap: 10, entryGap: 7, marginY: 14, marginX: 16 },
    roomy: { fontSize: 11.5, lineHeight: 1.5, sectionGap: 14, entryGap: 10, marginY: 18, marginX: 20 }
  };

  var ACCENTS = [
    { label: 'Black', value: '#000000' },
    { label: 'Ink', value: '#1f2937' },
    { label: 'Navy', value: '#1e3a5f' },
    { label: 'Burgundy', value: '#6b2131' },
    { label: 'Forest', value: '#14532d' }
  ];

  var b = function (text, level) { return { level: level || 0, text: text }; };

  var DOC = {
    title: 'Alex Morgan — Product',
    header: {
      fullName: 'Alex Morgan',
      headline: 'Product Engineer — mobile and web',
      phone: '',
      email: 'alex.morgan@example.com',
      linkedin: '',
      portfolio: 'https://example.com/alex-morgan',
      linkedinLabel: '',
      portfolioLabel: 'Portfolio',
      location: 'Jakarta, Indonesia',
      summary: 'Product engineer with six years of shipping mobile and web apps, mostly in small teams where design and code sit at the same desk. I like turning messy requirements into simple flows, checking whether they worked, and writing things down so the next person doesn’t have to guess.'
    },
    design: Object.assign({}, DEFAULT_DESIGN),
    sections: [
      { name: 'Working Experience', layout: 'detailed', entries: [
        { title: 'Tandem Freight', location: 'Jakarta', subtitle: 'Senior Product Engineer', date: 'Mar 2023 – Present', text: '', bullets: [
          b('Led the rebuild of the driver app in React Native, cutting crash reports by a third over two releases.'),
          b('Introduced a shared design system across the driver and dispatcher apps.', 1),
          b('Set up release trains and staged rollouts on both app stores.', 1),
          b('Designed and shipped live delivery tracking for customers, now the most visited page on the site.'),
          b('Cut the app’s cold start from four seconds to under two by deferring map and analytics setup.'),
          b('Mentored three junior engineers through their first production launches.')
        ] },
        { title: 'Pagi Coffee Co.', location: 'Bandung', subtitle: 'Mobile Engineer', date: 'Jan 2021 – Feb 2023', text: '', bullets: [
          b('Built the loyalty app’s ordering flow in SwiftUI and Kotlin, from first sketch to both app stores.'),
          b('Rewrote checkout to remember a customer’s usual order, so a repeat order takes two taps.'),
          b('Added offline ordering for patchy mall Wi-Fi: orders wait on the phone and send when the signal returns.'),
          b('Worked with baristas on a pick-up screen for busy mornings, tested in two stores before rollout.')
        ] },
        { title: 'Sinar Studio', location: 'Jakarta', subtitle: 'Front-end Developer', date: 'Jul 2019 – Dec 2020', text: '', bullets: [
          b('Built marketing sites and small web apps for local clients with React and Next.js.'),
          b('Turned the studio’s Figma components into a front-end kit reused on every project.')
        ] }
      ] },
      { name: 'Organisational Experience', layout: 'detailed', entries: [
        { title: 'Jakarta Mobile Meetup', location: 'Jakarta', subtitle: 'Co-organiser', date: '2021 – Present', text: '', bullets: [
          b('Run a monthly meetup for mobile developers: book the speakers, keep the talks practical, and post the recordings.')
        ] },
        { title: 'Kode Kita', location: 'Online', subtitle: 'Volunteer mentor', date: '2020 – 2022', text: '', bullets: [
          b('Mentored first-time developers through a twelve-week course on building and shipping a small web app.')
        ] }
      ] },
      { name: 'Education', layout: 'detailed', entries: [
        { title: 'University of Westmere', location: 'Bandung', subtitle: 'B.Sc. Computer Science', date: '2015 – 2019', text: 'Thesis on offline-first sync for apps used in the field.', bullets: [] }
      ] },
      { name: 'Conferences', layout: 'plain', entries: [
        { title: 'Speaker — “Shipping on Fridays”, Mobile Days Jakarta', location: '', subtitle: '', date: '2024', text: '', bullets: [] },
        { title: 'Workshop host — Design systems for small teams', location: '', subtitle: '', date: '2023', text: '', bullets: [] },
        { title: 'Panel — Small teams, big apps, Bandung Dev Day', location: '', subtitle: '', date: '2022', text: '', bullets: [] }
      ] },
      { name: 'Skills', layout: 'list', entries: [
        { title: 'Languages', location: '', subtitle: '', date: '', text: 'Swift, Kotlin, TypeScript, SQL', bullets: [] },
        { title: 'Frameworks', location: '', subtitle: '', date: '', text: 'SwiftUI, Jetpack Compose, React Native, Next.js', bullets: [] },
        { title: 'Tools', location: '', subtitle: '', date: '', text: 'Figma, Firebase, PostgreSQL, GitHub Actions', bullets: [] },
        { title: 'Spoken', location: '', subtitle: '', date: '', text: 'English, Bahasa Indonesia', bullets: [] }
      ] }
    ]
  };

  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  /* ── src/lib/inline.ts — the sanitiser, ported ──────────────────────── */

  var TAG_ALIASES = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u' };
  var tagPattern = function () { return /<\/?\s*([a-z][a-z0-9]*)\b[^>]*>/gi; };

  function escapeText(value) {
    return value.replace(/&(?!#?[a-zA-Z0-9]{1,8};)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Allowed marks stay; anything else becomes literal text, so List<String> survives.
  function sanitizeInline(input) {
    if (!input) return '';
    var pattern = tagPattern();
    var out = '';
    var cursor = 0;
    var open = [];
    var match;
    while ((match = pattern.exec(input)) !== null) {
      out += escapeText(input.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      var tag = TAG_ALIASES[match[1].toLowerCase()];
      if (!tag) { out += escapeText(match[0]); continue; }
      if (!/^<\s*\//.test(match[0])) { out += '<' + tag + '>'; open.push(tag); continue; }
      var index = open.lastIndexOf(tag);
      if (index === -1) continue;
      for (var i = open.length - 1; i >= index; i -= 1) out += '</' + open[i] + '>';
      var reopened = open.splice(index);
      reopened.shift();
      reopened.forEach(function (n) { out += '<' + n + '>'; });
      open.push.apply(open, reopened);
    }
    out += escapeText(input.slice(cursor));
    while (open.length > 0) out += '</' + open.pop() + '>';
    return out;
  }
  var renderInline = sanitizeInline;

  var ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
  function stripInline(input) {
    return input.replace(tagPattern(), '').replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, function (m) { return ENTITIES[m] || m; });
  }
  var isInlineEmpty = function (input) { return stripInline(input || '').trim() === ''; };

  /* ── src/lib/render-resume.ts — the renderer, ported ────────────────── */

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (value) { return String(value).replace(/[&<>"']/g, function (c) { return ESCAPES[c]; }); };

  function toHref(value, kind) {
    var v = value.trim();
    if (!v) return '';
    if (kind === 'email') return v.indexOf('mailto:') === 0 ? v : 'mailto:' + v;
    if (/^https?:\/\//i.test(v)) return v;
    return 'https://' + v.replace(/^\/+/, '');
  }
  function safeHref(value, kind) {
    var href = toHref(value, kind);
    return /^(https?:|mailto:)/i.test(href) ? href : '';
  }
  function displayUrl(value) {
    return value.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  }

  var PAGE = { widthMm: 210, heightMm: 297 };
  var PX_PER_MM = 96 / 25.4;
  var PAGE_W = PAGE.widthMm * PX_PER_MM;
  var PAGE_H = PAGE.heightMm * PX_PER_MM;

  function pageContentBox(design) {
    return {
      widthPx: (PAGE.widthMm - design.marginX * 2) * PX_PER_MM,
      heightPx: (PAGE.heightMm - design.marginY * 2) * PX_PER_MM
    };
  }

  // Flat levels into a tree; empty bullets drop, and their children are promoted.
  function buildBulletTree(bullets) {
    var roots = [];
    var stack = [];
    bullets.forEach(function (bullet) {
      var text = bullet.text.trim();
      if (isInlineEmpty(text)) return;
      var node = { text: text, children: [] };
      var level = Math.max(0, Math.min(bullet.level, stack.length));
      stack.length = level;
      if (level === 0) roots.push(node);
      else stack[level - 1].children.push(node);
      stack.push(node);
    });
    return roots;
  }

  function renderBulletList(nodes, depth) {
    depth = depth || 0;
    if (!nodes.length) return '';
    var items = nodes.map(function (n) { return '<li>' + renderInline(n.text) + renderBulletList(n.children, depth + 1) + '</li>'; }).join('');
    return '<ul class="cv-bullets cv-bullets-l' + Math.min(depth, 2) + '">' + items + '</ul>';
  }

  function isEntryEmpty(entry) {
    return !entry.title.trim() && !entry.subtitle.trim() && !entry.location.trim() && !entry.date.trim() &&
      isInlineEmpty(entry.text) && entry.bullets.every(function (x) { return isInlineEmpty(x.text); });
  }

  function renderContactLink(url, label) {
    if (!url.trim()) return '';
    var href = safeHref(url);
    var text = label.trim() || displayUrl(url);
    if (!text) return '';
    return href ? '<a class="cv-link" href="' + esc(href) + '">' + esc(text) + '</a>' : '<span>' + esc(text) + '</span>';
  }

  function renderHeaderBlock(doc) {
    var h = doc.header;
    var parts = [];
    if (h.location.trim()) parts.push('<span>' + esc(h.location.trim()) + '</span>');
    if (h.phone.trim()) parts.push('<span>' + esc(h.phone.trim()) + '</span>');
    if (h.email.trim()) {
      var href = safeHref(h.email, 'email');
      parts.push(href ? '<a href="' + esc(href) + '">' + esc(h.email.trim()) + '</a>' : '<span>' + esc(h.email.trim()) + '</span>');
    }
    [[h.linkedin, h.linkedinLabel], [h.portfolio, h.portfolioLabel]].forEach(function (pair) {
      var rendered = renderContactLink(pair[0], pair[1]);
      if (rendered) parts.push(rendered);
    });
    var contact = parts.length ? '<div class="cv-contact">' + parts.join('<span class="cv-sep">·</span>') + '</div>' : '';
    var name = h.fullName.trim();
    var headline = h.headline.trim();
    var summary = isInlineEmpty(h.summary) ? '' : h.summary.trim();
    return [
      '<header class="cv-block cv-header">',
      name ? '<h1 class="cv-name">' + esc(name) + '</h1>' : '',
      headline ? '<div class="cv-headline">' + esc(headline) + '</div>' : '',
      contact,
      summary ? '<p class="cv-summary">' + renderInline(summary) + '</p>' : '',
      '</header>'
    ].join('');
  }

  function renderTitleRow(left, date) {
    var right = date.trim() ? '<span class="cv-date">' + esc(date.trim()) + '</span>' : '';
    return '<div class="cv-row"><span class="cv-row-main">' + left + '</span>' + right + '</div>';
  }

  function renderEntryBlock(entry, layout) {
    var bullets = renderBulletList(buildBulletTree(entry.bullets));
    var hasText = !isInlineEmpty(entry.text);
    if (layout === 'list') {
      var label = entry.title.trim();
      if (!label && !hasText) return '';
      var labelHtml = label ? '<strong>' + esc(label) + ':</strong> ' : '';
      var value = hasText ? renderInline(entry.text.trim()) : '';
      return '<div class="cv-block cv-entry cv-entry-list"><p class="cv-listrow">' + labelHtml + value + '</p>' + bullets + '</div>';
    }
    var title = entry.title.trim();
    var location = entry.location.trim();
    var subtitle = entry.subtitle.trim();
    var main = (title ? '<strong>' + esc(title) + '</strong>' : '') +
      (location ? (title ? '<span class="cv-dash"> — </span>' : '') + '<span class="cv-location">' + esc(location) + '</span>' : '');
    var rows = [
      main || entry.date.trim() ? renderTitleRow(main, entry.date) : '',
      subtitle ? '<div class="cv-subtitle">' + esc(subtitle) + '</div>' : '',
      hasText ? '<p class="cv-text">' + renderInline(entry.text.trim()) + '</p>' : '',
      bullets
    ];
    return '<div class="cv-block cv-entry">' + rows.join('') + '</div>';
  }

  // The document as an ordered, flat list of independently placeable blocks.
  function renderResumeBlocks(doc) {
    var blocks = [];
    var header = renderHeaderBlock(doc);
    if (/<(h1|div|p)\b/.test(header)) blocks.push({ kind: 'header', html: header, sectionIndex: -1 });
    doc.sections.forEach(function (section, sectionIndex) {
      var renderable = section.entries.filter(function (e) { return !isEntryEmpty(e); });
      if (!renderable.length) return;
      var name = section.name.trim();
      if (name) {
        blocks.push({
          kind: 'section-head',
          sectionIndex: sectionIndex,
          html: '<div class="cv-block cv-section-head"><h2 class="cv-section-title">' + esc(name) + '</h2>' + (doc.design.showDividers ? '<div class="cv-rule"></div>' : '') + '</div>'
        });
      }
      renderable.forEach(function (entry) {
        var html = renderEntryBlock(entry, section.layout);
        if (html) blocks.push({ kind: 'entry', html: html, sectionIndex: sectionIndex });
      });
    });
    return blocks;
  }

  function renderResumeBody(doc) {
    return '<div class="cv-root"><div class="cv-page">' + renderResumeBlocks(doc).map(function (x) { return x.html; }).join('') + '</div></div>';
  }

  function renderResumeCss(d, mode) {
    var pageBox = mode === 'print'
      ? '\n@page { size: A4; margin: ' + d.marginY + 'mm ' + d.marginX + 'mm; }\n.cv-root .cv-page { width: auto; min-height: 0; padding: 0; background: #fff; }'
      : '\n.cv-root .cv-page {\n  width: ' + PAGE.widthMm + 'mm;\n  min-height: ' + PAGE.heightMm + 'mm;\n  padding: ' + d.marginY + 'mm ' + d.marginX + 'mm;\n  background: #fff;\n}';
    return [
      '.cv-root {',
      '  --cv-accent: ' + d.accent + ';',
      '  --cv-size: ' + d.fontSize + 'pt;',
      '  --cv-leading: ' + d.lineHeight + ';',
      '  --cv-section-gap: ' + d.sectionGap + 'pt;',
      '  --cv-entry-gap: ' + d.entryGap + 'pt;',
      '  font-family: ' + d.fontFamily + ';',
      '  font-size: var(--cv-size);',
      '  line-height: var(--cv-leading);',
      '  color: #000;',
      '  background: #fff;',
      '  -webkit-font-smoothing: antialiased;',
      '  text-rendering: optimizeLegibility;',
      '}',
      '.cv-root, .cv-root *, .cv-root *::before, .cv-root *::after { box-sizing: border-box; }',
      '.cv-root p, .cv-root h1, .cv-root h2, .cv-root li { margin: 0; padding: 0; }',
      '.cv-root b, .cv-root strong { font-weight: 700; }',
      '.cv-root i, .cv-root em { font-style: italic; }',
      '.cv-root u { text-decoration: underline; }',
      '.cv-root a { color: inherit; text-decoration: none; }',
      '.cv-root .cv-link { text-decoration: underline; text-underline-offset: 2px; }',
      pageBox,
      '.cv-root .cv-block { margin: 0; break-inside: avoid; page-break-inside: avoid; }',
      '.cv-root .cv-page > .cv-block:first-child { margin-top: 0; }',
      '.cv-root .cv-header { display: block; text-align: center; margin-bottom: var(--cv-section-gap); }',
      '.cv-root .cv-section-head { margin-top: var(--cv-section-gap); break-after: avoid; page-break-after: avoid; }',
      '.cv-root .cv-entry + .cv-entry { margin-top: var(--cv-entry-gap); }',
      '.cv-root .cv-name { display: block; font-size: 1.7em; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; line-height: 1.15; color: var(--cv-accent); }',
      '.cv-root .cv-headline { font-size: 1.02em; margin-top: 1pt; }',
      '.cv-root .cv-contact { margin-top: 3pt; font-size: 0.95em; display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 0 4pt; line-height: 1.5; }',
      '.cv-root .cv-sep { opacity: 0.65; }',
      '.cv-root .cv-summary { margin-top: 5pt; text-align: justify; }',
      '.cv-root .cv-section-title { display: block; font-size: 1.06em; font-weight: 700; letter-spacing: 0.04em; ' + (d.uppercaseHeadings ? 'text-transform: uppercase; ' : '') + 'color: var(--cv-accent); }',
      '.cv-root .cv-rule { border-bottom: 1.4pt solid var(--cv-accent); margin: 2pt 0 4pt; }',
      '.cv-root .cv-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10pt; }',
      '.cv-root .cv-row-main { flex: 1 1 auto; min-width: 0; }',
      '.cv-root .cv-date { flex: 0 0 auto; white-space: nowrap; }',
      '.cv-root .cv-dash, .cv-root .cv-location { font-weight: 400; }',
      '.cv-root .cv-subtitle { font-style: italic; }',
      '.cv-root .cv-text { margin-top: 1pt; text-align: justify; }',
      '.cv-root .cv-listrow { margin-bottom: 1pt; }',
      '.cv-root .cv-bullets { display: block; margin: 1.5pt 0 0; padding-left: 13pt; list-style-position: outside; }',
      '.cv-root .cv-bullets li { display: list-item; margin-bottom: 1.5pt; }',
      '.cv-root .cv-bullets li:last-child { margin-bottom: 0; }',
      '.cv-root .cv-bullets-l0 { list-style-type: disc; }',
      '.cv-root .cv-bullets-l1 { list-style-type: circle; }',
      '.cv-root .cv-bullets-l2 { list-style-type: square; }'
    ].join('\n');
  }

  function resumeFileName(doc) {
    var base = (doc.header.fullName.trim() || doc.title || 'cv')
      .replace(/[^\p{L}\p{N}\s._-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 80);
    return (base || 'cv') + '.pdf';
  }

  /* ── ResumePreview.tsx — paginate, ported ───────────────────────────── */

  // Adjacent margins collapse, so the gap between two blocks is the larger
  // of the two, not their sum; a block that starts a sheet brings no top margin.
  function paginate(blocks, metrics, pageHeight) {
    var pages = [];
    var current = [];
    var used = 0;
    var gapBefore = function (index) {
      return current.length === 0 ? 0 : Math.max(metrics[current[current.length - 1]].marginBottom, metrics[index].marginTop);
    };
    for (var i = 0; i < blocks.length; i += 1) {
      var need = gapBefore(i) + metrics[i].height;
      // Never leave a section heading stranded as the last thing on a page.
      if (blocks[i].kind === 'section-head' && i + 1 < blocks.length) {
        var withFirstEntry = need + Math.max(metrics[i].marginBottom, metrics[i + 1].marginTop) + metrics[i + 1].height;
        if (current.length > 0 && used + withFirstEntry > pageHeight + 0.5) {
          pages.push(current);
          current = [];
          used = 0;
          need = metrics[i].height;
        }
      }
      if (current.length > 0 && used + need > pageHeight + 0.5) {
        pages.push(current);
        current = [];
        used = metrics[i].height;
      } else {
        used += need;
      }
      current.push(i);
    }
    if (current.length > 0) pages.push(current);
    return pages.length > 0 ? pages : [[]];
  }

  /* ── A preview: scoped styles, a measuring column, and its pages ────── */

  // Two CVs live on this page (hero and demo) with different designs, so each
  // gets its own scope on top of .cv-root.
  function Preview(host, scope) {
    var style = document.createElement('style');
    document.head.appendChild(style);
    var measure = document.createElement('div');
    measure.className = 'cv-root ' + scope + ' cvd-measure';
    measure.setAttribute('aria-hidden', 'true');
    var column = document.createElement('div');
    measure.appendChild(column);
    host.appendChild(measure);

    return {
      scope: scope,
      layout: function (doc) {
        var blocks = renderResumeBlocks(doc);
        style.textContent = renderResumeCss(doc.design, 'screen').replace(/\.cv-root/g, '.cv-root.' + scope);
        var content = pageContentBox(doc.design);
        measure.style.width = content.widthPx + 'px';
        column.innerHTML = blocks.map(function (x) { return x.html; }).join('');
        var nodes = Array.prototype.slice.call(column.children);
        if (nodes.length && nodes.every(function (n) { return n.getBoundingClientRect().height === 0; })) return null;
        var metrics = nodes.map(function (node) {
          var cs = getComputedStyle(node);
          return { height: node.getBoundingClientRect().height, marginTop: parseFloat(cs.marginTop) || 0, marginBottom: parseFloat(cs.marginBottom) || 0 };
        });
        return { blocks: blocks, pages: paginate(blocks, metrics, content.heightPx) };
      },
      pageHtml: function (blocks, indices) {
        return '<div class="cv-root ' + scope + '"><div class="cv-page">' + indices.map(function (i) { return blocks[i].html; }).join('') + '</div></div>';
      }
    };
  }

  function loadFont(family) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['400 10pt', '700 10pt', 'italic 400 10pt'].map(function (f) {
      return document.fonts.load(f + ' "' + family + '"').catch(function () {});
    }));
  }

  var fontKey = function (value) {
    for (var k in FONTS) if (FONTS[k].value === value) return k;
    return 'arial';
  };

  /* ── Hero: page one of the CV, at the default design ────────────────── */

  if (heroSheet) {
    var heroDoc = clone(DOC);
    var hero = Preview(heroSheet, 'cvr-hero');
    var heroPage = null;
    var drawHero = function () {
      var result = hero.layout(heroDoc);
      if (!result || !heroSheet.clientWidth) return;
      var wrap = document.createElement('div');
      wrap.innerHTML = hero.pageHtml(result.blocks, result.pages[0]);
      var page = wrap.firstChild;
      page.style.width = PAGE_W + 'px';
      page.style.transform = 'scale(' + heroSheet.clientWidth / PAGE_W + ')';
      if (heroPage) heroPage.replaceWith(page);
      else heroSheet.insertBefore(page, heroSheet.firstChild);
      heroPage = page;
    };
    loadFont('Arimo').then(drawHero);
    drawHero();
    if ('ResizeObserver' in window) new ResizeObserver(function () { drawHero(); }).observe(heroSheet);
  }

  if (!root) return;

  /* ── The demo ───────────────────────────────────────────────────────── */

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var preview = Preview(root, 'cvr-demo');
  var pagesEl = $('[data-pages]');
  var canvas = $('[data-canvas]');
  var countEl = $('[data-page-count]');
  var countText = $('[data-page-count-text]');
  var pagesSmall = $('[data-pages-small]');
  var saveEl = $('[data-save]');
  var undoBtn = $('[data-undo]');
  var redoBtn = $('[data-redo]');
  var exportBtn = $('[data-export]');
  var exportLabel = $('[data-export-label]');
  var zoomFit = $('[data-zoom="fit"]');

  var doc = clone(DOC);
  var past = [];
  var future = [];
  var lastEditKey = null;
  var lastEditAt = 0;
  var HISTORY_LIMIT = 60;
  var COALESCE_MS = 700;
  var AUTOSAVE_DELAY_MS = 900;
  var zoom = 'fit';
  var layout = null;
  var lastCount = 0;

  /* Saving, mimicked: the same states, and nothing sent anywhere. */
  var saveTimer = 0;
  var savingTimer = 0;
  function setSave(state) {
    saveEl.setAttribute('data-state', state);
    if (state === 'saving') saveEl.innerHTML = '<span class="cvd-spin" aria-hidden="true"></span><span class="cvd-save__t">Saving…</span>';
    else if (state === 'dirty') saveEl.innerHTML = icon('cloud-off') + '<span class="cvd-save__t">Unsaved</span>';
    else saveEl.innerHTML = icon('check') + '<span class="cvd-save__t">Saved</span>';
  }
  function save() {
    clearTimeout(saveTimer);
    clearTimeout(savingTimer);
    setSave('saving');
    savingTimer = setTimeout(function () { setSave('saved'); }, reduce ? 0 : 450);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    clearTimeout(savingTimer);
    setSave('dirty');
    saveTimer = setTimeout(save, AUTOSAVE_DELAY_MS);
  }

  /* Edits and undo, as the app's store does them. */
  function mutate(key, updater) {
    var next = clone(doc);
    updater(next);
    if (JSON.stringify(next) === JSON.stringify(doc)) return;
    var now = Date.now();
    var coalesce = key === lastEditKey && now - lastEditAt < COALESCE_MS;
    lastEditKey = key;
    lastEditAt = now;
    if (!coalesce) past = past.concat([doc]).slice(-HISTORY_LIMIT);
    future = [];
    doc = next;
    scheduleSave();
    sync();
  }

  function timeTravel(from) {
    var stack = from === 'past' ? past : future;
    if (!stack.length) return;
    var target = stack[stack.length - 1];
    if (from === 'past') { past = past.slice(0, -1); future = future.concat([doc]).slice(-HISTORY_LIMIT); }
    else { future = future.slice(0, -1); past = past.concat([doc]).slice(-HISTORY_LIMIT); }
    lastEditKey = null;
    doc = target;
    scheduleSave();
    sync();
  }

  var setDesign = function (patch, key) {
    mutate(key || 'design:' + Object.keys(patch).join(','), function (d) { Object.assign(d.design, patch); });
  };

  /* Controls. */
  var densityBtns = $$('[data-density]');
  var fontSelect = $('[data-font]');
  var sliders = $$('[data-design]');
  var toggles = $$('[data-toggle]');
  var headerInputs = $$('[data-header]');
  var accentsEl = $('[data-accents]');

  accentsEl.innerHTML = ACCENTS.map(function (a) {
    return '<button type="button" style="--c:' + a.value + '" data-accent="' + a.value + '" aria-label="' + a.label + '" title="' + a.label + '" aria-pressed="false"></button>';
  }).join('');
  var swatches = $$('[data-accent]');

  var UNITS = { fontSize: ' pt', lineHeight: '', marginX: ' mm', marginY: ' mm', sectionGap: ' pt', entryGap: ' pt' };
  var fmt = function (k, v) { return (k === 'lineHeight' ? Number(v).toFixed(2) : String(v)) + UNITS[k]; };

  function activePreset() {
    var d = doc.design;
    for (var key in DENSITY_PRESETS) {
      var p = DENSITY_PRESETS[key];
      if (p.fontSize === d.fontSize && p.lineHeight === d.lineHeight && p.sectionGap === d.sectionGap && p.entryGap === d.entryGap && p.marginX === d.marginX && p.marginY === d.marginY) return key;
    }
    return null;
  }

  // Puts the document's values back into the controls (after undo, reset…).
  function syncControls() {
    var d = doc.design;
    var preset = activePreset();
    densityBtns.forEach(function (btn) { btn.setAttribute('aria-pressed', String(btn.getAttribute('data-density') === preset)); });
    fontSelect.value = fontKey(d.fontFamily);
    sliders.forEach(function (input) {
      var k = input.getAttribute('data-design');
      if (document.activeElement !== input) input.value = d[k];
      var out = root.querySelector('[data-out="' + k + '"]');
      if (out) out.textContent = fmt(k, d[k]);
    });
    swatches.forEach(function (s) { s.setAttribute('aria-pressed', String(s.getAttribute('data-accent') === d.accent)); });
    toggles.forEach(function (t) { t.checked = !!d[t.getAttribute('data-toggle')]; });
    headerInputs.forEach(function (input) {
      var k = input.getAttribute('data-header');
      if (document.activeElement !== input && input.value !== doc.header[k]) input.value = doc.header[k];
    });
    undoBtn.disabled = !past.length;
    redoBtn.disabled = !future.length;
  }

  densityBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { setDesign(DENSITY_PRESETS[btn.getAttribute('data-density')], 'density'); });
  });
  fontSelect.addEventListener('change', function () {
    var f = FONTS[fontSelect.value];
    loadFont(f.family).then(function () { render(); });
    setDesign({ fontFamily: f.value });
  });
  sliders.forEach(function (input) {
    input.addEventListener('input', function () {
      var k = input.getAttribute('data-design');
      var patch = {};
      patch[k] = parseFloat(input.value);
      setDesign(patch);
    });
  });
  swatches.forEach(function (s) {
    s.addEventListener('click', function () { setDesign({ accent: s.getAttribute('data-accent') }); });
  });
  toggles.forEach(function (t) {
    t.addEventListener('change', function () {
      var patch = {};
      patch[t.getAttribute('data-toggle')] = t.checked;
      setDesign(patch);
    });
  });
  headerInputs.forEach(function (input) {
    input.addEventListener('input', function () {
      var k = input.getAttribute('data-header');
      mutate('header:' + k, function (d) { d.header[k] = k === 'summary' ? sanitizeInline(input.value) : input.value; });
    });
  });
  $('[data-reset-design]').addEventListener('click', function () { setDesign(DEFAULT_DESIGN, 'reset'); });
  undoBtn.addEventListener('click', function () { timeTravel('past'); });
  redoBtn.addEventListener('click', function () { timeTravel('future'); });

  root.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); timeTravel(e.shiftKey ? 'future' : 'past'); }
    else if (k === 's') { e.preventDefault(); save(); }
  });

  /* Content / Design tabs. */
  var tabs = $$('[data-pane]');
  function setPane(name, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-pane') === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('[data-pane-body]').forEach(function (p) { p.hidden = p.getAttribute('data-pane-body') !== name; });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { setPane(t.getAttribute('data-pane')); });
    t.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setPane(tabs[(i + 1) % tabs.length].getAttribute('data-pane'), true);
    });
  });

  /* Zoom. */
  $$('[data-zoom]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.getAttribute('data-zoom');
      var s = currentScale();
      if (mode === 'fit') zoom = zoom === 'fit' ? 1 : 'fit';
      else if (mode === 'in') zoom = Math.min(2, Math.round((s + 0.1) * 100) / 100);
      else zoom = Math.max(0.25, Math.round((s - 0.1) * 100) / 100);
      draw();
    });
  });

  function fitScale() {
    if (!layout) return 0.3;
    var n = Math.max(2, layout.pages.length);
    var cs = getComputedStyle(pagesEl);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var gap = parseFloat(cs.columnGap) || 24;
    // A couple of pixels spare, so rounding can never wrap the last sheet.
    var w = canvas.clientWidth - padX - gap * (n - 1) - 2;
    var h = canvas.clientHeight - padY - 2;
    return Math.max(0.1, Math.min(1, w / (n * PAGE_W), h / PAGE_H));
  }
  var currentScale = function () { return zoom === 'fit' ? fitScale() : zoom; };

  /* Measure, paginate, draw. */
  var queued = 0;
  function sync() {
    syncControls();
    if (queued) return;
    queued = requestAnimationFrame(function () { queued = 0; render(); });
  }

  function render() {
    var result = preview.layout(doc);
    if (!result) return;
    layout = result;
    draw();
  }

  function draw() {
    if (!layout) return;
    var n = layout.pages.length;
    var s = currentScale();
    var w = Math.floor(PAGE_W * s);
    var h = Math.floor(PAGE_H * s);
    var html = layout.pages.map(function (indices, i) {
      return '<div class="cvd-sheet" style="width:' + w + 'px;height:' + h + 'px">' +
        '<div class="cvd-paper" style="width:' + PAGE_W + 'px;height:' + PAGE_H + 'px;transform:scale(' + s + ')">' + preview.pageHtml(layout.blocks, indices) + '</div>' +
        '<span class="cvd-plabel" aria-hidden="true">' + (i + 1) + ' / ' + n + '</span>' +
      '</div>';
    }).join('');
    if (n === 1) {
      html += '<div class="cvd-sheet cvd-ghost" style="width:' + w + 'px;height:' + h + 'px">' + icon('check') + '<span>Fits on one page</span><small>Page 2 is gone.</small></div>';
    }
    pagesEl.innerHTML = html;
    zoomFit.textContent = zoom === 'fit' ? 'Fit' : Math.round(s * 100) + '%';
    zoomFit.setAttribute('aria-label', zoom === 'fit' ? 'Zoom to 100%' : 'Fit the pages to the view');

    var label = n + ' ' + (n === 1 ? 'page' : 'pages');
    pagesSmall.textContent = label;
    countText.textContent = n === 1 ? '1 page — fits' : label + ' — spills over';
    countEl.classList.toggle('is-one', n === 1);
    if (lastCount && lastCount !== n && !reduce) {
      countEl.classList.remove('is-pop');
      void countEl.offsetWidth;
      countEl.classList.add('is-pop');
    }
    lastCount = n;
  }

  if ('ResizeObserver' in window) {
    var lastW = 0, lastH = 0;
    new ResizeObserver(function () {
      if (canvas.clientWidth === lastW && canvas.clientHeight === lastH) return;
      lastW = canvas.clientWidth;
      lastH = canvas.clientHeight;
      if (zoom === 'fit') draw();
    }).observe(canvas);
  }

  /* Export: the app's print document, printed by this browser. The app hands
     the same HTML to Chromium on the server; here the print dialog stands in. */
  var FONT_CSS = 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400&family=Carlito:ital,wght@0,400;0,700;1,400&family=Gelasio:ital,wght@0,400;0,700;1,400&display=swap';

  function renderPrintHtml(d) {
    var title = resumeFileName(d).replace(/\.pdf$/, '');
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<link rel="stylesheet" href="' + FONT_CSS + '">' +
      '<style>*, *::before, *::after { box-sizing: border-box; }\nhtml, body { margin: 0; padding: 0; background: #fff; }\n' + renderResumeCss(d.design, 'print') + '</style>' +
      '</head><body>' + renderResumeBody(d) + '</body></html>';
  }

  var printFrame = null;
  exportBtn.addEventListener('click', function () {
    exportBtn.disabled = true;
    exportLabel.textContent = 'Building…';
    save();
    if (printFrame) printFrame.remove();
    printFrame = document.createElement('iframe');
    printFrame.className = 'cvd-print';
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.setAttribute('tabindex', '-1');
    printFrame.title = 'Print preview';
    var done = function () {
      exportBtn.disabled = false;
      exportLabel.textContent = 'Export PDF';
    };
    printFrame.addEventListener('load', function () {
      var w = printFrame.contentWindow;
      var ready = w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready : Promise.resolve();
      ready.then(function () {
        try { w.focus(); w.print(); } catch (e) { /* printing blocked: nothing to undo */ }
        done();
      });
    });
    printFrame.srcdoc = renderPrintHtml(doc);
    document.body.appendChild(printFrame);
  });

  // Exposed for the page's own checks: the print document for the current design.
  root.cvPrintHtml = function () { return renderPrintHtml(doc); };
  root.cvPageCount = function () { return layout ? layout.pages.length : 0; };

  /* Start. */
  headerInputs.forEach(function (input) { input.value = doc.header[input.getAttribute('data-header')]; });
  setSave('saved');
  syncControls();
  render();
  loadFont(FONTS[fontKey(doc.design.fontFamily)].family).then(render);
  if (document.fonts) {
    if (document.fonts.ready) document.fonts.ready.then(render);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { render(); });
  }
})();
