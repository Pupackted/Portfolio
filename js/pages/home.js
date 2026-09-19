/*
 * Home page: the code texture behind the hero, the lamp that lights it, and
 * the dock.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ── Code texture ───────────────────────────────────────────────────── */

  // Illustrative code in the shape of the real thing: a SwiftUI card, a
  // motion-gated trip detector, and the Android background task.
  var SNIPPETS = [
    [
      'import SwiftUI',
      '',
      'struct ComponentCard: View {',
      '    let component: Component',
      '    @State private var appeared = false',
      '',
      '    var body: some View {',
      '        VStack(alignment: .leading, spacing: 12) {',
      '            Label(component.name, systemImage: component.symbol)',
      '                .font(.headline)',
      '',
      '            HealthRing(progress: component.health)',
      '                .frame(width: 64, height: 64)',
      '',
      '            Text("\\(component.remainingKm) km left")',
      '                .foregroundStyle(.secondary)',
      '        }',
      '        .padding(20)',
      '        .background(.regularMaterial, in: .rect(cornerRadius: 24))',
      '        .scaleEffect(appeared ? 1 : 0.96)',
      '        .onAppear {',
      '            withAnimation(.spring(duration: 0.5)) { appeared = true }',
      '        }',
      '    }',
      '}',
      '',
      'struct HealthRing: View {',
      '    var progress: Double',
      '',
      '    var body: some View {',
      '        Circle()',
      '            .trim(from: 0, to: progress)',
      '            .stroke(tint, style: .init(lineWidth: 6, lineCap: .round))',
      '            .rotationEffect(.degrees(-90))',
      '    }',
      '}',
    ],
    [
      'import CoreMotion',
      'import CoreLocation',
      '',
      'final class TripDetector: NSObject {',
      '    private let motion = CMMotionActivityManager()',
      '    private let location = CLLocationManager()',
      '',
      '    // Wake on significant location changes,',
      '    // not a GPS radio that never sleeps.',
      '    func start() {',
      '        location.startMonitoringSignificantLocationChanges()',
      '        motion.startActivityUpdates(to: .main) { [weak self] activity in',
      '            guard let activity, activity.automotive,',
      '                  activity.confidence != .low else { return }',
      '            self?.beginTrip()',
      '        }',
      '    }',
      '',
      '    private func beginTrip() {',
      '        let fence = CLCircularRegion(center: lastStop,',
      '                                     radius: 150,',
      '                                     identifier: "departure")',
      '        location.startMonitoring(for: fence)',
      '        odometer.resume(from: .now)',
      '    }',
      '}',
    ],
    [
      "import * as TaskManager from 'expo-task-manager';",
      "import * as Location from 'expo-location';",
      '',
      'TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {',
      '  if (error) return;',
      '  const { locations } = data as { locations: LocationObject[] };',
      '',
      '  const km = distanceAlong(locations);',
      '  if (km < 0.05) return;',
      '',
      '  await db',
      '    .update(vehicles)',
      '    .set({ odometer: sql`${vehicles.odometer} + ${km}` })',
      '    .where(eq(vehicles.id, activeVehicleId()));',
      '',
      '  await scheduleDueReminders();',
      '});',
      '',
      'export function PartLabel({ part, visible }: Props) {',
      '  return (',
      '    <Html center zIndexRange={[20, 0]}>',
      '      <button className="glass-chip" data-visible={visible}>',
      '        {part.label}',
      '      </button>',
      '    </Html>',
      '  );',
      '}',
    ],
  ];

  var KEYWORDS = /^(import|struct|class|final|let|var|private|func|return|guard|else|if|self|some|in|async|await|const|export|function|true|false|nil|null|as|from|new|weak|extends|init|static|for|while|case|switch|default|throws|try)$/;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(@\w+)|(\b\d+(?:\.\d+)?\b)|(\.[a-z]\w*)|(\b[A-Za-z_]\w*\b)/g;

  function highlight(line) {
    var out = '';
    var last = 0;
    line.replace(TOKEN, function (m, comment, str, attr, num, prop, word, offset) {
      out += escapeHtml(line.slice(last, offset));
      last = offset + m.length;
      var cls = '';
      if (comment) cls = 'tok-c';
      else if (str) cls = 'tok-s';
      else if (attr) cls = 'tok-a';
      else if (num) cls = 'tok-n';
      else if (prop) cls = 'tok-p';
      else if (word) {
        if (KEYWORDS.test(word)) cls = 'tok-k';
        else if (/^[A-Z]/.test(word)) cls = 'tok-t';
        else if (line.charAt(offset + m.length) === '(') cls = 'tok-f';
      }
      out += cls ? '<span class="' + cls + '">' + escapeHtml(m) + '</span>' : escapeHtml(m);
      return m;
    });
    return out + escapeHtml(line.slice(last));
  }

  function buildCode() {
    var host = document.querySelector('[data-hero-code]');
    if (!host) return null;

    // Repeat each snippet so the columns run past the fold on tall screens.
    var cols = SNIPPETS.map(function (lines) { return lines.concat([''], lines); });

    var lit = document.createElement('div');
    lit.className = 'code-cols code-cols--lit';
    var dim = document.createElement('div');
    dim.className = 'code-cols code-cols--dim';

    cols.forEach(function (lines) {
      var a = document.createElement('pre');
      a.innerHTML = lines.map(highlight).join('\n');
      lit.appendChild(a);
      var b = document.createElement('pre');
      b.textContent = lines.join('\n');
      dim.appendChild(b);
    });

    var lamp = document.createElement('div');
    lamp.className = 'hero__lamp';

    host.appendChild(lit);
    host.appendChild(lamp);
    host.appendChild(dim);
    return { host: host, lamp: lamp };
  }

  function initLamp() {
    var built = buildCode();
    if (!built) return;
    var hero = document.querySelector('[data-hero]');
    var lamp = built.lamp;

    var rect = hero.getBoundingClientRect();
    var target = { x: rect.width * 0.78, y: rect.height * 0.38 };
    var pos = { x: target.x, y: target.y };
    var visible = true;
    var userMoved = false;
    var t0 = performance.now();

    function place() {
      lamp.style.transform = 'translate3d(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px,0)';
    }
    place();

    if (reducedMotion) return;

    if (finePointer) {
      window.addEventListener('pointermove', function (e) {
        if (!visible) return;
        var r = hero.getBoundingClientRect();
        target.x = e.clientX - r.left;
        target.y = e.clientY - r.top;
        userMoved = true;
      }, { passive: true });
    }

    var running = false;
    function start() {
      if (running) return;
      running = true;
      requestAnimationFrame(loop);
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start();
      }).observe(hero);
    }

    function loop(now) {
      if (!visible) {
        running = false;
        return;
      }
      if (!userMoved) {
        // Drift on a slow Lissajous path until the pointer takes over — and
        // forever on touch screens, which have no pointer to follow.
        var r = hero.getBoundingClientRect();
        var t = (now - t0) / 1000;
        target.x = r.width * (0.76 + 0.16 * Math.sin(t * 0.23));
        target.y = r.height * (0.42 + 0.2 * Math.sin(t * 0.31 + 1.2));
      }
      pos.x += (target.x - pos.x) * 0.085;
      pos.y += (target.y - pos.y) * 0.085;
      place();
      requestAnimationFrame(loop);
    }
    start();
  }

  /* ── Dock ───────────────────────────────────────────────────────────── */

  function initDock() {
    var dock = document.querySelector('[data-dock]');
    if (!dock) return;
    var items = Array.prototype.slice.call(dock.querySelectorAll('.dock__item'));

    // A little launch bounce before the page changes, as a Mac app would.
    dock.querySelectorAll('[data-launch]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (reducedMotion || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        a.classList.add('is-launching');
        setTimeout(function () { window.location.href = a.getAttribute('href'); }, 430);
      });
    });

    if (!finePointer || reducedMotion) return;

    var base = parseFloat(getComputedStyle(dock).getPropertyValue('--base')) || 54;
    var max = base * 1.62;
    var range = 150;
    var pointerX = null;
    var raf = 0;

    function frame() {
      raf = 0;
      if (pointerX === null) return;
      items.forEach(function (item) {
        var r = item.getBoundingClientRect();
        var d = Math.abs(pointerX - (r.left + r.width / 2));
        var k = Math.max(0, 1 - d / range);
        var eased = k * k * (3 - 2 * k);
        item.style.setProperty('--size', (base + (max - base) * eased).toFixed(1) + 'px');
      });
    }

    dock.addEventListener('pointermove', function (e) {
      pointerX = e.clientX;
      dock.classList.add('is-magnifying');
      if (!raf) raf = requestAnimationFrame(frame);
    });

    dock.addEventListener('pointerleave', function () {
      pointerX = null;
      dock.classList.remove('is-magnifying');
      items.forEach(function (item) { item.style.removeProperty('--size'); });
    });
  }

  function boot() {
    initLamp();
    initDock();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
