/*
 * RideCheck case study: the 3D explorer's controls, the auto-tracking scene,
 * the sticky feature tour and the journey line.
 *
 * three.js and the model (~750 kB together) load only when the explorer is
 * about to scroll into view — nothing above it pays for it.
 */
import { PAINTS, PARTS, ZONES } from '../ride3d/parts.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const icon = (name) => (window.SITE && window.SITE.icon ? window.SITE.icon(name) : '');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ── 3D explorer ─────────────────────────────────────────────────────── */

function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (error) {
    return false;
  }
}

function initExplorer() {
  const stageEl = document.querySelector('[data-r3d]');
  if (!stageEl) return;

  const canvasHost = stageEl.querySelector('[data-r3d-canvas]');
  const labelLayer = stageEl.querySelector('[data-r3d-labels]');
  const loading = stageEl.querySelector('[data-r3d-loading]');
  const bar = stageEl.querySelector('[data-r3d-bar]');
  const gate = stageEl.querySelector('[data-r3d-gate]');
  const done = stageEl.querySelector('[data-r3d-done]');
  const reset = stageEl.querySelector('[data-r3d-reset]');
  const paintEl = stageEl.querySelector('[data-r3d-paint]');
  const rail = document.querySelector('[data-r3d-zones]');
  const hint = document.querySelector('[data-r3d-hint]');
  const detail = document.querySelector('[data-r3d-detail]');

  let stage = null;
  let zoneId = null;
  let selected = null;
  let paint = PAINTS[0].hex;
  // On touch screens a vertical swipe must scroll the page, not spin the car,
  // until the visitor opts in.
  let unlocked = !coarse;

  /* Zone chips */
  const chipDefs = [{ id: null, label: 'Overview' }].concat(ZONES.map((z) => ({ id: z.id, label: z.label })));
  rail.innerHTML = chipDefs
    .map((c) => `<button class="r3d__zone rc-glass" type="button" data-zone="${c.id || ''}" aria-pressed="${c.id === null}">${c.label}</button>`)
    .join('');
  rail.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-zone]');
    if (!btn) return;
    selectZone(btn.getAttribute('data-zone') || null);
  });

  /* Paint swatches */
  paintEl.innerHTML = PAINTS.map(
    (p) => `<button class="r3d__swatch" type="button" data-paint="${p.hex}" aria-label="${p.label}" aria-pressed="${p.hex === paint}"><span style="background:${p.hex}"></span></button>`,
  ).join('');
  paintEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-paint]');
    if (!btn) return;
    paint = btn.getAttribute('data-paint');
    paintEl.querySelectorAll('[data-paint]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    if (stage) stage.setPaint(paint);
  });

  function selectZone(id) {
    zoneId = id;
    selected = null;
    if (stage) stage.setZone(id);
    rail.querySelectorAll('[data-zone]').forEach((b) => b.setAttribute('aria-pressed', String((b.getAttribute('data-zone') || null) === id)));
    render();
  }

  function selectPart(key) {
    selected = key;
    if (stage) stage.setSelected(key);
    renderDetail();
  }

  function renderDetail() {
    const info = selected ? PARTS[selected] : null;
    const zone = zoneId ? ZONES.find((z) => z.id === zoneId) : null;
    if (info) {
      detail.innerHTML =
        `<div class="r3d-card rc-glass">` +
        `<div class="r3d-card__head"><h3>${info.label}</h3><button class="r3d-card__close" type="button" aria-label="Close" data-r3d-close>${icon('x')}</button></div>` +
        `<p>${info.blurb}</p>` +
        `<div class="r3d-card__interval"><span>Typical interval</span><b>${info.interval}</b></div>` +
        `</div>`;
      detail.querySelector('[data-r3d-close]').addEventListener('click', () => selectPart(null));
    } else if (zone) {
      detail.innerHTML =
        `<div class="r3d-parts">` +
        zone.parts.map((k) => `<button type="button" data-part="${k}">${PARTS[k].label}</button>`).join('') +
        `</div>`;
      detail.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => selectPart(b.getAttribute('data-part'))));
    } else {
      detail.innerHTML = `<p class="r3d-idle">Every one of these is tracked automatically in RideCheck.</p>`;
    }
  }

  function render() {
    const ready = !!stage;
    reset.hidden = !zoneId;
    paintEl.classList.toggle('is-hidden', !ready || !!zoneId || !unlocked);
    gate.hidden = !ready || !coarse || unlocked;
    done.hidden = !ready || !coarse || !unlocked;
    hint.textContent = zoneId
      ? 'Tap a labelled part'
      : coarse
        ? unlocked
          ? 'Drag to orbit · Pick an area below'
          : 'Tap the stage to explore · Pick an area below'
        : 'Drag to orbit · Pick an area below';
    renderDetail();
  }

  gate.addEventListener('click', () => {
    unlocked = true;
    if (stage) stage.setInteractive(true);
    render();
  });
  done.addEventListener('click', () => {
    unlocked = false;
    if (stage) stage.setInteractive(false);
    render();
  });
  reset.addEventListener('click', () => selectZone(null));

  render();

  function fallback() {
    // No WebGL (or it failed): everything the stage communicates is content,
    // not geometry, so it is laid out directly and stays interactive.
    loading.remove();
    stageEl.style.height = 'auto';
    stageEl.innerHTML =
      `<p class="small faint" style="max-width:560px;margin:0 auto 20px;text-align:center">Hardware acceleration is off in this browser, so the 3D view can’t run here — but everything it holds is below, and it’s live inside the app.</p>` +
      `<div class="r3d-map">` +
      ZONES.map(
        (z) =>
          `<div class="r3d-map__zone rc-glass"><p>${z.label}</p><div class="r3d-parts" style="justify-content:flex-start">` +
          z.parts.map((k) => `<button type="button" data-part="${k}">${PARTS[k].label}</button>`).join('') +
          `</div></div>`,
      ).join('') +
      `</div>`;
    stageEl.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => selectPart(b.getAttribute('data-part'))));
    rail.remove();
    hint.remove();
    renderDetail();
  }

  async function boot() {
    if (!webglAvailable()) {
      fallback();
      return;
    }
    try {
      const { createStage } = await import('../ride3d/stage.js');
      stage = await createStage({
        container: canvasHost,
        labelLayer,
        modelUrl: 'Assets/models/ridecheck-car.glb',
        reducedMotion,
        onSelect: selectPart,
        onProgress: (p) => bar && bar.style.setProperty('--load', String(Math.max(0.05, p))),
      });
      stage.setPaint(paint);
      stage.setInteractive(unlocked);
      if (zoneId) stage.setZone(zoneId);
      loading.classList.add('is-done');
      render();

      // Stop the render loop dead when the stage is off screen.
      new IntersectionObserver(([entry]) => stage.setActive(entry.isIntersecting), { rootMargin: '120px 0px' }).observe(stageEl);
    } catch (error) {
      console.error('[RideCheck 3D]', error);
      if (stage) stage.dispose();
      stage = null;
      fallback();
    }
  }

  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near.disconnect();
        boot();
      },
      { rootMargin: '700px 0px' },
    );
    near.observe(stageEl);
  } else {
    boot();
  }
}

/* ── Auto-tracking scene ─────────────────────────────────────────────── */

function initTracking() {
  const scene = document.querySelector('[data-track]');
  if (!scene) return;

  const route = scene.querySelector('[data-track-route]');
  const dot = scene.querySelector('[data-track-dot]');
  const halo = scene.querySelector('[data-track-halo]');
  const fence = scene.querySelector('[data-track-fence]');
  const odo = scene.querySelector('[data-track-odo]');
  const motion = scene.querySelector('[data-track-motion]');
  const motionLabel = scene.querySelector('[data-track-motion-label]');
  const notify = scene.querySelector('[data-track-notify]');
  const steps = Array.from(scene.querySelectorAll('[data-track-step]'));
  const wear = Array.from(scene.querySelectorAll('[data-wear]')).map((row) => ({
    row,
    from: parseFloat(row.getAttribute('data-wear')),
    to: parseFloat(row.getAttribute('data-wear-to')),
    fill: row.querySelector('.rc-wear__fill'),
    pct: row.querySelector('.rc-wear__pct'),
  }));

  const length = route.getTotalLength();
  route.style.strokeDasharray = `${length}`;
  const START_KM = 25600;
  const TRIP_KM = 18.4;
  let lastStep = -1;

  function draw(p) {
    const drive = clamp((p - 0.14) / 0.62, 0, 1);
    route.style.strokeDashoffset = `${length * (1 - drive)}`;
    const point = route.getPointAtLength(length * drive);
    dot.setAttribute('cx', point.x.toFixed(1));
    dot.setAttribute('cy', point.y.toFixed(1));
    halo.setAttribute('cx', point.x.toFixed(1));
    halo.setAttribute('cy', point.y.toFixed(1));
    fence.style.opacity = String(clamp(1 - drive * 4, 0, 1));

    const moving = p > 0.08 && drive < 1;
    motion.classList.toggle('is-on', moving);
    motionLabel.textContent = drive >= 1 ? 'Trip saved' : moving ? 'Automotive · high confidence' : 'Stationary';

    const km = START_KM + TRIP_KM * drive;
    odo.textContent = km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    for (const w of wear) {
      const life = w.from + (w.to - w.from) * drive;
      w.fill.style.setProperty('--life', life.toFixed(3));
      w.pct.textContent = `${Math.round(life * 100)}%`;
      w.row.classList.toggle('is-soon', life < 0.2);
    }

    notify.classList.toggle('is-on', p > 0.8);

    const step = p < 0.2 ? 0 : p < 0.46 ? 1 : p < 0.74 ? 2 : 3;
    if (step !== lastStep) {
      lastStep = step;
      steps.forEach((s, i) => {
        s.classList.toggle('is-active', i === step);
        s.classList.toggle('is-done', i < step);
      });
    }
  }

  if (reducedMotion) {
    draw(1);
    steps.forEach((s) => s.classList.add('is-active'));
    return;
  }
  draw(0);
  scene.addEventListener('scene', (event) => draw(event.detail));
}

/* ── Sticky feature tour ─────────────────────────────────────────────── */

function initTour() {
  const tour = document.querySelector('[data-tour]');
  if (!tour || !('IntersectionObserver' in window)) return;
  const steps = Array.from(tour.querySelectorAll('[data-tour-step]'));
  const screens = Array.from(tour.querySelectorAll('.rc-tour__screens img'));

  function setActive(index) {
    steps.forEach((s, i) => s.classList.toggle('is-active', i === index));
    screens.forEach((img, i) => img.classList.toggle('is-active', i === index));
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(steps.indexOf(entry.target));
      });
    },
    { rootMargin: '-48% 0px -48% 0px' },
  );
  steps.forEach((s) => io.observe(s));
}

/* ── Journey line ────────────────────────────────────────────────────── */

function initJourney() {
  const journey = document.querySelector('[data-journey]');
  if (!journey) return;
  // Fills as the list passes the reader's eye line, not the viewport top.
  let queued = false;
  function update() {
    queued = false;
    const rect = journey.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = clamp((vh * 0.62 - rect.top) / rect.height, 0, 1);
    journey.style.setProperty('--p', p.toFixed(4));
  }
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request, { passive: true });
  update();
}

initExplorer();
initTracking();
initTour();
initJourney();
