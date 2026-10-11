/*
 * Filter Generator: the live filter.
 *
 * createEngine() is a port of the app's apply_filter_logic() and of
 * Pixelated Kisses' filter from NumPy and Pillow to plain JavaScript: the same
 * steps in the same order, the same formulas, and the same 8-bit truncation
 * after every step. Where NumPy works in float32, so does this (Math.fround);
 * Pillow's GaussianBlur and BILINEAR resize are rebuilt from its C sources,
 * fixed-point rounding included.
 *
 * The engine runs in a Worker built from a Blob, so dragging a slider never
 * blocks the page. Without Workers it falls back to the main thread.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-filter-demo]');

  /* ═══ The engine ════════════════════════════════════════════════════════
     Self-contained: it is also serialised into the Worker, so it may not
     reach for anything outside itself. */

  function createEngine() {
    'use strict';

    var f32 = Math.fround;
    var now = (typeof performance !== 'undefined') ? function () { return performance.now(); } : Date.now;

    var W = 0, H = 0, N = 0, src = null, imageId = 0;
    var z1 = null, z3 = null, noiseGen = 0;   // cached standard normals (see note in the page)
    var S = null, lastKey = '', maskCache = null;

    /* ── NumPy, as used by the app ───────────────────────────────────── */

    // np.linspace(a, b, n): arange(n) * step + a, with the last value pinned to b.
    function linspace(a, b, n) {
      var out = new Float64Array(n);
      if (n === 1) { out[0] = a; return out; }
      var step = (b - a) / (n - 1);
      for (var i = 0; i < n; i++) out[i] = i * step + a;
      out[n - 1] = b;
      return out;
    }

    // np.interp for one value; xp is increasing.
    function interp(x, xp, fp) {
      var n = xp.length;
      if (x < xp[0]) return fp[0];
      if (x >= xp[n - 1]) return fp[n - 1];
      var j = 0;
      while (j < n - 2 && x >= xp[j + 1]) j++;
      if (x === xp[j]) return fp[j];
      var slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
      return slope * (x - xp[j]) + fp[j];
    }

    // np.clip(v, 0, 255).astype(np.uint8): clip, then truncate.
    function u8(v) { return v <= 0 ? 0 : v >= 255 ? 255 : Math.floor(v); }

    // Standard normals (Box–Muller). np.random.normal(0, s) is s times one of these.
    function normals(n) {
      var out = new Float32Array(n);
      for (var i = 0; i < n; i += 2) {
        var r = Math.sqrt(-2 * Math.log(1 - Math.random())), t = 2 * Math.PI * Math.random();
        out[i] = r * Math.cos(t);
        if (i + 1 < n) out[i + 1] = r * Math.sin(t);
      }
      return out;
    }

    /* ── Pillow: ImageFilter.GaussianBlur ────────────────────────────────
       Pillow approximates a Gaussian with three extended box blurs each way
       (BoxBlur.c), rounding to 8 bits after every pass. */

    function clampi(i, n) { return i < 0 ? 0 : i >= n ? n - 1 : i; }

    // _gaussian_blur_radius(radius, passes = 3), in C float arithmetic.
    function boxRadius(sigma) {
      var r = f32(sigma);
      var sigma2 = f32(f32(r * r) / 3);
      var L = f32(Math.sqrt(12.0 * sigma2 + 1.0));
      var l = f32(Math.floor((L - 1.0) / 2.0));
      var a = f32(f32(f32(2 * l) + 1) * f32(f32(l * f32(l + 1)) - f32(3 * sigma2)));
      a = f32(a / f32(6 * f32(sigma2 - f32(f32(l + 1) * f32(l + 1)))));
      return f32(l + a);
    }

    function gaussianBlur(p, w, h, sigma) {
      var fr = boxRadius(sigma);
      if (fr === 0) return p;
      var r = fr | 0;
      var ww = Math.floor(f32(16777216 / f32(f32(fr * 2) + 1)));
      var fw = Math.floor((16777216 - (r * 2 + 1) * ww) / 2);
      var a = p, b = new Uint8Array(w * h), c = new Uint8Array(w * h), t, x, y, k, i, o, s, acc;

      // Three passes along each row (ImagingLineBoxBlur, edges clamped).
      var sub = new Int32Array(w), add = new Int32Array(w), far = new Int32Array(w);
      for (x = 0; x < w; x++) { sub[x] = clampi(x - r - 1, w); add[x] = clampi(x + r, w); far[x] = clampi(x + r + 1, w); }
      for (var pass = 0; pass < 3; pass++) {
        for (y = 0; y < h; y++) {
          o = y * w; acc = 0;
          for (k = -r - 1; k <= r - 1; k++) acc += a[o + clampi(k, w)];
          for (x = 0; x < w; x++) {
            s = a[o + sub[x]];
            acc += a[o + add[x]] - s;
            b[o + x] = (acc * ww + (s + a[o + far[x]]) * fw + 8388608) >>> 24;
          }
        }
        t = (a === p) ? c : a; a = b; b = t;
      }

      // Then three down each column (Pillow transposes; same arithmetic).
      var subY = new Int32Array(h), addY = new Int32Array(h), farY = new Int32Array(h), accs = new Int32Array(w);
      for (y = 0; y < h; y++) { subY[y] = clampi(y - r - 1, h) * w; addY[y] = clampi(y + r, h) * w; farY[y] = clampi(y + r + 1, h) * w; }
      for (pass = 0; pass < 3; pass++) {
        accs.fill(0);
        for (k = -r - 1; k <= r - 1; k++) { o = clampi(k, h) * w; for (x = 0; x < w; x++) accs[x] += a[o + x]; }
        for (y = 0; y < h; y++) {
          var so = subY[y], ao = addY[y], fo = farY[y];
          o = y * w;
          for (x = 0; x < w; x++) {
            s = a[so + x];
            acc = accs[x] + a[ao + x] - s;
            accs[x] = acc;
            b[o + x] = (acc * ww + (s + a[fo + x]) * fw + 8388608) >>> 24;
          }
        }
        t = a; a = b; b = t;
      }
      return a;
    }

    /* ── Pillow: Image.resize(..., BILINEAR) on one 8-bit channel ──────────
       precompute_coeffs + normalize_coeffs_8bpc: weights in 22-bit fixed
       point, horizontal pass first, rounded to 8 bits in between. */

    function coeffs(inSize, outSize) {
      var scale = inSize / outSize, fs = scale < 1 ? 1 : scale;
      var support = fs, ss = 1 / fs, ksize = Math.ceil(support) * 2 + 1;
      var bounds = new Int32Array(outSize * 2), kk = new Int32Array(outSize * ksize), tmp = new Float64Array(ksize);
      for (var xx = 0; xx < outSize; xx++) {
        var center = (xx + 0.5) * scale;
        var xmin = Math.trunc(center - support + 0.5); if (xmin < 0) xmin = 0;
        var xmax = Math.trunc(center + support + 0.5); if (xmax > inSize) xmax = inSize;
        xmax -= xmin;
        var tot = 0, x;
        for (x = 0; x < xmax; x++) {
          var d = Math.abs((x + xmin - center + 0.5) * ss);
          tmp[x] = d < 1 ? 1 - d : 0;
          tot += tmp[x];
        }
        for (x = 0; x < xmax; x++) {
          var kv = tot !== 0 ? tmp[x] / tot : tmp[x];
          kk[xx * ksize + x] = kv < 0 ? Math.trunc(-0.5 + kv * 4194304) : Math.trunc(0.5 + kv * 4194304);
        }
        bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax;
      }
      return { ksize: ksize, bounds: bounds, kk: kk };
    }

    function clip8(ss) { return ss >= 1073741824 ? 255 : ss <= 0 ? 0 : ss >> 22; }

    function resize(p, w, h, ow, oh) {
      var out = p, x, y, i, ss, xmin, xmax, kb, c;
      if (ow !== w) {
        c = coeffs(w, ow);
        var hp = new Uint8Array(ow * h);
        for (y = 0; y < h; y++) {
          var row = y * w, orow = y * ow;
          for (x = 0; x < ow; x++) {
            xmin = c.bounds[x * 2]; xmax = c.bounds[x * 2 + 1]; kb = x * c.ksize; ss = 2097152;
            for (i = 0; i < xmax; i++) ss += out[row + xmin + i] * c.kk[kb + i];
            hp[orow + x] = clip8(ss);
          }
        }
        out = hp;
      }
      if (oh !== h) {
        c = coeffs(h, oh);
        var vp = new Uint8Array(ow * oh);
        for (y = 0; y < oh; y++) {
          xmin = c.bounds[y * 2]; xmax = c.bounds[y * 2 + 1]; kb = y * c.ksize;
          for (x = 0; x < ow; x++) {
            ss = 2097152;
            for (i = 0; i < xmax; i++) ss += out[(xmin + i) * ow + x] * c.kk[kb + i];
            vp[y * ow + x] = clip8(ss);
          }
        }
        out = vp;
      }
      return out;
    }

    /* ── Filter Generator: apply_filter_logic() ─────────────────────────── */

    var XP = [0, 0.25, 0.5, 0.75, 1.0];
    var TR = [0.03, 0.24, 0.52, 0.81, 0.99];
    var TG = [0.01, 0.21, 0.49, 0.77, 0.96];
    var TB = [0.00, 0.14, 0.38, 0.63, 0.82];
    var X256 = linspace(0, 1, 256);

    // 1. The colour-grading lookup table for one channel.
    function warmLut(warmth, T) {
      var w = warmth / 100.0, lut = new Uint8Array(256);
      for (var i = 0; i < 256; i++) {
        var x = X256[i], t = Math.min(1, Math.max(0, interp(x, XP, T)));
        lut[i] = u8(((1.0 - w) * x + w * t) * 255.0);
      }
      return lut;
    }

    // 2. Brightness, in float32 like the app (img.astype(np.float32) * b_factor).
    function brightTable(b) {
      var k = f32(1.0 + (b / 100.0) * 0.45), t = new Uint8Array(256);
      for (var v = 0; v < 256; v++) t[v] = u8(f32(v * k));
      return t;
    }

    // 3. Shadow fade, float32: v/255 * (1 - offset) + offset, back to 0–255.
    function fadeTable(fade) {
      var off = (fade / 100.0) * 0.12, a = f32(1.0 - off), c = f32(off), t = new Uint8Array(256);
      for (var v = 0; v < 256; v++) t[v] = u8(f32(f32(f32(f32(v / 255.0) * a) + c) * 255.0));
      return t;
    }

    // 4. The vignette mask, one value per pixel, in float64.
    function vignetteMask(v) {
      var key = W + 'x' + H + ':' + v;
      if (maskCache && maskCache.key === key) return maskCache.m;
      var k = (v / 100.0) * 0.45, ys = linspace(-1.0, 1.0, H), xs = linspace(-1.0, 1.0, W);
      var m = new Float64Array(N);
      for (var y = 0; y < H; y++) {
        var yy = ys[y] * ys[y], o = y * W;
        for (var x = 0; x < W; x++) {
          var d = Math.sqrt(xs[x] * xs[x] + yy) / Math.SQRT2;
          var q = 1.0 - k * (d * d);
          m[o + x] = q < 0 ? 0 : q > 1 ? 1 : q;
        }
      }
      maskCache = { key: key, m: m };
      return m;
    }

    var F299 = f32(0.299), F587 = f32(0.587), F114 = f32(0.114);
    function luma32(r, g, b) { return f32(f32(f32(F299 * r) + f32(F587 * g)) + f32(F114 * b)); }

    // Steps run in order, so a change only has to be redone from its own step
    // onwards: drag Glow and only the glow is recomputed.
    function firstChange(q, p) {
      return q.warmth !== p.warmth ? 1 : q.brightness !== p.brightness ? 2 : q.fade !== p.fade ? 3 :
        q.vignette !== p.vignette ? 4 : q.grain !== p.grain ? 5 : q.softness !== p.softness ? 6 : q.glow !== p.glow ? 8 : 9;
    }

    function renderFG(p) {
      var base = imageId + ':' + noiseGen;
      var prev = (S && S.mode === 'fg' && S.base === base) ? S : null;
      var from = prev ? firstChange(prev.p, p) : 1;
      var i, j, v, r, g, b, m, n, x, y;
      var lr, lg, lb, bt, ft, mask, sigma, R5, G5, B5, R6, G6, B6, R7, G7, B7;

      if (from <= 5) {
        lr = warmLut(p.warmth, TR); lg = warmLut(p.warmth, TG); lb = warmLut(p.warmth, TB);
        bt = p.brightness !== 0 ? brightTable(p.brightness) : null;
        ft = p.fade > 0 ? fadeTable(p.fade) : null;
        mask = p.vignette > 0 ? vignetteMask(p.vignette) : null;
        sigma = p.grain > 0 ? (p.grain / 100.0) * 20.0 : 0;

        // Steps 1–3 each map a value to a value, so they fold into one table.
        var cr = new Uint8Array(256), cg = new Uint8Array(256), cb = new Uint8Array(256);
        for (v = 0; v < 256; v++) {
          r = lr[v]; g = lg[v]; b = lb[v];
          if (bt) { r = bt[r]; g = bt[g]; b = bt[b]; }
          if (ft) { r = ft[r]; g = ft[g]; b = ft[b]; }
          cr[v] = r; cg[v] = g; cb[v] = b;
        }

        // 1–5 in one pass: table, vignette, monochrome grain.
        R5 = new Uint8Array(N); G5 = new Uint8Array(N); B5 = new Uint8Array(N);
        for (i = 0, j = 0; i < N; i++, j += 4) {
          r = cr[src[j]]; g = cg[src[j + 1]]; b = cb[src[j + 2]];
          if (mask) { m = mask[i]; r = Math.floor(r * m); g = Math.floor(g * m); b = Math.floor(b * m); }
          if (sigma) { n = z1[i] * sigma; r = u8(r + n); g = u8(g + n); b = u8(b + n); }
          R5[i] = r; G5[i] = g; B5[i] = b;
        }
      } else {
        lr = prev.lr; lg = prev.lg; lb = prev.lb; bt = prev.bt; ft = prev.ft; mask = prev.mask; sigma = prev.sigma;
        R5 = prev.planes[5][0]; G5 = prev.planes[5][1]; B5 = prev.planes[5][2];
      }

      if (from <= 7) {
        // 6. Lens softness.
        R6 = R5; G6 = G5; B6 = B5;
        if (p.softness > 0) {
          var radius = (p.softness / 100.0) * 2.2;
          R6 = gaussianBlur(R5, W, H, radius); G6 = gaussianBlur(G5, W, H, radius); B6 = gaussianBlur(B5, W, H, radius);
        }

        // 7. Chromatic aberration: red zoomed in, blue zoomed out, green untouched.
        R7 = R6; G7 = G6; B7 = B6;
        var ca = (p.softness / 100.0) * 1.0;
        if (ca > 0) {
          var rs = 1.0 + ca * 0.007, wr = Math.trunc(W * rs), hr = Math.trunc(H * rs);
          var big = resize(R6, W, H, wr, hr), lft = Math.floor((wr - W) / 2), top = Math.floor((hr - H) / 2);
          R7 = new Uint8Array(N);
          for (y = 0; y < H; y++) R7.set(big.subarray((y + top) * wr + lft, (y + top) * wr + lft + W), y * W);

          var bs = 1.0 - ca * 0.007, wb = Math.max(1, Math.trunc(W * bs)), hb = Math.max(1, Math.trunc(H * bs));
          var small = resize(B6, W, H, wb, hb), lb2 = Math.floor((W - wb) / 2), tb = Math.floor((H - hb) / 2);
          B7 = new Uint8Array(N);
          for (y = 0; y < hb; y++) B7.set(small.subarray(y * wb, y * wb + wb), (y + tb) * W + lb2);
        }
      } else {
        R6 = prev.planes[6][0]; G6 = prev.planes[6][1]; B6 = prev.planes[6][2];
        R7 = prev.planes[7][0]; G7 = prev.planes[7][1]; B7 = prev.planes[7][2];
      }

      // 8. Glow: highlights (luma over 180) blurred and added back.
      var R8 = R7, G8 = G7, B8 = B7, glowSigma = 0, gs = 0;
      if (p.glow > 0) {
        var hR = new Uint8Array(N), hG = new Uint8Array(N), hB = new Uint8Array(N);
        for (i = 0; i < N; i++) {
          r = R7[i]; g = G7[i]; b = B7[i];
          m = f32(f32(luma32(r, g, b) - 180.0) / 75.0);
          if (m <= 0) continue;
          if (m > 1) m = 1;
          hR[i] = u8(f32(r * m)); hG[i] = u8(f32(g * m)); hB[i] = u8(f32(b * m));
        }
        glowSigma = (p.glow / 100.0) * 20.0 + 5.0;
        hR = gaussianBlur(hR, W, H, glowSigma); hG = gaussianBlur(hG, W, H, glowSigma); hB = gaussianBlur(hB, W, H, glowSigma);
        gs = f32((p.glow / 100.0) * 0.75);
        R8 = new Uint8Array(N); G8 = new Uint8Array(N); B8 = new Uint8Array(N);
        for (i = 0; i < N; i++) {
          R8[i] = u8(f32(R7[i] + f32(hR[i] * gs)));
          G8[i] = u8(f32(G7[i] + f32(hG[i] * gs)));
          B8[i] = u8(f32(B7[i] + f32(hB[i] * gs)));
        }
      }

      S = {
        mode: 'fg', base: base, p: p, from: from,
        lr: lr, lg: lg, lb: lb, bt: bt, ft: ft, mask: mask, sigma: sigma, glowSigma: glowSigma, gs: gs,
        planes: [null, null, null, null, null, [R5, G5, B5], [R6, G6, B6], [R7, G7, B7], [R8, G8, B8]]
      };
    }

    /* ── Pixelated Kisses ──────────────────────────────────────────────── */

    // The 256-colour palette, built exactly as the app builds it. The white
    // key-frame after red is never reached, so white never appears.
    var PALETTE = (function () {
      var kf = [[0, [0, 0, 0]], [150, [73, 68, 62]], [255, [247, 57, 48]], [170, [242, 242, 242]]], pal = [];
      for (var i = 0; i < kf.length - 1; i++) {
        var sp = kf[i][0], sc = kf[i][1], ep = kf[i + 1][0], ec = kf[i + 1][1], steps = Math.max(1, ep - sp);
        for (var j = 0; j < steps; j++) {
          for (var c = 0; c < 3; c++) pal.push(Math.trunc(sc[c] + (ec[c] - sc[c]) * j / steps));
        }
      }
      while (pal.length < 768) pal.push(242, 242, 242);
      return Uint8Array.from(pal.slice(0, 768));
    })();

    // Pillow's convert('L'): ITU-R 601-2 luma in 16-bit fixed point, rounded.
    function grey(r, g, b) { return (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16; }

    function renderPK(p) {
      if (!z3) z3 = normals(3 * N);
      var sigma = p.pkgrain, size = p.pixel | 0, i, j, L, r, g, b;
      var R2 = new Uint8Array(N), G2 = new Uint8Array(N), B2 = new Uint8Array(N);
      for (i = 0, j = 0; i < N; i++, j += 4) {
        L = grey(src[j], src[j + 1], src[j + 2]) * 3;
        r = PALETTE[L]; g = PALETTE[L + 1]; b = PALETTE[L + 2];
        if (sigma > 0) { r = u8(r + z3[i * 3] * sigma); g = u8(g + z3[i * 3 + 1] * sigma); b = u8(b + z3[i * 3 + 2] * sigma); }
        R2[i] = r; G2[i] = g; B2[i] = b;
      }
      var R3 = R2, G3 = G2, B3 = B2;
      if (size > 1) {
        R3 = new Uint8Array(N); G3 = new Uint8Array(N); B3 = new Uint8Array(N);
        for (var by = 0; by < H; by += size) {
          var ey = Math.min(by + size, H);
          for (var bx = 0; bx < W; bx += size) {
            var ex = Math.min(bx + size, W), n = (ey - by) * (ex - bx), sr = 0, sg = 0, sb = 0, x, y;
            for (y = by; y < ey; y++) for (x = bx, i = y * W + bx; x < ex; x++, i++) { sr += R2[i]; sg += G2[i]; sb += B2[i]; }
            var ar = Math.floor(sr / n), ag = Math.floor(sg / n), ab = Math.floor(sb / n);
            for (y = by; y < ey; y++) for (x = bx, i = y * W + bx; x < ex; x++, i++) { R3[i] = ar; G3[i] = ag; B3[i] = ab; }
          }
        }
      }
      S = { mode: 'pk', p: p, sigma: sigma, size: size, planes: [null, null, [R2, G2, B2], [R3, G3, B3]] };
    }

    /* ── Reading results ─────────────────────────────────────────────── */

    // The image as it stands after step k (0 = the original).
    function stageImage(k) {
      var out = new Uint8ClampedArray(N * 4), i, j, v;
      var pl = S.planes[k];
      if (k === 0) { out.set(src); return out; }
      if (pl) {
        for (i = 0, j = 0; i < N; i++, j += 4) { out[j] = pl[0][i]; out[j + 1] = pl[1][i]; out[j + 2] = pl[2][i]; out[j + 3] = 255; }
        return out;
      }
      if (S.mode === 'pk') {   // 1: the gradient map alone
        for (i = 0, j = 0; i < N; i++, j += 4) {
          v = grey(src[j], src[j + 1], src[j + 2]) * 3;
          out[j] = PALETTE[v]; out[j + 1] = PALETTE[v + 1]; out[j + 2] = PALETTE[v + 2]; out[j + 3] = 255;
        }
        return out;
      }
      // FG 1–4: the folded table up to step k, then the vignette.
      var tr = new Uint8Array(256), tg = new Uint8Array(256), tb = new Uint8Array(256), r, g, b;
      for (v = 0; v < 256; v++) {
        r = S.lr[v]; g = S.lg[v]; b = S.lb[v];
        if (k >= 2 && S.bt) { r = S.bt[r]; g = S.bt[g]; b = S.bt[b]; }
        if (k >= 3 && S.ft) { r = S.ft[r]; g = S.ft[g]; b = S.ft[b]; }
        tr[v] = r; tg[v] = g; tb[v] = b;
      }
      var mask = k >= 4 ? S.mask : null;
      for (i = 0, j = 0; i < N; i++, j += 4) {
        r = tr[src[j]]; g = tg[src[j + 1]]; b = tb[src[j + 2]];
        if (mask) { v = mask[i]; r = Math.floor(r * v); g = Math.floor(g * v); b = Math.floor(b * v); }
        out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = 255;
      }
      return out;
    }

    // One pixel, followed through every step.
    function probe(pt) {
      if (!S || !pt) return null;
      var x = clampi(pt.x | 0, W), y = clampi(pt.y | 0, H), i = y * W + x, j = i * 4, k;
      var st = [[src[j], src[j + 1], src[j + 2]]], info = {};
      var at = function (pl) { return [pl[0][i], pl[1][i], pl[2][i]]; };
      if (S.mode === 'pk') {
        var L = grey(src[j], src[j + 1], src[j + 2]);
        st.push([PALETTE[L * 3], PALETTE[L * 3 + 1], PALETTE[L * 3 + 2]]);
        st.push(at(S.planes[2]));
        st.push(at(S.planes[3]));
        info.L = L;
        info.noise = S.sigma > 0 ? [z3[i * 3] * S.sigma, z3[i * 3 + 1] * S.sigma, z3[i * 3 + 2] * S.sigma] : null;
      } else {
        var s0 = st[0], s1 = [S.lr[s0[0]], S.lg[s0[1]], S.lb[s0[2]]];
        var s2 = S.bt ? [S.bt[s1[0]], S.bt[s1[1]], S.bt[s1[2]]] : s1;
        var s3 = S.ft ? [S.ft[s2[0]], S.ft[s2[1]], S.ft[s2[2]]] : s2;
        var m = S.mask ? S.mask[i] : 1;
        var s4 = S.mask ? [Math.floor(s3[0] * m), Math.floor(s3[1] * m), Math.floor(s3[2] * m)] : s3;
        st.push(s1, s2, s3, s4);
        for (k = 5; k <= 8; k++) st.push(at(S.planes[k]));
        var X = W > 1 ? (x === W - 1 ? 1 : x * (2 / (W - 1)) - 1) : -1;
        var Y = H > 1 ? (y === H - 1 ? 1 : y * (2 / (H - 1)) - 1) : -1;
        info.d = Math.sqrt(X * X + Y * Y) / Math.SQRT2;
        info.mask = S.mask ? m : null;
        info.noise = S.sigma ? z1[i] * S.sigma : null;
        var s7 = st[7];
        info.luma = luma32(s7[0], s7[1], s7[2]);
        info.glowMask = Math.min(1, Math.max(0, f32(f32(info.luma - 180.0) / 75.0)));
        info.glowSigma = S.glowSigma; info.gs = S.gs;
      }
      return { x: x, y: y, stages: st, info: info, p: S.p };
    }

    function handle(msg) {
      if (msg.type === 'image') {
        W = msg.w; H = msg.h; N = W * H; src = new Uint8ClampedArray(msg.buf);
        imageId++; z1 = normals(N); z3 = null; S = null; lastKey = ''; maskCache = null;
        return null;
      }
      if (msg.type === 'reroll') {
        if (src) { z1 = normals(N); z3 = null; }
        noiseGen++;
        return null;
      }
      if (!src) return null;
      if (msg.type === 'render') {
        var t0 = now(), key = msg.mode + '|' + JSON.stringify(msg.params) + '|' + imageId + '|' + noiseGen, ran = false;
        if (key !== lastKey) {
          var p = {};
          for (var k in msg.params) p[k] = msg.params[k];   // a copy: the caller may mutate its own
          if (msg.mode === 'pk') renderPK(p); else renderFG(p);
          lastKey = key; ran = true;
        }
        var img = stageImage(Math.min(msg.view, S.planes.length - 1));
        var ms = now() - t0;
        return {
          msg: { type: 'frame', photo: msg.photo, mode: msg.mode, w: W, h: H, buf: img.buffer, view: msg.view, ms: ran ? ms : null, probe: probe(msg.probe), purpose: msg.purpose || null },
          transfer: [img.buffer]
        };
      }
      if (msg.type === 'probe') return { msg: { type: 'probe', photo: msg.photo, mode: S ? S.mode : null, probe: probe(msg.probe) } };
      return null;
    }

    return { handle: handle, inspect: function () { return { W: W, H: H, z1: z1, z3: z3, palette: PALETTE }; } };
  }
  /* ═══ end of engine ═══ */

  // Exposed for the page's own checks; harmless otherwise.
  window.FilterEngine = createEngine;

  if (!root) return;

  /* ═══ The worker (or a stand-in on the main thread) ════════════════════ */

  function workerBoot(factory) {
    var engine = factory();
    self.onmessage = function (e) {
      var out = engine.handle(e.data);
      if (out) self.postMessage(out.msg, out.transfer || []);
    };
  }

  function localPort() {
    var engine = createEngine(), port = { onmessage: null, local: true };
    port.postMessage = function (msg) {
      setTimeout(function () {
        var out = engine.handle(msg);
        if (out && port.onmessage) port.onmessage({ data: out.msg });
      }, 0);
    };
    return port;
  }

  function makePort() {
    try {
      var code = '(' + workerBoot.toString() + ')(' + createEngine.toString() + ');';
      var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      var w = new Worker(url);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      return w;
    } catch (e) {
      return localPort();
    }
  }

  /* ═══ The demo ═════════════════════════════════════════════════════════ */

  var $ = function (s) { return root.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };

  var canvas = $('[data-canvas]'), ctx = canvas.getContext('2d');
  var stageEl = $('[data-stage]'), ring = $('[data-probe]'), badge = $('[data-badge]'), loading = $('[data-loading]');
  var pipeEl = $('[data-pipe]'), mathEl = $('[data-math]'), pxEl = $('[data-px]'), statEl = $('[data-stat]'), liveEl = $('[data-live]');
  var logoEl = $('[data-logo]'), fileInput = $('[data-file]'), ownBtn = $('[data-own]');
  var modeBtns = $$('[data-mode]'), viewBtns = $$('[data-view]'), photoBtns = $$('[data-photo]');
  var groups = { fg: $('[data-group="fg"]'), pk: $('[data-group="pk"]') };
  var sliders = $$('input[type="range"][data-key]');

  var MAX = 900;   // working size: the long side, in pixels

  var PHOTOS = {
    bmw: { src: 'Assets/web/filter/bmw.webp', name: 'bmw', alt: 'a silver BMW saloon parked beside a garden', probe: [0.567, 0.541] },
    cayman: { src: 'Assets/web/filter/cayman.webp', name: 'cayman', alt: 'a Porsche Cayman at night beside a green neon dragon', probe: [0.621, 0.461] }
  };

  var STEPS = {
    fg: [
      { name: 'Original' },
      { name: 'Warmth', key: 'warmth' },
      { name: 'Brightness', key: 'brightness' },
      { name: 'Shadow fade', key: 'fade' },
      { name: 'Vignette', key: 'vignette' },
      { name: 'Grain', key: 'grain' },
      { name: 'Lens blur', key: 'softness' },
      { name: 'Aberration', key: 'softness' },
      { name: 'Glow', key: 'glow' }
    ],
    pk: [
      { name: 'Original' },
      { name: 'Gradient map' },
      { name: 'Colour grain', key: 'pkgrain' },
      { name: 'Pixelate', key: 'pixel' }
    ]
  };

  var LOGO = { fg: 'Adrian’s<br>pic filter', pk: 'Pixelated<br>kisses' };
  var APP = { fg: 'Filter Generator', pk: 'Pixelated Kisses' };

  var params = { fg: {}, pk: {} };
  sliders.forEach(function (s) { params[s.getAttribute('data-mode-of')][s.getAttribute('data-key')] = +s.value; });

  var st = {
    mode: 'fg', view: { fg: 8, pk: 3 }, mathStep: { fg: 1, pk: 1 }, active: null,
    photo: null, photoName: 'photo', photoId: 0, orig: null, W: 0, H: 0,
    probe: { x: 0, y: 0 }, last: null,
    busy: false, dirty: false, probing: false, probeDirty: false, saveNext: false, lastMs: null
  };

  var port = null;

  function last(mode) { return STEPS[mode].length - 1; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function minus(n) { return String(n).replace('-', '−'); }
  function fx(n, d) { return minus((+n).toFixed(d)); }
  function signed(n, d) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d); }
  function say(t) { liveEl.textContent = ''; setTimeout(function () { liveEl.textContent = t; }, 30); }

  /* ── Talking to the engine ─────────────────────────────────────────── */

  function connect() {
    port = makePort();
    port.onmessage = onMessage;
    if (!port.local) {
      port.onerror = function () {
        // A worker that can't start (or crashes) hands over to the main thread.
        port = localPort(); port.onmessage = onMessage;
        st.busy = false; st.probing = false;
        if (st.orig) sendImage();
        render();
      };
    }
  }

  function sendImage() {
    var copy = new Uint8ClampedArray(st.orig.data);
    port.postMessage({ type: 'image', w: st.W, h: st.H, buf: copy.buffer }, [copy.buffer]);
  }

  function render(purpose) {
    if (!st.orig) return;
    if (st.busy) { st.dirty = true; return; }
    st.busy = true; st.dirty = false;
    port.postMessage({
      type: 'render', photo: st.photoId, mode: st.mode, params: params[st.mode],
      view: st.view[st.mode] || 0, probe: st.probe, purpose: purpose || null
    });
  }

  function askProbe() {
    if (!st.orig) return;
    if (st.busy || st.probing) { st.probeDirty = true; return; }
    st.probing = true;
    port.postMessage({ type: 'probe', photo: st.photoId, probe: st.probe });
  }

  function onMessage(e) {
    var m = e.data;
    if (m.type === 'probe') {
      st.probing = false;
      if (m.photo === st.photoId && m.mode === st.mode && m.probe) { st.last = m.probe; paintPipe(); }
      if (st.probeDirty) { st.probeDirty = false; askProbe(); }
      return;
    }
    if (m.type !== 'frame') return;
    st.busy = false;
    // Draw every frame that matches, even mid-drag: the newest result beats waiting.
    if (m.photo === st.photoId && m.mode === st.mode) {
      if (m.ms != null) st.lastMs = m.ms;
      if ((st.view[st.mode] || 0) !== 0) ctx.putImageData(new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h), 0, 0);
      st.last = m.probe;
      paintPipe();
      paintStat();
      loading.hidden = true;
      if (m.purpose === 'save' || st.saveNext) { st.saveNext = false; download(); }
    }
    if (st.dirty) render();
    else if (st.probeDirty) { st.probeDirty = false; askProbe(); }
  }

  /* ── Photos ─────────────────────────────────────────────────────────── */

  function loadPhoto(url, name, alt, probeAt, isOwn) {
    loading.hidden = false;
    loading.textContent = 'Loading the photo…';
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      var s = Math.min(1, MAX / img.naturalWidth, MAX / img.naturalHeight);
      var w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, w, h);
      if (isOwn) URL.revokeObjectURL(url);
      st.photoId++;
      st.orig = cx.getImageData(0, 0, w, h);
      st.W = w; st.H = h; st.photoName = name; st.alt = alt;
      st.probe = { x: Math.round((probeAt ? probeAt[0] : 0.5) * (w - 1)), y: Math.round((probeAt ? probeAt[1] : 0.5) * (h - 1)) };
      canvas.width = w; canvas.height = h;
      ctx.putImageData(st.orig, 0, 0);   // show the photo at once; the filter lands a moment later
      st.busy = false; st.dirty = false; st.last = null;
      sendImage();
      placeRing(); paintLabels(); paintPipe();
      render();
      say(isOwn ? 'Your photo is loaded and filtered. It stays on this page.' : 'Photo changed.');
    };
    img.onerror = function () {
      if (isOwn) URL.revokeObjectURL(url);
      loading.hidden = !st.orig;
      loading.textContent = 'Couldn’t read that file. Try a JPG or PNG.';
      say('Couldn’t read that file. Try a JPG or PNG.');
      statEl.textContent = 'Couldn’t read that file — try a JPG or PNG.';
    };
    img.src = url;
  }

  function pickPhoto(key) {
    photoBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-photo') === key)); });
    ownBtn.setAttribute('aria-pressed', 'false');
    st.photo = key;
    var p = PHOTOS[key];
    loadPhoto(p.src, p.name, p.alt, p.probe, false);
  }

  function useFile(file) {
    if (!file || !/^image\//.test(file.type)) { say('That isn’t an image.'); return; }
    photoBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    ownBtn.setAttribute('aria-pressed', 'true');
    st.photo = 'own';
    var base = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    loadPhoto(URL.createObjectURL(file), base, 'your photo', null, true);
  }

  /* ── Views: Before, After, or the image after any one step ──────────── */

  function setView(k) {
    st.view[st.mode] = k;
    paintLabels();
    paintPipe();
    if (k === 0 && st.orig) { ctx.putImageData(st.orig, 0, 0); return; }
    render();
  }

  function paintLabels() {
    var k = st.view[st.mode] || 0, n = last(st.mode), steps = STEPS[st.mode];
    viewBtns.forEach(function (b) {
      var on = b.getAttribute('data-view') === 'before' ? k === 0 : k === n;
      b.setAttribute('aria-pressed', String(on));
    });
    var text = k === 0 ? 'Before' : k === n ? 'After · all ' + n + ' steps' : 'After step ' + k + ' of ' + n + ' · ' + steps[k].name;
    badge.textContent = text;
    canvas.setAttribute('aria-label', (st.alt ? 'Photo of ' + st.alt : 'Photo') + ' — ' +
      (k === 0 ? 'the original' : APP[st.mode] + ', ' + (k === n ? 'every step applied' : 'up to step ' + k + ', ' + steps[k].name.toLowerCase())) + '.');
  }

  /* ── The pipeline strip ─────────────────────────────────────────────── */

  function buildPipe() {
    var steps = STEPS[st.mode];
    pipeEl.className = 'fg-pipe fg-pipe--' + steps.length;
    pipeEl.innerHTML = steps.map(function (s, i) {
      return '<li><button type="button" class="fg-step" data-step="' + i + '" aria-pressed="false">' +
        '<span class="fg-step__n">' + (i === 0 ? '00' : '0' + i) + '</span>' +
        '<span class="fg-step__name">' + esc(s.name) + '</span>' +
        '<span class="fg-step__sw" aria-hidden="true"></span>' +
        '<span class="fg-step__rgb">—</span>' +
      '</button></li>';
    }).join('');
    pipeEl.querySelectorAll('.fg-step').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = +b.getAttribute('data-step');
        st.mathStep[st.mode] = k;
        setView(k);
      });
    });
  }

  // Whether the app would run step k, judged on the settings the shown numbers came from.
  function stepOn(mode, k) {
    var p = (st.last && st.last.p) || params[mode];
    if (mode === 'pk') return [true, true, p.pkgrain > 0, p.pixel > 1][k];
    return [true, true, p.brightness !== 0, p.fade > 0, p.vignette > 0, p.grain > 0, p.softness > 0, p.softness > 0, p.glow > 0][k];
  }

  function paintPipe() {
    var steps = STEPS[st.mode], view = st.view[st.mode] || 0, pr = st.last;
    var cells = pipeEl.querySelectorAll('.fg-step');
    cells.forEach(function (c, k) {
      var on = stepOn(st.mode, k), s = pr && pr.stages[k], prev = pr && k > 0 && pr.stages[k - 1];
      c.setAttribute('aria-pressed', String(k === view));
      c.classList.toggle('is-off', !on);
      c.classList.toggle('is-active', !!st.active && steps[k].key === st.active);
      var sw = c.querySelector('.fg-step__sw'), rgb = c.querySelector('.fg-step__rgb');
      if (!s) { sw.style.background = ''; rgb.textContent = '—'; return; }
      sw.style.background = 'rgb(' + s.join(',') + ')';
      if (!on && k > 0) { rgb.innerHTML = '<span class="fg-step__skip">skipped</span>'; }
      else {
        rgb.innerHTML = s.map(function (v, ch) {
          return '<b' + (prev && prev[ch] === v ? ' class="is-same"' : '') + '>' + v + '</b>';
        }).join(' ');
      }
      c.setAttribute('aria-label', (k === 0 ? 'Original' : 'Step ' + k + ', ' + steps[k].name) +
        (!on && k > 0 ? ', skipped' : '') + ': red ' + s[0] + ', green ' + s[1] + ', blue ' + s[2] + '. Show the photo at this step.');
    });
    pxEl.innerHTML = pr ? 'Pixel <b>x ' + pr.x + '</b> <b>y ' + pr.y + '</b>' : 'Pixel —';
    paintMath();
  }

  function paintMath() {
    var mode = st.mode, k = st.mathStep[mode], pr = st.last, s = pr && pr.stages, inf = pr && pr.info;
    var p = (pr && pr.p) || params[mode];   // the settings these numbers were rendered with
    var name = STEPS[mode][k].name, t = '';
    var red = function (a, b) { return 'red ' + s[a][0] + ' → ' + s[b][0]; };
    if (!s) { mathEl.innerHTML = ''; return; }
    if (k === 0) t = 'The photo as loaded: three whole numbers per pixel, red, green and blue, each 0–255.';
    else if (mode === 'fg') {
      if (k === 1) t = 'Per-channel lookup table: ⌊((1 − w)·x + w·curve(x)) × 255⌋, w = ' + fx(p.warmth / 100, 2) + '. Blue’s curve sits lowest, so whites turn cream. Here ' + s[0].join(' ') + ' → ' + s[1].join(' ') + '.';
      else if (k === 2) {
        if (!p.brightness) t = 'Brightness is 0, so the app skips this step.';
        else {
          var bk = Math.fround(1 + (p.brightness / 100) * 0.45);
          t = 'v × (1 + b/100 × 0.45) = v × ' + fx(bk, 2) + ', in float32, then truncated. Here red ' + s[1][0] + ' × ' + fx(bk, 2) + ' = ' + fx(Math.fround(s[1][0] * bk), 2) + ' → ' + s[2][0] + '.';
        }
      } else if (k === 3) {
        if (!(p.fade > 0)) t = 'Shadow fade is 0, so the app skips this step.';
        else t = 'On a 0–1 scale: v × (1 − o) + o, o = fade/100 × 0.12 = ' + fx(p.fade / 100 * 0.12, 3) + '. Black lifts to ' + Math.floor(Math.fround(Math.fround(p.fade / 100 * 0.12) * 255)) + '. Here ' + red(2, 3) + '.';
      } else if (k === 4) {
        if (!(p.vignette > 0)) t = 'Vignette is 0, so the app skips this step.';
        else t = 'mask = 1 − (v/100 × 0.45) × d², d = distance from the centre (corners = 1). Here d = ' + fx(inf.d, 2) + ', mask = ' + fx(inf.mask, 3) + ': ' + red(3, 4) + '.';
      } else if (k === 5) {
        if (!(p.grain > 0)) t = 'Grain is 0, so the app skips this step.';
        else t = 'One Gaussian sample per pixel, σ = grain/100 × 20 = ' + fx(p.grain / 100 * 20, 1) + ', added to red, green and blue alike — monochrome, like film. Here ' + signed(inf.noise, 1) + '.';
      } else if (k === 6) {
        if (!(p.softness > 0)) t = 'Lens softness is 0, so the app skips this step.';
        else t = 'Gaussian blur, σ = softness/100 × 2.2 = ' + fx(p.softness / 100 * 2.2, 2) + ' px. Pillow does it as three box blurs each way, rounding to whole numbers after every pass.';
      } else if (k === 7) {
        if (!(p.softness > 0)) t = 'Rides on lens softness, which is 0, so the app skips this step.';
        else {
          var ca = p.softness / 100 * 0.007;
          t = 'Red is scaled ×' + fx(1 + ca, 4) + ' and cropped back, blue ×' + fx(1 - ca, 4) + ' and centred on black, green stays put — so colours split towards the edges.';
        }
      } else if (k === 8) {
        if (!(p.glow > 0)) t = 'Glow is 0, so the app skips this step.';
        else t = 'Luma over 180 feeds the glow: here ' + fx(inf.luma, 1) + (inf.glowMask > 0 ? ', so ' + Math.round(inf.glowMask * 100) + '% of this pixel goes in' : ', so none of this pixel goes in') + '. The glow is blurred (σ = ' + fx(inf.glowSigma, 1) + ' px) and added back × ' + fx(p.glow / 100 * 0.75, 2) + '.';
      }
    } else {
      if (k === 1) t = 'Grey L = (19595·R + 38470·G + 7471·B + 32768) >> 16 — Pillow’s 0.299/0.587/0.114 in whole numbers — then palette[L]. Here L = ' + inf.L + ' → ' + s[1].join(' ') + '. Black, then a warm grey from 150, then red; never white.';
      else if (k === 2) {
        if (!(p.pkgrain > 0)) t = 'Grain is 0, so the app skips this step.';
        else t = 'Separate Gaussian noise for red, green and blue, σ = ' + p.pkgrain + ' — colour grain. Here ' + inf.noise.map(function (n) { return signed(n, 1); }).join(', ') + '.';
      } else if (k === 3) {
        if (!(p.pixel > 1)) t = 'Pixel size is 1, so the app skips this step.';
        else t = 'Each ' + p.pixel + ' × ' + p.pixel + ' block, counted from the top-left corner, becomes the plain average of its pixels, truncated. Edge blocks average whatever is left.';
      }
    }
    mathEl.innerHTML = '<span class="fg-math__n">' + (k === 0 ? '00' : '0' + k) + ' · ' + esc(name) + '</span> ' + esc(t);
  }

  function paintStat() {
    statEl.textContent = st.W + ' × ' + st.H + ' px' + (st.lastMs != null ? ' · ' + Math.max(1, Math.round(st.lastMs)) + ' ms' : '');
  }

  /* ── Sliders ────────────────────────────────────────────────────────── */

  function fill(s) {
    var min = +s.min, max = +s.max;
    s.style.setProperty('--p', ((s.value - min) / (max - min) * 100) + '%');
    var out = root.querySelector('output[for="' + s.id + '"]');
    if (out) out.textContent = minus(s.value);
  }

  function activate(key) {
    st.active = key;
    var steps = STEPS[st.mode];
    for (var k = 0; k < steps.length; k++) if (steps[k].key === key) { st.mathStep[st.mode] = k; break; }
    paintPipe();
  }

  sliders.forEach(function (s) {
    fill(s);
    var key = s.getAttribute('data-key'), mode = s.getAttribute('data-mode-of');
    s.addEventListener('input', function () {
      params[mode][key] = +s.value;
      fill(s);
      if (st.active !== key) activate(key);
      if ((st.view[mode] || 0) === 0) { st.view[mode] = last(mode); paintLabels(); }
      paintPipe();
      render();
    });
    s.addEventListener('focus', function () { activate(key); });
    s.addEventListener('pointerdown', function () { activate(key); });
    s.addEventListener('blur', function () { if (st.active === key) { st.active = null; paintPipe(); } });
  });

  $('[data-reset]').addEventListener('click', function () {
    sliders.forEach(function (s) {
      if (s.getAttribute('data-mode-of') !== st.mode) return;
      s.value = s.getAttribute('data-default');
      params[st.mode][s.getAttribute('data-key')] = +s.value;
      fill(s);
    });
    st.view[st.mode] = last(st.mode);
    paintLabels(); paintPipe(); render();
    say('Sliders back to the app’s defaults.');
  });

  $('[data-reroll]').addEventListener('click', function () {
    port.postMessage({ type: 'reroll' });
    render();
    say('Fresh grain drawn.');
  });

  /* ── Mode, view and photo controls ─────────────────────────────────── */

  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-mode');
      if (m === st.mode) return;
      st.mode = m; st.active = null;
      modeBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      groups.fg.hidden = m !== 'fg'; groups.pk.hidden = m !== 'pk';
      logoEl.innerHTML = LOGO[m];
      root.setAttribute('data-mode-now', m);
      buildPipe();
      st.last = null;
      paintLabels(); paintPipe();
      if ((st.view[m] || 0) === 0 && st.orig) ctx.putImageData(st.orig, 0, 0);
      render();
      say(APP[m] + ': ' + (m === 'pk' ? 'two sliders, three steps.' : 'seven sliders, eight steps.'));
    });
  });

  viewBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      setView(b.getAttribute('data-view') === 'before' ? 0 : last(st.mode));
    });
  });

  photoBtns.forEach(function (b) {
    b.addEventListener('click', function () { pickPhoto(b.getAttribute('data-photo')); });
  });
  ownBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) useFile(fileInput.files[0]); fileInput.value = ''; });

  // "Drop Images Anywhere", as the app says.
  root.addEventListener('dragover', function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1) { e.preventDefault(); root.classList.add('is-drop'); }
  });
  root.addEventListener('dragleave', function (e) { if (!root.contains(e.relatedTarget)) root.classList.remove('is-drop'); });
  root.addEventListener('drop', function (e) {
    e.preventDefault(); root.classList.remove('is-drop');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) useFile(f);
  });

  /* ── Save, like "Save Result(s)": <name>_filtered.jpg ───────────────── */

  function download() {
    canvas.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = st.photoName + '_filtered.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }, 'image/jpeg', 0.92);
  }

  $('[data-save]').addEventListener('click', function () {
    if (!st.orig) return;
    var n = last(st.mode);
    if ((st.view[st.mode] || 0) === n && !st.busy && !st.dirty) { download(); return; }
    st.saveNext = true;
    setView(n);
  });

  /* ── Reading a pixel: hover, tap, or arrow keys ─────────────────────── */

  function box() {
    var r = canvas.getBoundingClientRect(), s = Math.min(r.width / st.W, r.height / st.H);
    return { r: r, s: s, ox: (r.width - st.W * s) / 2, oy: (r.height - st.H * s) / 2 };
  }

  function toImage(e) {
    if (!st.orig) return null;
    var b = box();
    var x = Math.floor((e.clientX - b.r.left - b.ox) / b.s), y = Math.floor((e.clientY - b.r.top - b.oy) / b.s);
    if (x < 0 || y < 0 || x >= st.W || y >= st.H) return null;
    return { x: x, y: y };
  }

  function placeRing() {
    if (!st.orig) return;
    var b = box();
    ring.style.transform = 'translate(' + (b.ox + (st.probe.x + 0.5) * b.s) + 'px,' + (b.oy + (st.probe.y + 0.5) * b.s) + 'px)';
    ring.hidden = false;
  }

  function setProbe(x, y) {
    if (x === st.probe.x && y === st.probe.y) return;
    st.probe = { x: x, y: y };
    placeRing();
    askProbe();
  }

  var pressed = false;
  canvas.addEventListener('pointerdown', function (e) { pressed = true; var p = toImage(e); if (p) setProbe(p.x, p.y); });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' && !pressed) return;
    var p = toImage(e); if (p) setProbe(p.x, p.y);
  });
  window.addEventListener('pointerup', function () { pressed = false; });
  window.addEventListener('pointercancel', function () { pressed = false; });

  canvas.addEventListener('keydown', function (e) {
    var d = e.shiftKey ? 10 : 1, x = st.probe.x, y = st.probe.y;
    if (e.key === 'ArrowLeft') x -= d; else if (e.key === 'ArrowRight') x += d;
    else if (e.key === 'ArrowUp') y -= d; else if (e.key === 'ArrowDown') y += d;
    else return;
    e.preventDefault();
    setProbe(Math.max(0, Math.min(st.W - 1, x)), Math.max(0, Math.min(st.H - 1, y)));
  });

  if ('ResizeObserver' in window) new ResizeObserver(placeRing).observe(stageEl);
  else window.addEventListener('resize', placeRing);

  /* ── Start when the demo comes near ─────────────────────────────────── */

  buildPipe();
  paintLabels();

  var started = false;
  function start() {
    if (started) return;
    started = true;
    connect();
    pickPhoto('bmw');
  }

  // Start as the demo comes near, or soon after the page has settled, whichever
  // is first: the work happens off the main thread and the photo is small.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); }
    }, { rootMargin: '600px 0px' });
    io.observe(root);
  }
  var idle = function () { setTimeout(start, 1200); };
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
})();
