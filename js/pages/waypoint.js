/*
 * Waypoint: the "ask Claude to organise" demo.
 *
 * Two pieces are ports of the app's own code, kept as close to the original
 * as plain JavaScript allows:
 *   - applyPlan (lib/organizer/plan.ts): how Claude's answer becomes labels
 *     and map changes — lenient on purpose, so one odd answer can't sink a batch.
 *   - placeParts and layoutCards (lib/map/layout.ts): where parts and paste
 *     cards go on the map. Deterministic, and parts dragged by hand never move.
 * Claude's side of the conversation is scripted; its answer (PLAN) is invented.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-wp-demo]');
  if (!root) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var icon = (window.SITE && window.SITE.icon) || function () { return ''; };
  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ── The workspace (all invented) ───────────────────────────────────── */

  // The twelve built-in kinds, as lib/pastes/kinds.ts defines them.
  var KINDS = [
    { id: 'idea', label: 'Idea', plural: 'Ideas', emoji: '💡', color: '#eab308' },
    { id: 'bug', label: 'Bug', plural: 'Bugs', emoji: '🐞', color: '#ef4444' },
    { id: 'feedback', label: 'User feedback', plural: 'User feedback', emoji: '🗣️', color: '#ec4899' },
    { id: 'design', label: 'Design / UI', plural: 'Design / UI', emoji: '🎨', color: '#8b5cf6' },
    { id: 'task', label: 'Task', plural: 'Tasks', emoji: '✅', color: '#6366f1' },
    { id: 'question', label: 'Question', plural: 'Questions', emoji: '❓', color: '#3b82f6' },
    { id: 'concern', label: 'Concern', plural: 'Concerns', emoji: '⚠️', color: '#f97316' },
    { id: 'business', label: 'Pricing / business', plural: 'Pricing / business', emoji: '💰', color: '#10b981' },
    { id: 'research', label: 'Research', plural: 'Research', emoji: '🔬', color: '#06b6d4' },
    { id: 'competitor', label: 'Competitor', plural: 'Competitors', emoji: '🥊', color: '#a16207' },
    { id: 'meeting', label: 'Meeting notes', plural: 'Meeting notes', emoji: '🗓️', color: '#78716c' },
    { id: 'note', label: 'Note', plural: 'Notes', emoji: '📝', color: '#94a3b8' }
  ];
  var KIND = new Map(KINDS.map(function (k) { return [k.id, k]; }));
  var UNSORTED = { id: 'unsorted', label: 'Unsorted', plural: 'Unsorted', emoji: '📄', color: '#94a3b8' };
  var kindOf = function (id) { return KIND.get(id) || UNSORTED; };

  var PRODUCTS = [
    { slug: 'app', title: 'RideCheck app', icon: '📱', color: '#4aa3f5' },
    { slug: 'website', title: 'Website', icon: '🌐', color: '#10b981' }
  ];

  var PEOPLE = {
    adrian: { name: 'Adrian', color: '#10b981' },
    tio: { name: 'Tio', color: '#8b5cf6' },
    dhafin: { name: 'Dhafin', color: '#f59e0b' },
    fazry: { name: 'Fazry', color: '#06b6d4' }
  };

  // Newest first, the way they'd sit in the bin.
  var PASTES = [
    { id: 'p4', author: 'adrian', ago: '6 minutes ago', kinds: [],
      text: 'ok the onboarding copy is way too long. four screens of text before you even add your bike. nobody reads that. one screen, then let them add the vehicle first' },
    { id: 'p3', author: 'dhafin', ago: '25 minutes ago', kinds: ['idea'],
      text: 'idea: what if riders could book a service straight from the reminder?\n– the partner workshop shows its open slots\n– tap to book, we confirm on WhatsApp\n– start with 2–3 workshops near the office, see if anyone uses it\nwe’d need slots from the workshop, a booking flow in the app, confirmation messages, and a way for the workshop to see its bookings' },
    { id: 'p2', author: 'tio', ago: '48 minutes ago', kinds: ['bug'],
      text: 'reminders firing twice on android 14?? got two “oil change due” notifs at 9:00 this morning. iOS fine' },
    { id: 'p1', author: 'fazry', ago: '2 hours ago', kinds: [],
      text: 'a rider DM’d us on IG — says the trip map jumps around when he zooms out after a long ride and the route line disappears for a sec. he thinks he’s on android' }
  ];
  var PASTE = new Map(PASTES.map(function (p) { return [p.id, p]; }));

  var MAP0 = {
    parts: [
      { id: 'mobile-app', name: 'Mobile app', emoji: '📱', note: 'The RideCheck app, on iOS and Android' },
      { id: 'notifications', name: 'Notifications', emoji: '🔔', note: 'Service reminders and push' },
      { id: 'trip-map', name: 'Trip map', emoji: '🗺️', note: 'Recorded trips, drawn on a map' }
    ],
    links: [
      { from: 'notifications', to: 'mobile-app', reason: 'reminders arrive as push' },
      { from: 'trip-map', to: 'mobile-app', reason: 'trips are recorded on the phone' }
    ],
    pastes: []
  };

  // What Claude answers with — the PlanSchema shape. Two slips are in it on
  // purpose ("ux" isn't a kind; "Onboarding" is named but never added) to show
  // how the checks deal with them.
  var PLAN = {
    pastes: [
      { id: 'p4', kinds: ['design', 'ux'], title: 'Onboarding: one screen, vehicle first',
        summary: 'Four screens of text come before a rider can add a vehicle. Cut it to one screen and let them add the vehicle first.',
        tldr: null, tags: ['onboarding', 'copy'], topic: null, products: ['app'], parts: ['Onboarding'] },
      { id: 'p3', kinds: ['idea', 'business'], title: 'Book a workshop straight from a reminder',
        summary: 'Riders would book a partner workshop’s open slot from a service reminder, confirmed on WhatsApp. It needs slots from workshops, a booking flow, confirmations and a bookings view for the workshop.',
        tldr: 'Book a service from the reminder; pilot it with two or three workshops nearby.',
        tags: ['booking', 'workshops', 'pilot'], topic: 'Bookings', products: ['app'], parts: ['Bookings'] },
      { id: 'p2', kinds: ['bug'], title: 'Duplicate service reminders on Android 14',
        summary: 'Service reminders arrive twice on Android 14; iOS is fine.',
        tldr: null, tags: ['reminders', 'android'], topic: 'Reminders', products: ['app'], parts: ['Notifications', 'Mobile app'] },
      { id: 'p1', kinds: ['feedback', 'bug'], title: 'Trip map loses the route on zoom-out',
        summary: 'A rider says the trip map jumps when he zooms out after a long ride, and the route line briefly disappears. Probably Android.',
        tldr: null, tags: ['trip-map', 'android', 'rider'], topic: 'Trip map', products: ['app'], parts: ['trip map', 'Mobile app'] }
    ],
    newParts: [{ name: 'Bookings', emoji: '📅', note: 'Booking a service with a partner workshop' }],
    links: [
      { from: 'Bookings', to: 'Notifications', reason: 'a booking starts from a reminder' },
      { from: 'Onboarding', to: 'Mobile app', reason: 'the first thing the app shows' }
    ],
    announce: 'Organised 4 pastes: a rider’s trip-map report, an Android reminder bug worth a look first, a booking idea and an onboarding note. Bookings is new on the map.'
  };

  var TASKS = [
    { title: 'Fix duplicate service reminders on Android 14', owners: ['tio'], pasteIds: ['p2'] },
    { title: 'Keep the route on screen when the trip map zooms out', owners: ['adrian'], pasteIds: ['p1'] },
    { title: 'Plan a booking pilot with two or three workshops', owners: ['dhafin'], pasteIds: ['p3'] },
    { title: 'Onboarding: one screen, then add the vehicle', owners: ['adrian', 'fazry'], pasteIds: ['p4'] }
  ];

  // Who does what — Claude's briefing carries a line like this for each of us.
  var WHO = [
    ['adrian', 'screens and front end, on every platform'],
    ['tio', 'data and the backend'],
    ['dhafin', 'the roadmap, and checking work at the end'],
    ['fazry', 'marketing and design']
  ];

  var ASK = {
    organise: 'Organize the Waypoint Paste bin — just what’s new; skip what’s already organized',
    tasks: 'Turn the reminder bug, the trip-map report, the booking idea and the onboarding note into tasks for whoever owns each one.'
  };

  /* ── lib/organizer/plan.ts — applyPlan, ported ──────────────────────── */

  function clip(text, max) {
    var clean = String(text || '').trim().replace(/\s+/g, ' ');
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }

  function uniq(list) { return Array.from(new Set(list)); }

  function applyPlan(plan, batch, context) {
    var kindIds = new Set(context.kinds.map(function (k) { return k.id; }));
    var productSlugs = new Set(context.products.map(function (p) { return p.slug; }));
    var byId = new Map(batch.map(function (p) { return [p.id, p]; }));
    var answered = new Map(plan.pastes.filter(function (e) { return byId.has(e.id); }).map(function (e) { return [e.id, e]; }));

    // Parts by lowercased name: those on the map, those the plan adds, and any the plan names without adding.
    var parts = new Map(context.map.parts.map(function (p) { return [p.name.toLowerCase(), p.name]; }));
    var newParts = [];
    var addPart = function (name, emoji, note) {
      var clean = clip(name, 60);
      if (!clean || parts.has(clean.toLowerCase())) return;
      parts.set(clean.toLowerCase(), clean);
      var part = { name: clean };
      if (emoji && emoji.trim()) part.emoji = emoji.trim().slice(0, 8);
      if (note && note.trim()) part.note = clip(note, 200);
      newParts.push(part);
    };
    plan.newParts.forEach(function (p) { addPart(p.name, p.emoji, p.note); });

    var updates = [];
    var mapPastes = [];
    answered.forEach(function (entry, id) {
      var paste = byId.get(id);
      // The poster's own kinds stay first.
      var kinds = uniq(paste.kinds.concat(entry.kinds.map(function (k) { return k.trim().toLowerCase(); })))
        .filter(function (k) { return kindIds.has(k); }).slice(0, 4);
      var products = uniq(entry.products.map(function (s) { return s.trim().toLowerCase(); }))
        .filter(function (s) { return productSlugs.has(s); });
      var tldr = entry.tldr && entry.tldr.trim() ? clip(entry.tldr, 300) : undefined;
      var topic = entry.topic && entry.topic.trim() ? clip(entry.topic, 80) : undefined;
      updates.push({
        id: id,
        patch: {
          kinds: kinds.length ? kinds : paste.kinds.length ? paste.kinds : ['note'],
          products: products,
          organized: {
            title: clip(entry.title, 120) || clip(paste.text, 60) || 'Untitled',
            summary: clip(entry.summary, 400),
            tldr: tldr,
            tags: uniq(entry.tags.map(function (t) { return clip(t.toLowerCase().replace(/^#/, ''), 40); }).filter(Boolean)).slice(0, 6),
            topic: topic
          }
        }
      });
      entry.parts.forEach(function (name) { addPart(name); });
      var on = uniq(entry.parts.map(function (name) { return parts.get(clip(name, 60).toLowerCase()); }).filter(Boolean));
      if (on.length) mapPastes.push({ pasteId: id, parts: on.slice(0, 8) });
    });

    var links = plan.links
      .map(function (l) { return { from: parts.get(clip(l.from, 60).toLowerCase()), to: parts.get(clip(l.to, 60).toLowerCase()), reason: clip(l.reason, 120) }; })
      .filter(function (l) { return l.from && l.to && l.from !== l.to; });

    return {
      updates: updates,
      mapChanges: { parts: newParts, links: links, pastes: mapPastes },
      missed: batch.filter(function (p) { return !answered.has(p.id); }).map(function (p) { return p.id; })
    };
  }

  // Narration only: what the checks above quietly fixed.
  function describePlan(plan, context) {
    var notes = [];
    var kindIds = new Set(context.kinds.map(function (k) { return k.id; }));
    var known = new Map(context.map.parts.map(function (p) { return [p.name.toLowerCase(), p.name]; }));
    var added = new Set(plan.newParts.map(function (p) { return p.name.toLowerCase(); }));
    plan.pastes.forEach(function (entry) {
      entry.kinds.forEach(function (k) {
        if (!kindIds.has(k)) notes.push({ fix: true, t: '“' + k + '” isn’t one of our kinds — dropped it.' });
      });
      entry.parts.forEach(function (name) {
        var canon = known.get(name.toLowerCase());
        if (canon && canon !== name) notes.push({ fix: true, t: '“' + name + '” read as the part ' + canon + '.' });
        if (!canon && !added.has(name.toLowerCase())) {
          added.add(name.toLowerCase());
          notes.push({ fix: true, t: '“' + name + '” isn’t on the map yet — added it as a part.' });
        }
      });
    });
    return notes;
  }

  /* ── lib/map/layout.ts — placeParts and layoutCards, ported ─────────── */

  var PART_SIZE = { w: 184, h: 78 };
  var CARD_SIZE = { w: 196, h: 56 };
  var FAN = 3;

  function ring(index) {
    var rx = 205 + index * 150;
    var ry = 100 + index * 105;
    var perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    return { rx: rx, ry: ry, capacity: Math.max(1, Math.floor(perimeter / 150)) };
  }

  function footprint(cards) {
    if (!cards) return 105;
    if (cards <= FAN) return 230;
    var rings = 0;
    for (var left = cards; left > 0; rings++) left -= ring(rings).capacity;
    return ring(rings - 1).rx + CARD_SIZE.w / 2 + 10;
  }

  var sharedRoom = function (count) { return count ? 70 + count * 40 : 0; };
  var pairKey = function (a, b) { return [a, b].sort().join('~'); };

  function cardCounts(pastes) {
    var own = new Map();
    var shared = new Map();
    pastes.forEach(function (p) {
      var parts = p.parts;
      if (parts.length === 1) own.set(parts[0], (own.get(parts[0]) || 0) + 1);
      for (var i = 0; i < parts.length; i++) {
        for (var j = i + 1; j < parts.length; j++) {
          var key = pairKey(parts[i], parts[j]);
          shared.set(key, (shared.get(key) || 0) + 1);
        }
      }
    });
    return { own: own, shared: shared };
  }

  // A small seeded random, so placements are the same every time.
  function seeded(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return function () {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  var placed = function (p) { return isFinite(p.x) && isFinite(p.y); };

  function placeParts(parts, links, pastes) {
    if (!parts.length) return parts;
    var counts = cardCounts(pastes);
    var between = function (a, b) { return sharedRoom(counts.shared.get(pairKey(a, b)) || 0); };
    var nodes = parts.map(function (part) {
      return { id: part.id, x: part.x, y: part.y, r: footprint(counts.own.get(part.id) || 0),
        pinned: !!part.pinned && placed(part), anchor: placed(part) ? { x: part.x, y: part.y } : null };
    });
    var byId = new Map(nodes.map(function (n) { return [n.id, n]; }));
    var edges = links.map(function (l) { return [byId.get(l.from), byId.get(l.to)]; }).filter(function (e) { return e[0] && e[1]; });
    var neighbours = function (id) {
      var out = [];
      edges.forEach(function (e) { if (e[0].id === id) out.push(e[1]); else if (e[1].id === id) out.push(e[0]); });
      return out;
    };

    // Starting spots for anything without one: next to its placed neighbours, else beside the map.
    var waiting = nodes.filter(function (n) { return !placed(n); });
    while (waiting.length) {
      waiting.sort(function (a, b) {
        return neighbours(b.id).filter(placed).length - neighbours(a.id).filter(placed).length || a.id.localeCompare(b.id);
      });
      var node = waiting[0];
      var random = seeded(node.id);
      var around = neighbours(node.id).filter(placed);
      var angle = random() * Math.PI * 2;
      if (around.length) {
        var cx = around.reduce(function (s, n) { return s + n.x; }, 0) / around.length;
        var cy = around.reduce(function (s, n) { return s + n.y; }, 0) / around.length;
        var reach = node.r + Math.max.apply(null, around.map(function (n) { return n.r + between(node.id, n.id); })) + 40;
        node.x = cx + Math.cos(angle) * reach;
        node.y = cy + Math.sin(angle) * reach;
      } else {
        var others = nodes.filter(function (n) { return n !== node && placed(n); });
        if (!others.length) { node.x = 0; node.y = 0; }
        else {
          // Standalone: to the right of everything, roughly level with the middle.
          var right = Math.max.apply(null, others.map(function (n) { return n.x + n.r; }));
          var middle = others.reduce(function (s, n) { return s + n.y; }, 0) / others.length;
          node.x = right + node.r + 80;
          node.y = middle + (random() - 0.5) * 300;
        }
      }
      waiting = waiting.slice(1);
    }

    var movable = nodes.filter(function (n) { return !n.pinned; });
    if (!movable.length) return parts;
    var centre = {
      x: nodes.reduce(function (s, n) { return s + n.x; }, 0) / nodes.length,
      y: nodes.reduce(function (s, n) { return s + n.y; }, 0) / nodes.length
    };

    // How readily each gives way: dragged parts not at all, parts already on the map a little, new ones fully.
    var give = function (n) { return n.pinned ? 0 : n.anchor ? 0.25 : 1; };
    var shareOf = function (a, b) { return give(a) / (give(a) + give(b)); };

    var separate = function () {
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          if (!give(a) && !give(b)) continue;
          var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d < 0.01) {
            var ang = seeded(a.id + b.id)() * Math.PI * 2;
            dx = Math.cos(ang); dy = Math.sin(ang); d = 1;
          }
          var overlap = a.r + b.r + 20 + between(a.id, b.id) - d;
          if (overlap <= 0) continue;
          var ux = dx / d, uy = dy / d, share = shareOf(a, b);
          a.x -= ux * overlap * share; a.y -= uy * overlap * share;
          b.x += ux * overlap * (1 - share); b.y += uy * overlap * (1 - share);
        }
      }
    };

    var loose = function (n) { return !n.pinned && !n.anchor; };
    var rounds = 300;
    for (var round = 0; round < rounds; round++) {
      var heat = 1 - round / rounds;
      edges.forEach(function (e) {
        var a = e[0], b = e[1];
        // Links only draw in parts that are still finding their spot.
        if (!loose(a) && !loose(b)) return;
        var dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 0.01);
        var pull = ((d - (a.r + b.r + 40 + between(a.id, b.id))) / d) * 0.08 * heat;
        var share = !loose(a) ? 0 : !loose(b) ? 1 : 0.5;
        a.x += dx * pull * share; a.y += dy * pull * share;
        b.x -= dx * pull * (1 - share); b.y -= dy * pull * (1 - share);
      });
      movable.forEach(function (n) {
        if (n.anchor) {
          // Already on the map: hold on to where it was.
          n.x += (n.anchor.x - n.x) * 0.3; n.y += (n.anchor.y - n.y) * 0.3;
        } else {
          n.x += (centre.x - n.x) * 0.006 * heat; n.y += (centre.y - n.y) * 0.006 * heat;
        }
      });
      separate();
    }
    for (var k = 0; k < 60; k++) separate();

    return parts.map(function (part) {
      var n = byId.get(part.id);
      return n.pinned ? part : Object.assign({}, part, { x: Math.round(n.x), y: Math.round(n.y) });
    });
  }

  function layoutCards(parts, links, pastes) {
    var at = new Map(parts.map(function (p) { return [p.id, p]; }));
    var result = new Map();
    if (!parts.length) return result;
    var mapCentre = {
      x: parts.reduce(function (s, p) { return s + p.x; }, 0) / parts.length,
      y: parts.reduce(function (s, p) { return s + p.y; }, 0) / parts.length
    };
    var cards = [];
    var own = new Map();
    var shared = [];
    pastes.forEach(function (paste) {
      var on = paste.parts.filter(function (id) { return at.has(id); });
      if (on.length === 1) own.set(on[0], (own.get(on[0]) || []).concat(paste.id));
      else if (on.length > 1) shared.push({ id: paste.id, on: on });
    });
    var ownCounts = cardCounts(pastes.map(function (p) { return { parts: p.parts.filter(function (id) { return at.has(id); }) }; })).own;

    shared.forEach(function (s) {
      // Between its parts, where their rings of cards meet — weighted, so it clears the busier part's ring.
      var reach = s.on.map(function (pid) { return footprint(ownCounts.get(pid) || 0); });
      var total = reach.reduce(function (a, r) { return a + r; }, 0);
      var cx = s.on.reduce(function (a, pid, i) { return a + at.get(pid).x * (total - reach[i]); }, 0) / (total * (s.on.length - 1));
      var cy = s.on.reduce(function (a, pid, i) { return a + at.get(pid).y * (total - reach[i]); }, 0) / (total * (s.on.length - 1));
      var random = seeded(s.id);
      var home = { x: cx + (random() - 0.5) * 60, y: cy + (random() < 0.5 ? -1 : 1) * (45 + random() * 30) };
      cards.push({ id: s.id, x: home.x, y: home.y, home: home, pull: 0.12 });
    });

    own.forEach(function (ids, partId) {
      var part = at.get(partId);
      // Away from what it's connected to — or from the middle of the map when it stands alone.
      var others = [];
      links.forEach(function (l) {
        var other = l.from === partId ? l.to : l.to === partId ? l.from : null;
        if (other && at.has(other)) others.push(at.get(other));
      });
      var ax = 0, ay = 0;
      (others.length ? others : [mapCentre]).forEach(function (o) {
        var d = Math.hypot(part.x - o.x, part.y - o.y) || 1;
        ax += (part.x - o.x) / d; ay += (part.y - o.y) / d;
      });
      var away = Math.hypot(ax, ay) > 0.2 ? Math.atan2(ay, ax) : -Math.PI / 2;
      var so = 0;
      for (var index = 0; so < ids.length; index++) {
        var r = ring(index);
        var count = Math.min(r.capacity, ids.length - so);
        // A few cards fan out on the far side; more go all the way round.
        var spread = ids.length > FAN ? (Math.PI * 2) / count : 0.62;
        for (var i = 0; i < count; i++) {
          var angle = away + (i - (count - 1) / 2) * spread;
          var home = { x: part.x + Math.cos(angle) * r.rx, y: part.y + Math.sin(angle) * r.ry };
          cards.push({ id: ids[so + i], x: home.x, y: home.y, home: home, pull: 0.2 });
        }
        so += count;
      }
    });

    var pad = 12;
    var cw = CARD_SIZE.w + pad, ch = CARD_SIZE.h + pad;
    var pw = (PART_SIZE.w + CARD_SIZE.w) / 2 + pad, ph = (PART_SIZE.h + CARD_SIZE.h) / 2 + pad;
    // Pushes a card out of a box of half-size (hw, hh) around (x, y), along the shallower side.
    var pushOut = function (card, x, y, hw, hh, share) {
      var dx = card.x - x, dy = card.y - y, ox = hw - Math.abs(dx), oy = hh - Math.abs(dy);
      if (ox <= 0 || oy <= 0) return null;
      var move;
      if (ox < oy) { move = (dx >= 0 ? ox : -ox) * share; card.x += move; return { x: move, y: 0 }; }
      move = (dy >= 0 ? oy : -oy) * share; card.y += move; return { x: 0, y: move };
    };
    var separate = function () {
      var crowded = false;
      for (var i = 0; i < cards.length; i++) {
        for (var j = i + 1; j < cards.length; j++) {
          var a = cards[i], b = cards[j];
          if (a.x === b.x && a.y === b.y) b.y += 1;
          var moved = pushOut(b, a.x, a.y, cw, ch, 0.5);
          if (moved) { crowded = true; a.x -= moved.x; a.y -= moved.y; }
        }
      }
      cards.forEach(function (card) {
        parts.forEach(function (part) { if (pushOut(card, part.x, part.y, pw, ph, 1)) crowded = true; });
      });
      return crowded;
    };
    for (var round = 0; round < 140; round++) {
      // Drawn home less and less, so the pushing apart gets the last word.
      var pull = 1 - round / 140;
      cards.forEach(function (c) {
        c.x += (c.home.x - c.x) * c.pull * pull;
        c.y += (c.home.y - c.y) * c.pull * pull;
      });
      separate();
    }
    for (var k = 0; k < 200 && separate(); k++);
    cards.forEach(function (c) { result.set(c.id, { x: Math.round(c.x), y: Math.round(c.y) }); });
    return result;
  }

  function slugify(name) {
    var slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
    return slug || 'part';
  }

  // A steady colour per part, picked from its id (lib/map/types.ts).
  var PART_COLORS = ['#4aa3f5', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#14b8a6', '#f97316'];
  function partColor(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return PART_COLORS[Math.abs(hash) % PART_COLORS.length];
  }

  // Puts a plan's map changes on the map, then places whatever is new.
  function changeMap(state, changes) {
    var parts = state.parts.map(function (p) { return Object.assign({}, p); });
    var byName = new Map(parts.map(function (p) { return [p.name.toLowerCase(), p]; }));
    changes.parts.forEach(function (np) {
      if (byName.has(np.name.toLowerCase())) return;
      var part = { id: slugify(np.name), name: np.name, emoji: np.emoji, note: np.note, x: NaN, y: NaN };
      parts.push(part);
      byName.set(np.name.toLowerCase(), part);
    });
    var idOf = function (name) { var p = byName.get(name.toLowerCase()); return p ? p.id : null; };
    var links = state.links.slice();
    var seen = new Set(links.map(function (l) { return pairKey(l.from, l.to); }));
    changes.links.forEach(function (l) {
      var from = idOf(l.from), to = idOf(l.to);
      if (!from || !to || seen.has(pairKey(from, to))) return;
      seen.add(pairKey(from, to));
      links.push({ from: from, to: to, reason: l.reason });
    });
    var pastes = state.pastes.slice();
    changes.pastes.forEach(function (mp) {
      pastes.push({ id: mp.pasteId, parts: mp.parts.map(idOf).filter(Boolean) });
    });
    return { parts: placeParts(parts, links, pastes), links: links, pastes: pastes };
  }

  /* ── Elements ───────────────────────────────────────────────────────── */

  var log = $('[data-log]');
  var promptEl = $('[data-prompt]');
  var sendBtn = $('[data-send]');
  var sendLabel = $('[data-send-label]');
  var pasteGrid = $('[data-pastes]');
  var pasteCount = $('[data-paste-count]');
  var copyBtn = $('[data-copy-prompt]');
  var copyLabel = $('[data-copy-label]');
  var waitingEl = $('[data-waiting]');
  var tabs = $$('[data-tab]');
  var views = $$('[data-view]');
  var mapDot = $('[data-map-dot]');
  var toast = $('[data-toast]');
  var toastText = $('[data-toast-text]');
  var toastGo = $('[data-toast-go]');
  var stageEl = $('[data-stage]');
  var canvasEl = $('[data-canvas]');
  var worldEl = $('[data-world]');
  var linesEl = $('[data-lines]');
  var mapWrap = root.querySelector('.wpm');
  var mapInfo = $('[data-map-info]');
  var tasksEl = $('[data-tasks]');
  var steps = $$('[data-steps] li');
  var resetBtn = document.querySelector('[data-reset]');

  var avatar = function (id) {
    var p = PEOPLE[id];
    return '<span class="wpa" style="--c:' + p.color + '" title="' + p.name + '">' + p.name.charAt(0) + '</span>';
  };
  var kindChip = function (id, fresh, i) {
    var k = kindOf(id);
    return '<span class="wpk' + (fresh ? ' is-new' : '') + '" style="--k:' + k.color + ';--i:' + (i || 0) + '"><span aria-hidden="true">' + k.emoji + '</span>' + esc(k.label) + '</span>';
  };
  var productChip = function (slug) {
    var p = PRODUCTS.filter(function (x) { return x.slug === slug; })[0];
    return p ? '<span class="wpp" style="--p:' + p.color + '"><span aria-hidden="true">' + p.icon + '</span>' + esc(p.title) + '</span>' : '';
  };

  /* ── State ──────────────────────────────────────────────────────────── */

  var S;
  var run = 0;
  var CANCEL = {};

  function fresh() {
    var parts = placeParts(MAP0.parts.map(function (p) { return Object.assign({ x: NaN, y: NaN }, p); }), MAP0.links, MAP0.pastes);
    return {
      stage: 0,           // 0 raw · 1 organised · 2 tasks handed out
      busy: false,
      organised: new Map(),
      tasks: [],
      map: { parts: parts, links: MAP0.links.slice(), pastes: [] },
      mapShown: null,     // the layout last drawn
      mapPending: false,  // organised, but the map hasn't animated it in yet
      mapSeen: false,
      selected: null,
      tab: 'pastes'
    };
  }

  var wait = function (ms) {
    var token = run;
    return new Promise(function (resolve, reject) {
      setTimeout(function () { token === run ? resolve() : reject(CANCEL); }, reduce ? Math.min(ms, 40) : ms);
    });
  };

  /* ── Paste bin ──────────────────────────────────────────────────────── */

  function cardHtml(p) {
    var kinds = p.kinds.length
      ? p.kinds.map(function (k) { return kindChip(k); }).join('')
      : '<span class="wpk wpk--label">Label</span>';
    return '<article class="wpc" id="wpd-paste-' + p.id + '" tabindex="-1" aria-label="Paste by ' + PEOPLE[p.author].name + '">' +
      '<header class="wpc-head">' + avatar(p.author) +
        '<span class="wpc-who"><b>' + PEOPLE[p.author].name + '</b><small>' + p.ago + '</small></span>' +
        '<span class="wpc-kinds" data-kinds>' + kinds + '</span>' +
      '</header>' +
      '<div class="wpc-grow" data-org><div></div></div>' +
      '<p class="wpc-text">' + esc(p.text) + '</p>' +
      '<div class="wpc-grow" data-tags><div></div></div>' +
      '<div class="wpc-grow" data-task><div></div></div>' +
    '</article>';
  }

  function renderPastes() {
    pasteGrid.innerHTML = PASTES.map(cardHtml).join('');
    updateCounts();
  }

  var card = function (id) { return document.getElementById('wpd-paste-' + id); };

  function organiseCard(update) {
    var el = card(update.id);
    if (!el) return;
    var o = update.patch.organized;
    el.querySelector('[data-kinds]').innerHTML = update.patch.kinds.map(function (k, i) { return kindChip(k, true, i); }).join('');
    el.querySelector('[data-org] > div').innerHTML =
      '<div class="wpc-prods">' + update.patch.products.map(productChip).join('') + '</div>' +
      '<div class="wpc-org">' +
        '<p class="wpc-org__t">' + icon('sparkles') + esc(o.title) + '</p>' +
        (o.tldr ? '<p class="wpc-org__tldr"><b>TL;DR</b>' + esc(o.tldr) + '</p>' : '') +
        '<p class="wpc-org__s">' + esc(o.summary) + '</p>' +
      '</div>';
    el.querySelector('[data-tags] > div').innerHTML = '<div class="wpc-tags">' + o.tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>';
    el.classList.remove('is-reading');
    el.querySelector('[data-org]').classList.add('is-open');
    el.querySelector('[data-tags]').classList.add('is-open');
  }

  function taskOnCard(task) {
    task.pasteIds.forEach(function (id) {
      var el = card(id);
      if (!el) return;
      el.querySelector('[data-task] > div').innerHTML =
        '<div class="wpc-task">' + icon('check') + '<b>' + esc(task.title) + '</b>' + task.owners.map(avatar).join('') + '</div>';
      el.querySelector('[data-task]').classList.add('is-open');
    });
  }

  function updateCounts() {
    var waiting = PASTES.length - S.organised.size;
    pasteCount.textContent = PASTES.length + ' pastes · ' + (waiting ? waiting + ' waiting' : 'none waiting');
    waitingEl.textContent = waiting;
    copyBtn.hidden = !waiting;
  }

  function flashPaste(id) {
    setTab('pastes');
    var el = card(id);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    el.focus({ preventScroll: true });
  }

  /* ── Map ────────────────────────────────────────────────────────────── */

  var mapEls = { parts: new Map(), cards: new Map(), lines: [], why: [] };
  var camera = null;
  var drag = null;

  function pasteTitle(id) {
    var o = S.organised.get(id);
    return o ? o.organized.title : PASTE.get(id).text.split('\n')[0];
  }
  function mainKind(id) {
    var o = S.organised.get(id);
    var kinds = o ? o.kinds : PASTE.get(id).kinds;
    return kinds.length ? kindOf(kinds[0]) : UNSORTED;
  }

  function layoutNow() {
    var cards = layoutCards(S.map.parts, S.map.links, S.map.pastes);
    var parts = new Map(S.map.parts.map(function (p) { return [p.id, { x: p.x, y: p.y, s: 1 }]; }));
    var cardPos = new Map();
    cards.forEach(function (c, id) { cardPos.set(id, { x: c.x, y: c.y, s: 1 }); });
    return { parts: parts, cards: cardPos };
  }

  function bounds(layout) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var box = function (p, w, h) {
      x0 = Math.min(x0, p.x - w / 2); y0 = Math.min(y0, p.y - h / 2);
      x1 = Math.max(x1, p.x + w / 2); y1 = Math.max(y1, p.y + h / 2);
    };
    layout.parts.forEach(function (p) { box(p, PART_SIZE.w, PART_SIZE.h); });
    layout.cards.forEach(function (c) { box(c, CARD_SIZE.w, CARD_SIZE.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function fit(b) {
    var pad = 30;
    var sw = stageEl.clientWidth, sh = stageEl.clientHeight;
    if (!sw || !sh) return null;
    var s = Math.min((sw - pad * 2) / b.w, (sh - pad * 2) / b.h, 0.9);
    s = Math.max(s, 0.5);
    return { s: s, pad: pad, b: b };
  }

  function applyCamera(cam) {
    if (!cam) return;
    camera = cam;
    canvasEl.style.width = Math.ceil(cam.b.w * cam.s + cam.pad * 2) + 'px';
    canvasEl.style.height = Math.ceil(cam.b.h * cam.s + cam.pad * 2) + 'px';
    worldEl.style.transform = 'translate(' + cam.pad + 'px,' + cam.pad + 'px) scale(' + cam.s + ') translate(' + (-cam.b.x) + 'px,' + (-cam.b.y) + 'px)';
  }

  function buildMap() {
    worldEl.querySelectorAll('.wpm-part, .wpm-card, .wpm-why').forEach(function (el) { el.remove(); });
    mapEls = { parts: new Map(), cards: new Map(), lines: [], why: [] };
    var svgNS = 'http://www.w3.org/2000/svg';
    linesEl.innerHTML = '';

    S.map.pastes.forEach(function (paste) {
      paste.parts.forEach(function (partId) {
        var line = document.createElementNS(svgNS, 'line');
        line.setAttribute('stroke', mainKind(paste.id).color);
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linecap', 'round');
        linesEl.appendChild(line);
        mapEls.lines.push({ el: line, kind: 'paste', paste: paste.id, part: partId });
      });
    });
    S.map.links.forEach(function (link) {
      var line = document.createElementNS(svgNS, 'line');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      linesEl.appendChild(line);
      mapEls.lines.push({ el: line, kind: 'link', from: link.from, to: link.to });
      var why = document.createElement('span');
      why.className = 'wpm-why';
      why.textContent = link.reason || '';
      why.hidden = true;
      worldEl.appendChild(why);
      mapEls.why.push({ el: why, from: link.from, to: link.to });
    });

    S.map.pastes.forEach(function (paste) {
      var k = mainKind(paste.id);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wpm-card';
      btn.style.setProperty('--kc', k.color);
      btn.title = pasteTitle(paste.id) + ' — open it in the Paste bin';
      btn.innerHTML = '<span class="wpm-card__emoji" aria-hidden="true">' + k.emoji + '</span><span class="wpm-card__title">' + esc(pasteTitle(paste.id)) + '</span>';
      btn.addEventListener('click', function () { flashPaste(paste.id); });
      btn.addEventListener('pointerenter', function () { light({ paste: paste.id }); });
      btn.addEventListener('pointerleave', function () { light(null); });
      btn.addEventListener('focus', function () { light({ paste: paste.id }); });
      btn.addEventListener('blur', function () { light(null); });
      worldEl.appendChild(btn);
      mapEls.cards.set(paste.id, btn);
    });

    S.map.parts.forEach(function (part) {
      var color = partColor(part.id);
      var on = S.map.pastes.filter(function (p) { return p.parts.indexOf(part.id) >= 0; });
      var counts = new Map();
      on.forEach(function (p) { var k = mainKind(p.id); counts.set(k, (counts.get(k) || 0) + 1); });
      var countHtml = counts.size
        ? Array.from(counts).map(function (e) { return '<span title="' + e[1] + ' ' + esc(e[0].plural.toLowerCase()) + '">' + e[0].emoji + ' ' + e[1] + '</span>'; }).join(' &nbsp;')
        : 'No pastes yet';
      var el = document.createElement('div');
      el.className = 'wpm-part';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-pressed', String(S.selected === part.id));
      el.setAttribute('aria-label', part.name + ': ' + on.length + ' paste' + (on.length === 1 ? '' : 's'));
      el.style.setProperty('--pc', color + 'b3');
      el.innerHTML =
        '<span class="wpm-part__tile" style="--tc:' + color + ';--tb:' + color + '29">' + (part.emoji || esc(part.name.charAt(0).toUpperCase())) + '</span>' +
        '<span style="min-width:0;flex:1"><span class="wpm-part__name">' + esc(part.name) + '</span><span class="wpm-part__counts">' + countHtml + '</span></span>' +
        (on.length ? '<span class="wpm-part__total">' + on.length + '</span>' : '') +
        (part.pinned ? '<svg class="i wpm-part__pin" aria-label="Placed by hand"><use href="#i-map-pin"/></svg>' : '');
      if (S.selected === part.id) el.classList.add('is-selected');
      bindPart(el, part);
      worldEl.appendChild(el);
      mapEls.parts.set(part.id, el);
    });
  }

  function place(layout) {
    layout.parts.forEach(function (p, id) {
      var el = mapEls.parts.get(id);
      if (el) el.style.transform = 'translate(' + (p.x - PART_SIZE.w / 2) + 'px,' + (p.y - PART_SIZE.h / 2) + 'px) scale(' + p.s + ')';
    });
    layout.cards.forEach(function (c, id) {
      var el = mapEls.cards.get(id);
      if (!el) return;
      el.style.transform = 'translate(' + (c.x - CARD_SIZE.w / 2) + 'px,' + (c.y - CARD_SIZE.h / 2) + 'px) scale(' + c.s + ')';
      el.style.opacity = c.s < 1 ? String(Math.max(0, c.s)) : '';
    });
    mapEls.lines.forEach(function (l) {
      var a, b;
      if (l.kind === 'paste') { a = layout.parts.get(l.part); b = layout.cards.get(l.paste); }
      else { a = layout.parts.get(l.from); b = layout.parts.get(l.to); }
      if (!a || !b) return;
      l.el.setAttribute('x1', a.x); l.el.setAttribute('y1', a.y);
      l.el.setAttribute('x2', b.x); l.el.setAttribute('y2', b.y);
    });
    mapEls.why.forEach(function (w) {
      var a = layout.parts.get(w.from), b = layout.parts.get(w.to);
      if (a && b) { w.el.style.left = (a.x + b.x) / 2 + 'px'; w.el.style.top = (a.y + b.y) / 2 + 'px'; }
    });
    light(currentLight);
  }

  var currentLight = null;
  function light(what) {
    currentLight = what;
    var lit = null;
    var focus = what || (S.selected ? { part: S.selected } : null);
    if (focus && focus.part) {
      var partId = focus.part;
      var parts = new Set([partId]);
      S.map.links.forEach(function (l) { if (l.from === partId) parts.add(l.to); if (l.to === partId) parts.add(l.from); });
      var pastes = new Set(S.map.pastes.filter(function (p) { return p.parts.indexOf(partId) >= 0; }).map(function (p) { return p.id; }));
      lit = { centre: partId, parts: parts, pastes: pastes };
    } else if (focus && focus.paste) {
      var mp = S.map.pastes.filter(function (p) { return p.id === focus.paste; })[0];
      if (mp) lit = { centre: null, parts: new Set(mp.parts), pastes: new Set([mp.id]) };
    }
    mapWrap.classList.toggle('has-lit', !!lit);
    mapEls.parts.forEach(function (el, id) { el.classList.toggle('is-lit', !!lit && lit.parts.has(id)); });
    mapEls.cards.forEach(function (el, id) { el.classList.toggle('is-lit', !!lit && lit.pastes.has(id)); });
    mapEls.lines.forEach(function (l) {
      if (l.kind === 'link') {
        var on = lit && lit.centre ? (l.from === lit.centre || l.to === lit.centre) : !lit;
        l.el.setAttribute('stroke', on && lit ? '#4aa3f5' : '#323d4f');
        l.el.setAttribute('stroke-opacity', on ? '1' : '0.35');
      } else {
        var shown = !lit || (lit.pastes.has(l.paste) && (lit.centre === null || lit.centre === l.part || lit.parts.has(l.part)));
        l.el.setAttribute('stroke-opacity', shown ? '0.6' : '0.08');
      }
    });
    mapEls.why.forEach(function (w) {
      w.el.hidden = !(lit && lit.centre && (w.from === lit.centre || w.to === lit.centre));
    });
  }

  function select(id) {
    S.selected = S.selected === id ? null : id;
    mapEls.parts.forEach(function (el, pid) {
      el.classList.toggle('is-selected', pid === S.selected);
      el.setAttribute('aria-pressed', String(pid === S.selected));
    });
    light(null);
    renderInfo();
  }

  function bindPart(el, part) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(part.id); }
    });
    el.addEventListener('pointerenter', function () { if (!drag) light({ part: part.id }); });
    el.addEventListener('pointerleave', function () { if (!drag) light(null); });
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !camera) return;
      el.setPointerCapture(e.pointerId);
      var p = S.map.parts.filter(function (x) { return x.id === part.id; })[0];
      drag = { id: part.id, el: el, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, moved: false };
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== part.id) return;
      var dx = (e.clientX - drag.sx) / camera.s, dy = (e.clientY - drag.sy) / camera.s;
      if (!drag.moved && Math.hypot(dx, dy) * camera.s < 4) return;
      drag.moved = true;
      el.classList.add('is-dragging');
      S.map.parts = S.map.parts.map(function (x) {
        return x.id === part.id ? Object.assign({}, x, { x: Math.round(drag.x + dx), y: Math.round(drag.y + dy), pinned: true }) : x;
      });
      var layout = layoutNow();
      S.mapShown = layout;
      place(layout);
    });
    var end = function () {
      if (!drag || drag.id !== part.id) return;
      var moved = drag.moved;
      drag = null;
      el.classList.remove('is-dragging');
      if (!moved) { select(part.id); return; }
      // Rebuild for the pin, then refit gently around the new shape.
      var from = camera;
      buildMap();
      var layout = layoutNow();
      S.mapShown = layout;
      place(layout);
      tweenCamera(from, fit(bounds(layout)), 350);
      renderInfo();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
  var frame = 0;

  function tweenCamera(from, to, ms) {
    if (!to) return;
    if (!from || reduce) { applyCamera(to); return; }
    var start = performance.now();
    cancelAnimationFrame(frame);
    var step = function (now) {
      var t = Math.min(1, (now - start) / ms), e = ease(t);
      var mix = function (a, b) { return a + (b - a) * e; };
      applyCamera({ s: mix(from.s, to.s), pad: to.pad, b: { x: mix(from.b.x, to.b.x), y: mix(from.b.y, to.b.y), w: mix(from.b.w, to.b.w), h: mix(from.b.h, to.b.h) } });
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  // Draws the map; when it has grown since last time, the old parts slide
  // over, new parts pop in and new cards fly out from their part.
  function drawMap(animate) {
    if (!stageEl.clientWidth) return;
    var prev = S.mapShown;
    buildMap();
    var to = layoutNow();
    S.mapShown = to;
    if (!animate || !prev || reduce) {
      place(to);
      applyCamera(fit(bounds(to)));
      centreStage();
      renderInfo();
      return;
    }
    var from = { parts: new Map(), cards: new Map() };
    to.parts.forEach(function (p, id) {
      var was = prev.parts.get(id);
      from.parts.set(id, was ? { x: was.x, y: was.y, s: 1 } : { x: p.x, y: p.y, s: 0 });
    });
    to.cards.forEach(function (c, id) {
      var was = prev.cards.get(id);
      var mp = S.map.pastes.filter(function (x) { return x.id === id; })[0];
      var home = mp && to.parts.get(mp.parts[0]);
      from.cards.set(id, was ? { x: was.x, y: was.y, s: 1 } : { x: home ? home.x : c.x, y: home ? home.y : c.y, s: 0.2 });
    });
    var b0 = bounds(prev), b1 = bounds(to);
    var start = performance.now(), ms = 1400;
    cancelAnimationFrame(frame);
    var step = function (now) {
      var t = Math.min(1, (now - start) / ms);
      var mid = { parts: new Map(), cards: new Map() };
      var at = function (map, out, delay) {
        map.forEach(function (a, id) {
          var local = Math.max(0, Math.min(1, (t - delay(id)) / 0.6));
          var e = ease(local);
          var b = (out === mid.parts ? to.parts : to.cards).get(id);
          out.set(id, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: a.s + (b.s - a.s) * e });
        });
      };
      at(from.parts, mid.parts, function (id) { return prev.parts.has(id) ? 0 : 0.15; });
      var order = Array.from(to.cards.keys());
      at(from.cards, mid.cards, function (id) { return prev.cards.has(id) ? 0 : 0.3 + order.indexOf(id) * 0.04; });
      place(mid);
      var e = ease(Math.min(1, t / 0.7));
      var mix = function (a, b) { return a + (b - a) * e; };
      applyCamera(fit({ x: mix(b0.x, b1.x), y: mix(b0.y, b1.y), w: mix(b0.w, b1.w), h: mix(b0.h, b1.h) }));
      if (t < 1) frame = requestAnimationFrame(step);
      else { place(to); applyCamera(fit(b1)); centreStage(); }
    };
    frame = requestAnimationFrame(step);
    renderInfo();
  }

  // On a narrow screen the map is bigger than its window: start in the middle.
  function centreStage() {
    stageEl.scrollLeft = Math.max(0, (stageEl.scrollWidth - stageEl.clientWidth) / 2);
    stageEl.scrollTop = Math.max(0, (stageEl.scrollHeight - stageEl.clientHeight) / 2);
  }

  function renderInfo() {
    var mapped = S.map.pastes.length;
    var waiting = PASTES.length - mapped;
    var used = [];
    S.map.pastes.forEach(function (p) { var k = mainKind(p.id); if (used.indexOf(k) < 0) used.push(k); });
    var summary =
      '<div class="wpm-box">' +
        '<h4>Map</h4>' +
        '<p>How the Paste bin connects to the product. Claude draws it; drag parts to fix it.</p>' +
        '<p class="mt-8"><strong>' + S.map.parts.length + '</strong> parts · <strong>' + mapped + '</strong> paste' + (mapped === 1 ? '' : 's') + ' mapped</p>' +
        (used.length ? '<div class="wpm-legend">' + used.map(function (k) { return '<span><i style="--k:' + k.color + '"></i>' + esc(k.plural) + '</span>'; }).join('') + '</div>' : '') +
        (waiting ? '<div class="wpm-tray"><b>' + waiting + '</b>Not on the map yet — ask Claude to organise</div>' : '') +
      '</div>';

    var part = S.selected && S.map.parts.filter(function (p) { return p.id === S.selected; })[0];
    var detail;
    if (part) {
      var color = partColor(part.id);
      var on = S.map.pastes.filter(function (p) { return p.parts.indexOf(part.id) >= 0; });
      var links = S.map.links.filter(function (l) { return l.from === part.id || l.to === part.id; });
      var name = function (id) { var p = S.map.parts.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; };
      detail =
        '<div class="wpm-box">' +
          '<h4><span class="wpm-tile" style="--tc:' + color + ';--tb:' + color + '2e">' + (part.emoji || esc(part.name.charAt(0))) + '</span>' + esc(part.name) + '</h4>' +
          (part.note ? '<p>' + esc(part.note) + '</p>' : '') +
          (part.pinned ? '<p>Placed by hand. Tidying up leaves it here.</p>' : '') +
          '<p class="wpm-sub">Pastes about it · ' + on.length + '</p>' +
          (on.length ? '<ul class="wpm-list">' + on.map(function (p) { var k = mainKind(p.id); return '<li><span aria-hidden="true">' + k.emoji + '</span>' + esc(pasteTitle(p.id)) + '</li>'; }).join('') + '</ul>' : '<p>None yet.</p>') +
          '<p class="wpm-sub">Connected to · ' + links.length + '</p>' +
          (links.length ? '<ul class="wpm-list">' + links.map(function (l) { var other = l.from === part.id ? l.to : l.from; return '<li><i style="--k:' + partColor(other) + '"></i><span>' + esc(name(other)) + (l.reason ? ' <small>— ' + esc(l.reason) + '</small>' : '') + '</span></li>'; }).join('') + '</ul>' : '<p>Stands alone.</p>') +
        '</div>';
    } else {
      detail = '<div class="wpm-box"><h4>Pick a part</h4><p>Tap or press Enter on a part to see the pastes on it and what it’s connected to. Click a paste to open it in the Paste bin.</p></div>';
    }
    mapInfo.innerHTML = summary + detail;
  }

  /* ── Schematic ──────────────────────────────────────────────────────── */

  function renderTasks() {
    var who = '<div class="wpt-who"><b>Who does what — from Claude’s briefing</b><ul>' +
      WHO.map(function (w) { return '<li>' + avatar(w[0]) + '<span><b>' + PEOPLE[w[0]].name + '</b> — ' + esc(w[1]) + '</span></li>'; }).join('') +
      '</ul></div>';
    if (!S.tasks.length) {
      tasksEl.innerHTML = '<div class="wpt-empty"><b>Nothing from the Paste bin yet</b>Tasks Claude makes from pastes land here, each on whoever owns that area.</div>' + who;
      return;
    }
    tasksEl.innerHTML =
      '<div class="wpt-list"><div class="wpt-list__head">' + icon('route') + 'Roadmap · from the Paste bin<small>' + S.tasks.length + ' new</small></div>' +
        S.tasks.map(function (t, i) {
          var pid = t.pasteIds[0];
          var k = mainKind(pid);
          return '<div class="wpt-row" style="--i:' + i + '">' +
            '<span class="wpt-check" aria-hidden="true"></span>' +
            '<div class="wpt-main"><b>' + esc(t.title) + '</b>' +
              '<div class="wpt-meta"><span class="wpt-status" style="--s:#94a3b8">Not started</span>' +
              '<button type="button" class="wpt-from" data-open-paste="' + pid + '"><span aria-hidden="true">' + k.emoji + '</span>' + esc(pasteTitle(pid)) + '</button></div>' +
            '</div>' +
            '<span class="wpt-owners">' + t.owners.map(avatar).join('') + '<span>' + t.owners.map(function (o) { return PEOPLE[o].name; }).join(' & ') + '</span></span>' +
          '</div>';
        }).join('') +
      '</div>' + who;
  }

  tasksEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-open-paste]');
    if (btn) flashPaste(btn.getAttribute('data-open-paste'));
  });

  /* ── Tabs ───────────────────────────────────────────────────────────── */

  function setTab(name, focus) {
    S.tab = name;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    views.forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name; });
    if (name === 'map') {
      mapDot.hidden = true;
      if (!S.mapSeen && S.stage >= 1) { S.mapSeen = true; updateSteps(); }
      var animate = S.mapPending;
      S.mapPending = false;
      drawMap(animate);
    }
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = tabs[(i + d + tabs.length) % tabs.length];
      setTab(next.getAttribute('data-tab'), true);
    });
  });

  if ('ResizeObserver' in window) {
    var lastW = 0, lastH = 0;
    new ResizeObserver(function () {
      var w = stageEl.clientWidth, h = stageEl.clientHeight;
      if (!w || (w === lastW && h === lastH) || !S.mapShown) return;
      lastW = w; lastH = h;
      applyCamera(fit(bounds(S.mapShown)));
    }).observe(stageEl);
  }

  /* ── Toast, steps, prompt ───────────────────────────────────────────── */

  var toastAction = null;
  var toastTimer = 0;
  var hideToast = function () { clearTimeout(toastTimer); toast.hidden = true; };
  // Like any notification it goes away by itself — but not while you're on it.
  var hideLater = function (ms) { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms); };
  function showToast(text, label, action) {
    toastText.textContent = text;
    toastGo.textContent = label || '';
    toastAction = action || null;
    toast.hidden = false;
    toast.style.animation = 'none';
    void toast.offsetWidth;
    toast.style.animation = '';
    hideLater(12000);
  }
  // Focus never gets stranded on a notification that just went away.
  toastGo.addEventListener('click', function () {
    var a = toastAction;
    hideToast();
    if (a) a();
    var tab = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0];
    if (tab) tab.focus();
  });
  $('[data-toast-close]').addEventListener('click', function () { hideToast(); sendBtn.focus(); });
  toast.addEventListener('pointerenter', function () { clearTimeout(toastTimer); });
  toast.addEventListener('focusin', function () { clearTimeout(toastTimer); });
  toast.addEventListener('pointerleave', function () { if (!toast.hidden) hideLater(5000); });
  toast.addEventListener('focusout', function () { if (!toast.hidden) hideLater(5000); });

  function updateSteps() {
    var current = S.stage === 0 ? 0 : S.stage === 2 ? 3 : S.mapSeen ? 2 : 1;
    steps.forEach(function (li, i) {
      li.classList.toggle('is-done', i < current);
      li.classList.toggle('is-on', i === current);
    });
  }

  function setPrompt() {
    var text = S.stage === 0 ? ASK.organise : S.stage === 1 ? ASK.tasks : '';
    promptEl.textContent = text;
    sendLabel.textContent = S.busy ? 'Working…' : S.stage === 2 ? 'Start over' : 'Ask Claude';
    sendBtn.disabled = S.busy;
    sendBtn.setAttribute('aria-label', S.stage === 2 ? 'Start the demo over' : 'Send to Claude');
  }

  /* ── Claude's side ──────────────────────────────────────────────────── */

  function say(cls, html) {
    var li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    log.appendChild(li);
    log.scrollTo({ top: log.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    return li;
  }

  function tool(name) {
    return say('wpd-tool',
      '<div class="wpd-tool__head"><span class="wpd-tool__icon"><span class="wpd-spin" aria-hidden="true"></span></span><code>' + name + '</code><span class="wpd-tool__state">running…</span></div>');
  }

  function toolDone(li, out, extra) {
    li.classList.add('is-done');
    li.querySelector('.wpd-tool__icon').innerHTML = icon('check');
    li.querySelector('.wpd-tool__state').textContent = 'done';
    li.insertAdjacentHTML('beforeend', '<p class="wpd-tool__out">' + out + '</p>' + (extra || ''));
    log.scrollTo({ top: log.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }

  // Pretty JSON, with short lists kept on one line.
  var pretty = function (value) {
    return JSON.stringify(value, null, 2).replace(/\[\n\s*([^\[\]{}]*?)\n\s*\]/g, function (m, inner) {
      return '[' + inner.replace(/,\n\s*/g, ', ') + ']';
    });
  };

  var details = function (label, body) {
    return '<details><summary>' + icon('chevron-right') + label + '</summary><pre>' + esc(body) + '</pre></details>';
  };

  function typing() {
    return say('wpd-says', icon('sparkles') + '<span class="wpd-typing" aria-label="Claude is thinking"><i></i><i></i><i></i></span>');
  }

  async function organise() {
    S.busy = true;
    setPrompt();
    say('wpd-you', esc(ASK.organise));
    await wait(450);
    var t1 = tool('get_organizing_batch');
    PASTES.forEach(function (p) { var el = card(p.id); if (el) el.classList.add('is-reading'); });
    await wait(1100);
    toolDone(t1, '4 pastes, plus our 12 kinds, 2 products and the 3 parts already on the map.');
    var think = typing();
    await wait(1500);
    think.remove();

    var context = { kinds: KINDS, products: PRODUCTS, map: S.map };
    var applied = applyPlan(PLAN, PASTES, context);
    var notes = describePlan(PLAN, context);
    var t2 = tool('save_organizing_batch');
    await wait(700);
    for (var i = 0; i < applied.updates.length; i++) {
      var u = applied.updates[i];
      S.organised.set(u.id, u.patch);
      organiseCard(u);
      updateCounts();
      await wait(320);
    }
    var lines = [{ t: applied.updates.length + ' of ' + PASTES.length + ' pastes answered; ' + (applied.missed.length ? applied.missed.length + ' left for the next batch.' : 'none left.') }]
      .concat(notes)
      .concat([
        { t: applied.mapChanges.parts.length + ' new parts, ' + applied.mapChanges.links.length + ' new links, ' + applied.mapChanges.pastes.length + ' pastes on the map.' },
        { t: 'Team notified.' }
      ]);
    toolDone(t2, 'Saved through the same checks as the app’s own Organize button.',
      details('Claude’s answer', pretty(PLAN)) +
      '<ul class="wpd-applied">' + lines.map(function (l, n) {
        return '<li class="' + (l.fix ? 'is-fix' : '') + '" style="--i:' + n + '">' + icon(l.fix ? 'wrench' : 'check') + '<span>' + esc(l.t) + '</span></li>';
      }).join('') + '</ul>');

    S.map = changeMap(S.map, applied.mapChanges);
    S.stage = 1;
    S.busy = false;
    if (S.tab === 'map') drawMap(true);
    else { S.mapPending = true; mapDot.hidden = false; }
    await wait(500);
    say('wpd-says', icon('sparkles') + '<span>Done — all four are labelled and on the map. The Android reminder bug looks like the one to pick up first.</span>');
    showToast(PLAN.announce, 'Open the map', function () { setTab('map'); });
    setPrompt();
    updateSteps();
  }

  async function handOut() {
    S.busy = true;
    setPrompt();
    say('wpd-you', esc(ASK.tasks));
    await wait(450);
    var t = tool('create_tasks');
    await wait(1300);
    S.tasks = TASKS.slice();
    toolDone(t, '4 tasks, each linked to the paste it came from. Owners picked from the who-does-what list in Claude’s briefing.',
      details('The call', pretty({ tasks: TASKS })));
    S.tasks.forEach(taskOnCard);
    renderTasks();
    setTab('tasks');
    S.stage = 2;
    S.busy = false;
    await wait(700);
    say('wpd-says', icon('sparkles') + '<span>Four tasks, each on whoever owns that area. Everyone on one has a note in their Inbox.</span>');
    showToast('4 new tasks from the Paste bin — Tio, Adrian, Dhafin and Fazry, they’re in your Inbox.');
    setPrompt();
    updateSteps();
  }

  function guard(fn) {
    return function () {
      fn().catch(function (err) { if (err !== CANCEL) throw err; });
    };
  }

  sendBtn.addEventListener('click', function () {
    if (S.busy) return;
    if (S.stage === 0) guard(organise)();
    else if (S.stage === 1) guard(handOut)();
    else reset();
  });

  copyBtn.addEventListener('click', function () {
    try { if (navigator.clipboard) navigator.clipboard.writeText(ASK.organise).catch(function () {}); } catch (e) { /* the prompt is on screen anyway */ }
    copyBtn.classList.add('is-copied');
    copyLabel.textContent = 'Copied — paste it into Claude';
    sendBtn.classList.remove('is-nudge');
    void sendBtn.offsetWidth;
    sendBtn.classList.add('is-nudge');
    setTimeout(function () {
      copyBtn.classList.remove('is-copied');
      copyLabel.textContent = 'Copy prompt to organize';
    }, 2500);
  });

  /* ── Start, and start over ──────────────────────────────────────────── */

  function reset() {
    run++;
    cancelAnimationFrame(frame);
    S = fresh();
    S.mapShown = layoutNow();
    log.innerHTML = '<li class="wpd-hint">Claude can read and write Waypoint through its MCP tools. Send the message below to start.</li>';
    hideToast();
    mapDot.hidden = true;
    renderPastes();
    renderTasks();
    setTab('pastes');
    setPrompt();
    updateSteps();
  }

  if (resetBtn) resetBtn.addEventListener('click', reset);
  reset();
})();
