/*
 * Void: a live particle field, ported from the app's void.js.
 *
 * spawn(), seedField(), partColor(), sizeCanvas() and the four draw routines
 * below are Void's own, with one change: the browser window (innerWidth /
 * innerHeight) is swapped for the size of this box (W / H). The performance
 * care comes with them — device pixel ratio capped at 1.5, particle count
 * scaled by area with per-mode caps, no pointer work while the field isn't
 * running, and the canvas memory handed back when it scrolls away or the tab
 * is hidden. The greeting rules are Void's too, minus the ones that need
 * weather, tasks or visit history.
 *
 * Only the scaffolding is new: a pause button, a still frame for reduced
 * motion, and an invisible cursor that drifts when yours isn't over the field.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-void-demo]');
  if (!root) return;

  var stage = root.querySelector('[data-stage]');
  var canvas = stage.querySelector('canvas');
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var all = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── From void.js: themes, field defaults ────────────────────────────── */

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // Six of Void's eighteen themes, values unchanged.
  const THEMES = {
    ink:      { label:"Ink",       accent:"#7AA2F7", dim:40,
      css:"radial-gradient(120% 90% at 50% -10%, #0d1430 0%, #03050c 55%, #000 100%)",
      fx:{ field:"stars", grain:false } },
    tokyo:    { label:"Tokyo Night", accent:"#7AA2F7", dim:30,
      css:"radial-gradient(120% 90% at 50% 0%, #24283b 0%, #1a1b26 58%, #16161e 100%)",
      fx:{ field:"constellation", grain:false } },
    deepsea:  { label:"Deep sea",  accent:"#5EE7DF", dim:40,
      css:"radial-gradient(120% 90% at 70% 110%, #062a33 0%, #03121a 50%, #000 100%)",
      fx:{ field:"fireflies", grain:false } },
    ember:    { label:"Ember",     accent:"#FFB86C", dim:40,
      css:"radial-gradient(110% 85% at 15% 105%, #331206 0%, #150703 48%, #000 100%)",
      fx:{ field:"fireflies", grain:true } },
    terminal: { label:"Terminal",  accent:"#33FF88", dim:30,
      css:"radial-gradient(130% 95% at 50% 100%, #06170e 0%, #030805 55%, #000 100%)",
      fx:{ field:"constellation", grain:true } },
    nebula:   { label:"Nebula",    accent:"#B48EFF", dim:40,
      css:"radial-gradient(110% 80% at 20% 0%, #1a0a2e 0%, #07030f 52%, #000 100%)",
      fx:{ field:"stars", grain:false } }
  };

  const FIELD_DEFAULT = { mode:"stars", density:70, speed:100, size:100, parallax:100, glow:true, color:"mixed" };
  /* Some modes cost more per particle than others; cap them independently of
     the density slider so the knob stays usable across every mode. */
  const FIELD_CAP = { constellation:110, meteors:26, bokeh:60, bubbles:90, vortex:240 };

  // The slice of Void's settings object the field reads. Density and size start
  // above Void's defaults (70 and 100) — both are ordinary settings in the app —
  // so a box this small still has a sky's worth of particles in it.
  const S = { accent: THEMES.ink.accent, fx: { grain: false, field: Object.assign({}, FIELD_DEFAULT, { density: 150, size: 130 }) } };

  /* A theme names a field mode, but the user's density/speed/etc. are theirs —
     merge rather than replacing the whole object with the theme's string. */
  function applyThemeFx(t){
    S.fx.grain = t.fx.grain;
    S.fx.field = Object.assign({}, FIELD_DEFAULT, S.fx.field, { mode: t.fx.field });
  }

  /* ── From void.js: the particle field ────────────────────────────────── */

  let parts = [], rafId = null;
  let mx = 0, my = 0, tx = 0, ty = 0;         // normalised pointer + eased parallax
  let pxAbs = 0, pyAbs = 0;                   // absolute pointer, for orbit/constellation
  let W = 0, H = 0;                           // was innerWidth / innerHeight

  function fieldCfg(){ return Object.assign({}, FIELD_DEFAULT, S.fx.field); }

  function sizeCanvas(){
    // capping DPR at 1.5 roughly halves the fill cost on a retina display
    // and is indistinguishable for 1px dots
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = stage.clientWidth;
    H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(f, scatter){
    const z = Math.random() * .8 + .2;
    return {
      x: Math.random() * W,
      y: scatter ? Math.random() * H : -20,
      ox: 0, oy: 0,
      z,
      r: (Math.random() * 1.2 + .4) * (f.size / 100),
      p: Math.random() * Math.PI * 2,
      vx: (Math.random() - .5) * .5,
      vy: (Math.random() - .5) * .5,
      a: Math.random() * Math.PI * 2,
      orb: Math.random() * 210 + 40,
      len: Math.random() * 12 + 7,
      life: Math.random()
    };
  }

  // (The per-mode set-up for meteors, vortex, bokeh and bubbles is left out
  // with those modes.)
  function seedField(){
    const f = fieldCfg();
    const area = clamp((W * H) / (1440 * 900), .4, 2.2);
    let n = Math.round(clamp(f.density, 5, 300) * area);
    const cap = FIELD_CAP[f.mode];
    if (cap) n = Math.min(n, cap);
    parts = Array.from({ length: n }, () => spawn(f, true));
  }

  function partColor(f, p){
    if (f.color === "accent") return S.accent;
    if (f.color === "white") return "#ffffff";
    return p.z > .72 ? S.accent : "#ffffff";
  }

  /* ---------- per-mode draw routines ----------
     Each gets (f, t, sp, par): config, timestamp, speed factor, parallax factor.
     `tx`/`ty` hold the eased pointer offset; pxAbs/pyAbs the raw pointer.       */
  const FIELD_DRAW = {

    stars(f, t, sp, par){
      for (const p of parts){
        p.y -= sp * .28 * p.z * (p.r + .4);
        if (p.y < -4){ p.y = H + 4; p.x = Math.random() * W; }
        const x = p.x + tx * p.z * 26 * par;
        const y = p.y + ty * p.z * 20 * par;
        ctx.globalAlpha = (.45 + .55 * Math.abs(Math.sin(t / 1400 + p.p))) * p.z * .8;
        ctx.fillStyle = partColor(f, p);
        ctx.beginPath(); ctx.arc(x, y, p.r * p.z, 0, Math.PI * 2); ctx.fill();
      }
    },

    fireflies(f, t, sp, par){
      const glow = f.glow && parts.length <= 140;
      if (glow) ctx.shadowBlur = 12;
      for (const p of parts){
        p.x += Math.cos(t / 2600 + p.p) * .42 * sp;
        p.y += Math.sin(t / 3100 + p.p * 1.7) * .38 * sp - sp * .07;
        if (p.y < -8) p.y = H + 8;
        if (p.y > H + 8) p.y = -8;
        if (p.x < -8) p.x = W + 8;
        if (p.x > W + 8) p.x = -8;
        const x = p.x + tx * p.z * 26 * par;
        const y = p.y + ty * p.z * 20 * par;
        const col = partColor(f, p);
        ctx.globalAlpha = (.2 + .8 * Math.abs(Math.sin(t / 900 + p.p))) * p.z;
        ctx.fillStyle = col;
        if (glow) ctx.shadowColor = col;
        ctx.beginPath(); ctx.arc(x, y, p.r * p.z, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    },

    constellation(f, t, sp, par){
      const D = 118, D2 = D * D;
      for (const p of parts){
        p.x += p.vx * sp * .55;
        p.y += p.vy * sp * .55;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      ctx.lineWidth = .7;
      ctx.strokeStyle = S.accent;
      for (let i = 0; i < parts.length; i++){
        const a = parts[i];
        for (let j = i + 1; j < parts.length; j++){
          const b = parts[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > D2) continue;
          ctx.globalAlpha = (1 - d2 / D2) * .22;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        const cdx = a.x - pxAbs, cdy = a.y - pyAbs, cd2 = cdx * cdx + cdy * cdy;
        if (cd2 < 168 * 168){
          ctx.globalAlpha = (1 - cd2 / (168 * 168)) * .42;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pxAbs, pyAbs); ctx.stroke();
        }
        ctx.globalAlpha = .62;
        ctx.fillStyle = partColor(f, a);
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 1.1, 0, Math.PI * 2); ctx.fill();
      }
    },

    /* "Swarm": particles are pulled toward the cursor and pushed sideways, with
       damping. They lag and overshoot instead of being pinned to a rigid ring,
       which is what made the old fixed-ellipse orbit look mechanical. */
    orbit(f, t, sp, par){
      ctx.lineWidth = 1.1;
      for (const p of parts){
        const dx = pxAbs - p.x, dy = pyAbs - p.y;
        const d = Math.max(22, Math.sqrt(dx * dx + dy * dy));
        const ux = dx / d, uy = dy / d;
        // Spring, not inverse-square: the pull grows with distance so nothing
        // can escape. Swirl is strong only close in, so they circle near the
        // cursor and stream back toward it from far away.
        const attract = Math.min(d * .0016, .9) * sp;
        const swirl = Math.min(46 / d, .5) * sp;
        p.vx += ux * attract - uy * swirl;
        p.vy += uy * attract + ux * swirl;
        p.vx *= .94; p.vy *= .94;
        const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (v > 4.2){ p.vx = p.vx / v * 4.2; p.vy = p.vy / v * 4.2; }
        p.ox = p.x; p.oy = p.y;
        p.x += p.vx * (.6 + p.z * .8);
        p.y += p.vy * (.6 + p.z * .8);
        const col = partColor(f, p);
        // a short streak along the direction of travel reads as motion
        ctx.globalAlpha = .16 + p.z * .3;
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(p.ox, p.oy); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = .35 + p.z * .5;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.z * 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  /* ── Demo scaffolding ────────────────────────────────────────────────── */

  // With no cursor over the box, an invisible one drifts in a slow loop, so the
  // parallax, the constellation's cursor lines and the swarm have a target.
  let pointerIn = false, ghostAfter = 0;
  function ghost(t){
    if (pointerIn || t < ghostAfter) return;
    const gx = W / 2 + Math.cos(t / 5200) * W * .26;
    const gy = H / 2 + Math.sin(t / 3700) * H * .2;
    pxAbs += (gx - pxAbs) * .04;
    pyAbs += (gy - pyAbs) * .04;
    mx = (pxAbs / W - .5) * 2;
    my = (pyAbs / H - .5) * 2;
  }

  // One frame of Void's drawField(), without scheduling the next.
  function frame(t){
    const f = fieldCfg();
    const sp = f.speed / 100;
    const par = f.parallax / 100;

    ghost(t);
    tx += (mx - tx) * .045;
    ty += (my - ty) * .045;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";

    (FIELD_DRAW[f.mode] || FIELD_DRAW.stars)(f, t, sp, par);

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawField(t){
    rafId = requestAnimationFrame(drawField);
    frame(t);
  }

  // Paused or reduced motion: let the field settle for a second, keep one frame.
  function drawStill(){
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) frame(t0 + i * 16);
  }

  let inView = false;
  let alive = false;                  // has a backing store and a seeded field
  let paused = reduced.matches;

  function stop(){
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
  }

  // As in void.js: off screen or in a hidden tab, hand the backing store back
  // rather than just clearing it.
  function free(){
    canvas.width = canvas.height = 0;
    alive = false;
  }

  function sync(){
    if (!inView || document.hidden){
      stop();
      free();
    } else {
      if (!alive){
        sizeCanvas();
        if (!pxAbs && !pyAbs){ pxAbs = W / 2; pyAbs = H / 2; }
        seedField();
        alive = true;
        if (paused) drawStill();
      }
      if (paused) stop();
      else if (!rafId) rafId = requestAnimationFrame(drawField);
    }
    stage.classList.toggle('is-still', !rafId);
    readout();
  }

  // Mode, density, theme or size changed: a new field, as Void's startField() does.
  function restart(){
    alive = false;
    sync();
  }

  /* ── Readout ─────────────────────────────────────────────────────────── */

  var readoutEl = root.querySelector('[data-readout]');
  function readout(){
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const state = rafId ? 'running' : paused ? 'paused' : 'asleep';
    readoutEl.textContent = parts.length + ' particles · ' + (Math.round(dpr * 100) / 100) + '× canvas · ' + state;
  }

  /* ── Pointer ─────────────────────────────────────────────────────────── */

  function point(e){
    if (!rafId) return;   // as in void.js: no pointer work while the field isn't running
    const r = stage.getBoundingClientRect();
    pointerIn = true;
    pxAbs = (e.clientX - r.left) * (W / r.width);
    pyAbs = (e.clientY - r.top) * (H / r.height);
    mx = (pxAbs / W - .5) * 2;
    my = (pyAbs / H - .5) * 2;
    stage.classList.add('is-touched');
  }
  function leave(){
    pointerIn = false;
    ghostAfter = performance.now() + 1400;   // hold the last spot for a moment
  }
  stage.addEventListener('pointermove', point, { passive: true });
  stage.addEventListener('pointerdown', point, { passive: true });
  stage.addEventListener('pointerleave', leave);
  stage.addEventListener('pointercancel', leave);

  /* ── Controls ────────────────────────────────────────────────────────── */

  var modeBtns = all('[data-mode]');
  var themeBtns = all('[data-theme]');
  var pauseBtn = root.querySelector('[data-pause]');

  function syncModes(){
    const mode = fieldCfg().mode;
    modeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
  }

  function applyTheme(id){
    const t = THEMES[id];
    if (!t) return;
    S.accent = t.accent;
    applyThemeFx(t);
    root.style.setProperty('--vd-accent', t.accent);
    stage.style.setProperty('--vd-bg', t.css);
    stage.style.setProperty('--vd-dim', String(t.dim / 100));
    stage.classList.toggle('has-grain', !!S.fx.grain);
    themeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme') === id)); });
    syncModes();
  }

  // Paint each theme card from the same table, the way Void's gallery does.
  themeBtns.forEach(function (b) {
    const t = THEMES[b.getAttribute('data-theme')];
    if (!t) return;
    b.style.background = t.css;
    b.style.color = t.accent;
    b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme')); restart(); });
  });

  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      S.fx.field.mode = b.getAttribute('data-mode');
      syncModes();
      restart();
    });
  });

  all('[data-knob]').forEach(function (input) {
    const k = input.getAttribute('data-knob');
    const out = root.querySelector('[data-out="' + k + '"]');
    const show = function (v) {
      out.textContent = k === 'density' ? String(v) : v + '%';
      input.setAttribute('aria-valuetext', out.textContent);
    };
    input.value = S.fx.field[k];
    show(S.fx.field[k]);
    input.addEventListener('input', function () {
      const v = +input.value;
      S.fx.field[k] = v;
      show(v);
      if (k === 'density') restart();          // a new count needs a new field
      else if (paused && alive) drawStill();
    });
  });

  function setPaused(on){
    paused = on;
    pauseBtn.setAttribute('aria-pressed', String(on));
    sync();
  }
  pauseBtn.addEventListener('click', function () { setPaused(!paused); });
  pauseBtn.setAttribute('aria-pressed', String(paused));

  var onMotionPref = function (e) { setPaused(e.matches); };
  if (reduced.addEventListener) reduced.addEventListener('change', onMotionPref);
  else if (reduced.addListener) reduced.addListener(onMotionPref);

  /* ── Lifecycle ───────────────────────────────────────────────────────── */

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[entries.length - 1].isIntersecting;
      sync();
    }, { rootMargin: '80px 0px' }).observe(stage);
  } else {
    inView = true;
  }
  document.addEventListener('visibilitychange', function () { sync(); tickClock(); });

  let resizeTimer = null;
  if ('ResizeObserver' in window) {
    new ResizeObserver(function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (alive && (stage.clientWidth !== W || stage.clientHeight !== H)) restart();
      }, 180);
    }).observe(stage);
  }

  /* ── From void.js: clock and greeting ────────────────────────────────── */

  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function formatDate(d){
    return DAYS[d.getDay()] + " · " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  /* The clock is the only thing running every second, so it writes to the DOM
     only when a value actually changes. */
  var elHM = root.querySelector('[data-hm]');
  var elSec = root.querySelector('[data-sec]');
  var elDate = root.querySelector('[data-date]');
  const last = { hm:null, ss:null, date:null };
  let clockPainted = false;

  function tickClock(){
    // skip idle ticks while hidden (here: or scrolled away), but paint at least once
    if ((document.hidden || !inView) && clockPainted) return;
    clockPainted = true;
    const d = new Date();
    const hm = String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
    if (hm !== last.hm){ elHM.textContent = hm; last.hm = hm; }
    const ss = String(d.getSeconds()).padStart(2,"0");
    if (ss !== last.ss){ elSec.textContent = ss; last.ss = ss; }
    const ds = formatDate(d);
    if (ds !== last.date){ elDate.textContent = ds; last.date = ds; }
  }

  /* Every line is a template; {n} expands to ", <name>" when a name is set and
     to nothing when it isn't (there's no name here). Groups that need weather,
     tasks or visit history are left out. */
  const GREETS = [
    /* ---- deep night ---- */
    { w:1, when:c => c.h < 5, lines:[
      "Still up{n}", "Burning the midnight oil{n}", "The quiet hours{n}",
      "Nobody else is awake{n}", "Late one{n}", "The night shift{n}",
      "You should probably sleep{n}", "Insomnia or inspiration{n}?",
      "The world's asleep{n}", "Running on caffeine{n}?", "Small hours{n}",
      "Just five more minutes, right{n}?", "Deep in it{n}", "One more thing{n}?",
      "Nothing good happens after 2am{n}", "The city's quiet{n}",
      "Still here{n}", "Rest is a feature, not a bug{n}" ]},
    { w:2, when:c => c.h === 3, lines:[
      "3am hits different{n}", "The witching hour{n}", "Why are we awake{n}?",
      "3am lies{n}", "Nothing decided at 3am is true" ]},

    /* ---- the small hours ---- */
    { w:4, when:c => c.h < 4, lines:[
      "You're still here{n}",
      "It's late, not final",
      "This hour exaggerates",
      "You're doing better than this hour says",
      "Nothing needs solving tonight",
      "Give it until morning{n}",
      "Every night like this one has ended",
      "The dark isn't permanent",
      "Dawn's closer than it feels",
      "The sun's already up somewhere",
      "Someone else is awake too{n}",
      "Quiet isn't the same as alone",
      "Rest counts as progress",
      "Let it stay unfinished tonight",
      "Go easy on yourself{n}",
      "You've come through worse than tonight",
      "It'll weigh less in daylight",
      "The lights come back on. They always do.",
      "Whatever it is, it can wait for morning",
      "Sleep is allowed{n}",
      "You don't have to carry it right now",
      "Small hours. Small steps.",
      "There's another go at it tomorrow",
      "The night ends. It's the one thing it does." ]},

    /* ---- early morning ---- */
    { w:1, when:c => c.h >= 5 && c.h < 8, lines:[
      "Early start{n}", "Up before the sun{n}", "First light{n}",
      "Beat the alarm{n}?", "The early shift{n}", "Quiet morning{n}",
      "Fresh start{n}", "Morning{n}", "The day's yours{n}",
      "Nobody's emailed yet{n}", "Clean slate{n}" ]},

    /* ---- morning ---- */
    { w:1, when:c => c.h >= 8 && c.h < 12, lines:[
      "Good morning{n}", "Morning{n}", "Let's get into it{n}", "Coffee first{n}?",
      "Ready when you are{n}", "Another one{n}", "Let's make it count{n}",
      "Fresh page{n}", "What's first{n}?", "Easing in{n}?",
      "The good hours{n}", "Plenty of day left{n}" ]},

    /* ---- midday ---- */
    { w:1, when:c => c.h >= 12 && c.h < 14, lines:[
      "Good afternoon{n}", "Midday{n}", "Halfway there{n}", "Lunch yet{n}?",
      "Keep going{n}", "The day's in motion{n}", "Refuel{n}?", "Past the hump{n}" ]},

    /* ---- afternoon ---- */
    { w:1, when:c => c.h >= 14 && c.h < 17, lines:[
      "Good afternoon{n}", "Afternoon{n}", "The home stretch{n}", "Still going{n}",
      "Second wind{n}?", "Deep work hours{n}", "Steady on{n}",
      "The quiet productive stretch{n}", "Almost through it{n}" ]},

    /* ---- evening ---- */
    { w:1, when:c => c.h >= 17 && c.h < 21, lines:[
      "Good evening{n}", "Evening{n}", "Winding down{n}?", "Long day{n}?",
      "Made it{n}", "Time to slow down{n}", "Dinner soon{n}?",
      "Off the clock{n}?", "The day's easing off{n}", "Earned it{n}" ]},

    /* ---- night ---- */
    { w:1, when:c => c.h >= 21, lines:[
      "Good night{n}", "Late{n}", "Wrapping up{n}?", "Nearly tomorrow{n}",
      "One last thing{n}?", "Call it a day{n}?", "Winding down{n}",
      "The evening's yours{n}", "Still at it{n}?" ]},

    /* ---- weekday flavour ---- */
    { w:2, when:c => c.dow === 1 && c.h >= 5 && c.h < 18, lines:[
      "New week{n}", "Monday{n}", "Ease into it{n}", "Fresh week, fresh start{n}",
      "Monday again{n}", "Week one of one{n}" ]},
    { w:2, when:c => c.dow === 3, lines:[
      "Midweek{n}", "Over the hump{n}", "Wednesday{n}", "Halfway through{n}" ]},
    { w:2, when:c => c.dow === 5 && c.h >= 5, lines:[
      "Friday{n}", "Almost there{n}", "Nearly the weekend{n}",
      "Last push{n}", "Friday feeling{n}" ]},
    { w:2, when:c => (c.dow === 0 || c.dow === 6) && c.h >= 6, lines:[
      "Weekend{n}", "No standup today{n}", "Your time{n}", "Weekend mode{n}",
      "Nothing scheduled{n}", "Slow one{n}?", "Off duty{n}" ]},

    /* ---- developer flavour (only with Developer style on) ---- */
    { w:2, when:c => c.dev, lines:[
      "No errors so far{n}", "Ready for input{n}", "Awaiting instructions{n}",
      "Shell's warm{n}", "Build passing{n}", "Nothing on fire{n}",
      "All systems nominal{n}", "Zero unread errors{n}", "Uptime: good{n}",
      "Standing by{n}", "Everything compiles{n}", "No blockers{n}",
      "Working directory clean{n}", "Nothing to commit{n}" ]},
    { w:2, when:c => c.dev && c.dow === 5 && c.h >= 14, lines:[
      "Friday deploy{n}? Bold.", "Ship it and run{n}", "Freeze the branch{n}" ]},
    { w:2, when:c => c.dev && c.h < 5, lines:[
      "Merge conflicts with sleep{n}", "It works on your machine{n}",
      "The bug will still be there tomorrow{n}", "git commit -m \"later\"{n}" ]},

    /* ---- calendar ---- */
    { w:6, when:c => c.mon === 0 && c.date === 1, lines:[ "New year{n}", "Clean slate, new year{n}" ]},
    { w:5, when:c => c.date === 1, lines:[ "New month{n}", "Month one, day one{n}" ]},
    { w:4, when:c => c.mon === 11 && c.date > 20, lines:[ "Winding down the year{n}", "Year's nearly out{n}" ]}
  ];

  function greetContext(){
    const d = new Date();
    return { h: d.getHours(), dow: d.getDay(), date: d.getDate(), mon: d.getMonth(), dev: true };
  }

  let lastGreetLine = "";
  function pickGreeting(){
    const c = greetContext();
    const pool = [];

    GREETS.forEach(g => {
      let ok = false;
      try { ok = g.when(c); } catch(e){ ok = false; }
      if (!ok) return;
      g.lines.forEach(line => {
        for (let i = 0; i < (g.w || 1); i++) pool.push(line);
      });
    });

    if (!pool.length) pool.push("Hello{n}");

    // avoid repeating the line that's already on screen
    let choice = pool[Math.floor(Math.random() * pool.length)];
    for (let tries = 0; tries < 12 && choice === lastGreetLine && pool.length > 1; tries++){
      choice = pool[Math.floor(Math.random() * pool.length)];
    }
    lastGreetLine = choice;

    return choice.replace(/\{n\}/g, "");
  }

  var greetText = root.querySelector('[data-greet-text]');
  root.querySelector('[data-greet]').addEventListener('click', function () {
    greetText.textContent = pickGreeting();
  });

  /* ── Start ───────────────────────────────────────────────────────────── */

  applyTheme('ink');
  // Count the field before it's drawn, so the readout is right from the start.
  W = stage.clientWidth;
  H = stage.clientHeight;
  seedField();
  tickClock();
  setInterval(tickClock, 1000);
  greetText.textContent = pickGreeting();
  // Announce new lines when asked for, not the first one on page load.
  greetText.setAttribute('aria-live', 'polite');
  sync();
})();
