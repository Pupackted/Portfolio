/*
 * YT Playlist Downloader: "run it twice".
 *
 * A small model of what DownloadService.run() does, driving an HTML copy of
 * the app's Download screen. The order of steps, the skip rule, the stage and
 * result wording and the 400 ms progress polling all follow the Kotlin source;
 * only the playlist and the network speeds are invented.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-yt-demo]');
  if (!root) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var icon = (window.SITE && SITE.icon) || function () { return ''; };
  var $ = function (s) { return root.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };

  var PLAYLIST = 'Late Night Drives';
  var VARIOUS = 'Various Artists';
  var POLL_MS = 400; // how often the service reads progress.json
  var BYTES_PER_SEC_AUDIO = 16000; // YouTube's m4a audio is about 128 kbps
  var VIDEO_ERROR = 'YouTube only offers this one as separate video and audio tracks, which this app can’t join together. Try saving it as Music instead.';

  // A mostly invented playlist (one real song, for her). Thumbnails are drawn with gradients.
  var TRACKS = [
    { title: 'Paper Lanterns', by: 'Lowlight', dur: 225, art: 'radial-gradient(circle at 26% 40%, #ffd8a3 0 8%, rgba(255,190,120,.35) 9%, transparent 17%), radial-gradient(circle at 60% 30%, #ffc28f 0 6%, rgba(255,170,110,.3) 7%, transparent 14%), radial-gradient(circle at 82% 56%, #ffd0a0 0 5%, transparent 12%), linear-gradient(165deg, #35183f, #7b2f57 60%, #c4566f)' },
    { title: 'Slow Tide', by: 'Sundown Radio', dur: 252, art: 'radial-gradient(circle at 50% 42%, #fff0c8 0 9%, transparent 10%), linear-gradient(180deg, #f6c39a 0%, #e98f73 44%, #2f6683 44.5%, #173447 100%)' },
    { title: 'Glasshouse', by: 'Morning Tapes', dur: 208, art: 'linear-gradient(90deg, transparent 31%, rgba(255,255,255,.4) 31% 33%, transparent 33% 65%, rgba(255,255,255,.4) 65% 67%, transparent 67%), linear-gradient(0deg, transparent 48%, rgba(255,255,255,.35) 48% 51%, transparent 51%), linear-gradient(160deg, #a7dcbc, #4e8f78 55%, #23473d)' },
    { title: 'Signals in the Rain', by: 'Hollow Pines', dur: 291, art: 'repeating-linear-gradient(100deg, rgba(255,255,255,.13) 0 1px, transparent 1px 7px), radial-gradient(circle at 72% 68%, #ef5c73 0 5%, rgba(239,92,115,.35) 6%, transparent 22%), linear-gradient(170deg, #1d2943, #3b3f6b 60%, #5a4a78)' },
    { title: 'Counting Streetlights', by: 'Lowlight', dur: 237, art: 'radial-gradient(circle at 18% 30%, #ffd27a 0 4%, rgba(255,210,122,.3) 5%, transparent 11%), radial-gradient(circle at 42% 42%, #ffd27a 0 3.5%, rgba(255,210,122,.3) 4.5%, transparent 10%), radial-gradient(circle at 66% 52%, #ffd27a 0 3%, transparent 8%), radial-gradient(circle at 86% 60%, #ffd27a 0 2.5%, transparent 7%), linear-gradient(180deg, #111a33, #2b2350 70%, #4d2d4f)' },
    { title: 'Young and Beautiful', by: 'Lana Del Rey', dur: 236, art: 'radial-gradient(120% 90% at 30% 115%, #a8ceff 0 28%, transparent 62%), radial-gradient(circle at 78% 24%, rgba(255,255,255,.55) 0 5%, transparent 12%), linear-gradient(200deg, #1c3a78, #4a74c9)' },
    { title: 'Small Hours', by: 'Sundown Radio', dur: 303, art: 'radial-gradient(circle at 72% 30%, #f4ecd8 0 8%, rgba(244,236,216,.22) 9%, transparent 26%), linear-gradient(180deg, #0f1730, #2a2747 78%, #3a2c44)' },
    { title: 'Kite Weather', by: 'Morning Tapes', dur: 219, art: 'conic-gradient(from 45deg at 50% 50%, #ff7a59 0 25%, #ffd166 0 50%, #ff7a59 0 75%, #ffd166 0) 62% 28% / 20% 34% no-repeat, linear-gradient(180deg, #8fd0ff, #d9f0ff 68%, #b7e3a1 68%, #8cc77a)' },
    { title: 'Northbound', by: 'Hollow Pines', dur: 264, art: 'conic-gradient(from 135deg at 34% 40%, #e3eaf3 0 90deg, transparent 0), conic-gradient(from 122deg at 70% 54%, #8ea6bd 0 116deg, transparent 0), linear-gradient(180deg, #f3b88a, #e98d77 50%, #6e5a7e)' },
    { title: 'Soft Focus', by: 'Velvet Static', dur: 232, art: 'radial-gradient(circle at 28% 40%, rgba(255,214,231,.95) 0 9%, transparent 28%), radial-gradient(circle at 70% 62%, rgba(255,240,200,.85) 0 8%, transparent 26%), radial-gradient(circle at 56% 24%, rgba(205,222,255,.75) 0 6%, transparent 22%), linear-gradient(135deg, #b47fa0, #e4b3a7)' }
  ];
  TRACKS.forEach(function (t, i) { t.i = i; t.size = t.dur * BYTES_PER_SEC_AUDIO; });

  var FIRST_LIBRARY = [0, 1, 3, 4, 6, 8];
  // Which song "Delete a song" removes first.
  var DELETE_ORDER = [4, 1, 6, 0, 3, 8, 2, 5, 7, 9];

  /* ── Formatting, as in Formatting.kt ─────────────────────────────────── */

  function formatDuration(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function formatSize(bytes) {
    var mb = bytes / 1024 / 1024;
    return mb >= 10 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB';
  }

  function formatSpeed(bps) {
    if (bps <= 0) return '';
    var mb = bps / 1024 / 1024;
    return mb >= 1 ? mb.toFixed(1) + ' MB/s' : Math.round(bps / 1024) + ' KB/s';
  }

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  function svg(id) { return '<svg aria-hidden="true"><use href="#ya-' + id + '" /></svg>'; }

  /* ── State ───────────────────────────────────────────────────────────── */

  // The Room table: one row per (videoId, format), plus whether the file is
  // still in MediaStore. Rows outlive the files they point at.
  var room, order, format, aart, last, runId, running, cancel, runs, lastRun;

  function key(i, f) { return i + '|' + f; }

  function fresh() {
    room = {};
    order = 0;
    FIRST_LIBRARY.forEach(function (i) {
      room[key(i, 'audio')] = { i: i, format: 'audio', exists: true, when: '3 days ago', order: ++order };
    });
    format = 'audio';
    aart = true;
    last = TRACKS[0];
    runId = (runId || 0) + 1;
    running = false;
    cancel = false;
    runs = 0;
    lastRun = null;
  }

  function existsInMediaStore(i, f) {
    var row = room[key(i, f)];
    return !!(row && row.exists);
  }

  /* ── DOM ─────────────────────────────────────────────────────────────── */

  var dlBtn = $('[data-download]');
  var dlLabel = $('[data-dl-label]');
  var slot = $('[data-slot]');
  var formatBtns = $$('[data-format]');
  var tabBtns = $$('[data-tab]');
  var views = $$('[data-view]');
  var queue = $('[data-queue]');
  var hint = $('[data-hint]');
  var live = $('[data-live]');
  var bridgeK = $('[data-bridge-k]');
  var bridgeV = $('[data-bridge-v]');
  var delBtn = $('[data-delete]');
  var aartBtn = $('[data-aart]');
  var rows = [];

  function say(text) { live.textContent = text; }

  function bridge(k, v) {
    bridgeK.textContent = k;
    bridgeV.textContent = v;
    if (!reduce) {
      bridgeV.classList.remove('is-tick');
      void bridgeV.offsetWidth;
      bridgeV.classList.add('is-tick');
    }
  }

  function buildQueue() {
    queue.innerHTML = TRACKS.map(function (t) {
      return '<li class="yt-row" data-state="idle">' +
        '<span class="yt-row__n">' + String(t.i + 1).padStart(2, '0') + '</span>' +
        '<span class="yt-row__art" style="--art:' + t.art + '"></span>' +
        '<span class="yt-row__text"><b>' + esc(t.title) + '</b><span>' + esc(t.by) + ' · ' + formatDuration(t.dur) + '</span></span>' +
        '<span class="yt-pill" data-pill>Not checked</span>' +
        '<i class="yt-row__bar" aria-hidden="true"></i>' +
      '</li>';
    }).join('');
    rows = Array.prototype.slice.call(queue.children);
  }

  var PILL_ICON = { lib: 'check', saved: 'check', gone: 'x', failed: 'x' };

  function setRow(i, state, label, p) {
    var li = rows[i];
    var changed = li.getAttribute('data-state') !== state;
    li.setAttribute('data-state', state);
    var ico = PILL_ICON[state] ? icon(PILL_ICON[state]) : '';
    li.querySelector('[data-pill]').innerHTML = ico + esc(label);
    li.style.setProperty('--p', p == null ? 0 : p);
    if (changed && !reduce && state !== 'idle') {
      li.classList.remove('is-flash');
      void li.offsetWidth;
      li.classList.add('is-flash');
    }
  }

  // Before a run: what the panel knows without probing.
  function idleRows() {
    TRACKS.forEach(function (t) {
      var row = room[key(t.i, 'audio')];
      if (row && !row.exists) setRow(t.i, 'gone', 'Deleted');
      else if (lastRun && row && row.exists) setRow(t.i, 'lib', 'In library');
      else setRow(t.i, 'idle', lastRun ? 'Not saved' : 'Not checked');
    });
  }

  function counts(skip, todo, saved) {
    $('[data-count-skip]').textContent = skip == null ? '–' : skip;
    $('[data-count-todo]').textContent = todo == null ? '–' : todo;
    $('[data-count-saved]').textContent = saved == null ? '–' : saved;
  }

  /* ── Tags and albums ─────────────────────────────────────────────────── */

  function renderTags(isFresh) {
    var t = last;
    $('[data-tags-file]').innerHTML = 'Music/YT Downloader/<b>' + esc(t.title) + '.m4a</b>';
    var atoms = [
      ['©nam', esc(t.title)],
      ['©ART', esc(t.by) + ' <small>uploader</small>'],
      ['©alb', esc(PLAYLIST) + ' <small>playlist</small>'],
      ['aART', aart ? esc(VARIOUS) : esc(t.by) + ' <small>falls back to artist</small>'],
      ['cpil', aart ? 'true <small>compilation</small>' : '<small>not set</small>'],
      ['covr', '<span class="yt-cover" style="--art:' + t.art + '"></span>JPEG <small>ff d8 ff · largest thumbnail</small>']
    ];
    var dl = $('[data-atoms]');
    dl.innerHTML = atoms.map(function (a, n) {
      return '<div' + (isFresh ? ' class="is-fresh"' : '') + ' style="--i:' + n + '"><dt>' + a[0] + '</dt><dd>' + a[1] + '</dd></div>';
    }).join('');
  }

  // Samsung Music lists the files that exist, grouped by (album, album artist).
  function renderAlbums() {
    var groups = [], byKey = {};
    TRACKS.forEach(function (t) {
      if (!existsInMediaStore(t.i, 'audio')) return;
      var artist = aart ? VARIOUS : t.by;
      var k = PLAYLIST + '|' + artist;
      if (!byKey[k]) { byKey[k] = { artist: artist, tracks: [] }; groups.push(byKey[k]); }
      byKey[k].tracks.push(t);
    });
    var grid = $('[data-albums]');
    var one = groups.length === 1;
    grid.classList.toggle('is-one', one);
    if (one) {
      var g = groups[0], c = g.tracks.length;
      var bytes = g.tracks.reduce(function (s, t) { return s + t.size; }, 0);
      grid.innerHTML = '<div class="yt-album yt-album--one">' +
          '<span class="yt-album__cover" style="--art:' + g.tracks[0].art + '"></span>' +
          '<span class="yt-album__meta"><b>' + esc(PLAYLIST) + '</b><span>' + esc(g.artist) + '</span>' +
          '<span class="yt-album__sub">' + c + (c === 1 ? ' track' : ' tracks') + ' · ' + formatSize(bytes) + '</span></span>' +
        '</div>' +
        '<ol class="yt-album__tracks">' + g.tracks.map(function (t, n) {
          return '<li style="--i:' + n + '"><span>' + (n + 1) + '</span>' + esc(t.title) + '</li>';
        }).join('') + '</ol>';
    } else {
      grid.innerHTML = groups.map(function (g, n) {
        var c = g.tracks.length;
        return '<div class="yt-album" style="--i:' + n + '">' +
          '<span class="yt-album__cover" style="--art:' + g.tracks[0].art + '"><span class="yt-album__count">' + c + '</span></span>' +
          '<b>' + esc(PLAYLIST) + '</b><span>' + esc(g.artist) + '</span>' +
        '</div>';
      }).join('');
    }
    var total = groups.reduce(function (s, g) { return s + g.tracks.length; }, 0);
    $('[data-albums-note]').textContent = aart
      ? 'Grouped by album and album artist, so all ' + total + ' songs from the playlist sit in one album.'
      : 'Same album name, but each song’s album artist falls back to its own artist — so one playlist becomes ' + groups.length + ' albums, one per singer.';
  }

  /* ── The phone: tabs, library, playlists ─────────────────────────────── */

  function setTab(name) {
    views.forEach(function (v) {
      var on = v.getAttribute('data-view') === name;
      if (on && v.hidden) {
        v.hidden = false;
        if (!reduce) {
          v.classList.remove('is-entering');
          void v.offsetWidth;
          v.classList.add('is-entering');
        }
      } else if (!on) {
        v.hidden = true;
      }
    });
    tabBtns.forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function libraryRows() {
    return Object.keys(room).map(function (k) { return room[k]; })
      .sort(function (a, b) { return b.order - a.order; });
  }

  function renderLibrary(newest) {
    var list = libraryRows();
    $('[data-lib-count]').textContent = list.length + (list.length === 1 ? ' download' : ' downloads');
    $('[data-lib-rows]').innerHTML = list.slice(0, 6).map(function (r) {
      var t = TRACKS[r.i];
      var meta = [formatDuration(t.dur), formatSize(t.size), r.when].join(' · ');
      return '<li class="ya-row' + (newest && r.order === newest ? ' is-new' : '') + '">' +
        '<span class="ya-thumb" style="--art:' + t.art + '">' + svg('play') + '</span>' +
        '<span class="ya-row__text"><b>' + esc(t.title) + '</b><span>' + esc(t.by) + '</span>' +
        '<span class="ya-row__meta">' + svg(r.format === 'audio' ? 'note' : 'video') + esc(meta) + '</span></span>' +
        svg('more') +
      '</li>';
    }).join('');

    var audio = list.filter(function (r) { return r.format === 'audio'; })
      .sort(function (a, b) { return a.i - b.i; });
    var bytes = audio.reduce(function (s, r) { return s + TRACKS[r.i].size; }, 0);
    $('[data-playlist]').innerHTML = '<div class="ya-pl__card">' +
      '<span class="ya-mosaic">' + audio.slice(0, 4).map(function (r) { return '<i style="--art:' + TRACKS[r.i].art + '"></i>'; }).join('') + '</span>' +
      '<span><b>' + esc(PLAYLIST) + '</b><span>' + audio.length + ' songs · ' + formatSize(bytes) + '</span></span>' +
    '</div>';
  }

  /* ── Progress card and result card (HomeScreen.kt) ───────────────────── */

  var card = null;
  var homeView = $('[data-view="home"]');

  // A new card can land below the fold of the phone; scroll the column to it.
  function bringIntoView(el) {
    var need = el.offsetTop + el.offsetHeight + 12 - homeView.clientHeight;
    if (need > homeView.scrollTop) homeView.scrollTo({ top: need, behavior: reduce ? 'auto' : 'smooth' });
  }

  function clearSlot() {
    slot.innerHTML = '';
    card = null;
  }

  function progressCard(st) {
    if (!card || card.kind !== 'progress') {
      slot.innerHTML =
        '<div class="ya-card ya-progress' + (reduce ? '' : ' is-new') + '">' +
          '<div class="ya-progress__top"><b data-p-stage></b><span data-p-count></span></div>' +
          '<p class="ya-progress__title" data-p-title hidden></p>' +
          '<div class="ya-bar" data-p-bar><i></i></div>' +
          '<div class="ya-progress__row"><span data-p-pct></span><button type="button" class="ya-tbtn" data-stop>Stop</button></div>' +
          '<p class="ya-progress__skip" data-p-skip hidden></p>' +
        '</div>';
      card = { kind: 'progress', el: slot.firstChild };
      card.el.querySelector('[data-stop]').addEventListener('click', function () {
        if (running) { cancel = true; say('Stopping after this chunk.'); }
      });
      requestAnimationFrame(function () { if (card) bringIntoView(card.el); });
    }
    var el = card.el;
    el.querySelector('[data-p-stage]').textContent =
      st.stage === 'preparing' ? 'Getting things ready…' : st.stage === 'saving' ? 'Saving…' : 'Downloading';
    el.querySelector('[data-p-count]').textContent = st.count > 1 ? st.index + ' of ' + st.count : '';
    var title = el.querySelector('[data-p-title]');
    title.hidden = !st.title;
    title.textContent = st.title || '';
    var bar = el.querySelector('[data-p-bar]');
    bar.classList.toggle('is-indeterminate', st.progress == null);
    bar.firstChild.style.width = st.progress == null ? '' : (st.progress * 100).toFixed(1) + '%';
    var parts = [];
    if (st.progress != null) parts.push(Math.floor(st.progress * 100) + '%');
    var speed = formatSpeed(st.speed || 0);
    if (speed) parts.push(speed);
    el.querySelector('[data-p-pct]').textContent = parts.join(' · ');
    var skip = el.querySelector('[data-p-skip]');
    skip.hidden = !(st.skipped > 0);
    skip.textContent = st.skipped + ' already in your library — skipping';
  }

  function resultCard(r) {
    var isError = r.errorMessage != null;
    var nothingNew = !isError && r.saved === 0 && r.skipped > 0 && r.failed === 0;
    var title = isError ? 'Couldn’t download'
      : r.cancelled ? 'Stopped'
      : nothingNew ? 'Already saved'
      : r.saved > 0 ? 'Saved ' + r.saved + ' ' + (r.saved === 1 ? 'file' : 'files')
      : 'Nothing saved';

    var body = '';
    if (isError) body = r.errorMessage;
    else if (nothingNew) body = r.skipped === 1 ? 'This is already in your library.' : 'All ' + r.skipped + ' of these are already in your library.';
    else {
      if (r.saved > 0) body = r.audio ? 'Saved to your Music folder — open Samsung Music to play.' : 'Saved to your Movies folder.';
      if (r.skipped > 0) body += (body ? ' ' : '') + r.skipped + ' already in your library.';
      if (r.failed > 0) body += (body ? ' ' : '') + (r.failed === 1
        ? '1 couldn’t be downloaded — it may be private, deleted, or unavailable in this format.'
        : r.failed + ' couldn’t be downloaded — they may be private, deleted, or unavailable in this format.');
    }

    var ico = isError ? 'error' : nothingNew ? 'library' : 'check';
    slot.innerHTML =
      '<div class="ya-card ya-result' + (isError ? ' ya-result--error' : '') + (reduce ? '' : ' is-new') + '">' +
        '<div class="ya-result__top">' + svg(ico) + '<span>' + esc(title) + '</span></div>' +
        (body ? '<p class="ya-result__body">' + esc(body) + '</p>' : '') +
        '<div class="ya-result__btns">' +
          (r.saved > 0 || nothingNew ? '<button type="button" class="ya-tbtn" data-open-lib>Open library</button>' : '') +
          '<button type="button" class="ya-tbtn" data-dismiss>Dismiss</button>' +
        '</div>' +
      '</div>';
    card = { kind: 'result', el: slot.firstChild };
    var open = card.el.querySelector('[data-open-lib]');
    if (open) open.addEventListener('click', function () { clearSlot(); setTab('library'); });
    card.el.querySelector('[data-dismiss]').addEventListener('click', function () { clearSlot(); dlBtn.focus(); });
    var shown = card.el;
    requestAnimationFrame(function () { bringIntoView(shown); });
    return title + '. ' + body;
  }

  /* ── The run (DownloadService.run) ───────────────────────────────────── */

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, reduce ? 0 : ms); });
  }

  function busy(on) {
    running = on;
    dlBtn.disabled = on;
    dlLabel.textContent = on ? 'Downloading…' : 'Download';
    dlBtn.classList.remove('is-invite');
    syncDelete();
  }

  function syncDelete() {
    var any = DELETE_ORDER.some(function (i) { return existsInMediaStore(i, 'audio'); });
    delBtn.disabled = running || !any;
  }

  async function run() {
    if (running) return;
    var id = runId;
    var fmt = format;
    var alive = function () { return id === runId; };
    cancel = false;
    busy(true);
    setTab('home');

    // Probe: list what's behind the link without downloading anything.
    var st = { stage: 'preparing', index: 0, count: 0, title: '', progress: null, speed: 0, skipped: 0 };
    progressCard(st);
    TRACKS.forEach(function (t) { setRow(t.i, 'idle', '…'); });
    counts(null, null, null);
    bridge('probe(url)', 'extract_flat: "in_playlist" …');
    say('Getting things ready.');
    await wait(1100);
    if (!alive()) return;
    bridge('probe(url) →', '{"status": "ok", "is_playlist": true, "playlist_title": "' + PLAYLIST + '", "items": [ …10 ]}');

    // Skip anything in Room whose file is still on the phone.
    var pending = [], skipped = 0;
    for (var n = 0; n < TRACKS.length; n++) {
      var t = TRACKS[n];
      var row = room[key(t.i, fmt)];
      if (row && row.exists) { skipped++; setRow(t.i, 'lib', 'In library'); }
      else { pending.push(t); setRow(t.i, row ? 'back' : 'queued', row ? 'File gone · fetch' : 'New'); }
      await wait(85);
      if (!alive()) return;
    }
    counts(skipped, pending.length, 0);
    st.count = pending.length;
    st.skipped = skipped;
    progressCard(st);
    await wait(500);
    if (!alive()) return;

    var result = { saved: 0, skipped: skipped, failed: 0, cancelled: false, errorMessage: null, audio: fmt === 'audio' };

    if (!pending.length) {
      busy(false);
      say(resultCard(result));
      bridge('notification', skipped === 1 ? 'Already in your library — Nothing new to download.' : 'All ' + skipped + ' already in your library — Nothing new to download.');
      finish(result);
      return;
    }
    say(skipped + ' already in your library — skipping. ' + pending.length + ' to download.');

    var lastFailure = null;
    for (var k = 0; k < pending.length; k++) {
      var item = pending[k];
      st = { stage: 'downloading', index: k + 1, count: pending.length, title: item.title, progress: null, speed: 0, skipped: skipped };
      progressCard(st);
      setRow(item.i, 'down', '0%', 0);
      bridge('download_one(', 'id, "' + fmt + '", album="' + PLAYLIST + '", album_artist="' + VARIOUS + '")');

      // The first poll usually finds no progress file yet: indeterminate.
      await wait(POLL_MS);
      if (!alive()) return;
      if (cancel) { stopped(item, pending.slice(k), result); return; }

      if (fmt === 'video') {
        await wait(POLL_MS);
        if (!alive()) return;
        lastFailure = VIDEO_ERROR;
        result.failed++;
        setRow(item.i, 'failed', 'Failed');
        bridge('download_one() →', '{"status": "error", "message": "' + VIDEO_ERROR + '"}');
        counts(skipped, pending.length - k - 1, result.saved);
        await wait(250);
        if (!alive()) return;
        continue;
      }

      // Python writes progress.json at most every 0.4 s; Kotlin reads it every 400 ms.
      var speed = (1.7 + Math.random() * 1.6) * 1048576;
      var done = 0;
      while (done < item.size) {
        var s = speed * (0.85 + Math.random() * 0.3);
        done = Math.min(item.size, done + s * POLL_MS / 1000);
        var pct = done * 100 / item.size;
        var finished = done >= item.size;
        bridge('progress.json', '{"status": "' + (finished ? 'finished' : 'downloading') + '", "downloaded": ' + Math.round(done) +
          ', "total": ' + item.size + ', "percent": ' + pct.toFixed(1) + ', "speed": ' + Math.round(s) +
          ', "eta": ' + Math.ceil((item.size - done) / s) + '}');
        st.progress = done / item.size;
        st.speed = Math.round(s);
        progressCard(st);
        setRow(item.i, 'down', Math.floor(pct) + '%', done / item.size);
        if (finished) break;
        await wait(POLL_MS);
        if (!alive()) return;
        // Cancel: the hook raises on the next chunk.
        if (cancel) { stopped(item, pending.slice(k), result); return; }
      }

      // Python tags the file before it returns.
      setRow(item.i, 'tag', 'Writing tags', 1);
      last = item;
      renderTags(true);
      await wait(520);
      if (!alive()) return;
      bridge('download_one() →', '{"status": "ok", "title": "' + item.title + '", "uploader": "' + item.by + '", "ext": "m4a"}');

      // Kotlin copies it into MediaStore, hidden behind IS_PENDING until done.
      st.stage = 'saving';
      st.progress = 1;
      st.speed = 0;
      progressCard(st);
      setRow(item.i, 'save', 'IS_PENDING=1', 1);
      await wait(480);
      if (!alive()) return;

      room[key(item.i, fmt)] = { i: item.i, format: fmt, exists: true, when: 'Today', order: ++order };
      result.saved++;
      setRow(item.i, 'saved', 'Saved');
      counts(skipped, pending.length - k - 1, result.saved);
      renderAlbums();
      renderLibrary(order);
      syncDelete();
    }

    if (result.saved === 0 && result.failed > 0) result.errorMessage = lastFailure;
    busy(false);
    say(resultCard(result));
    finish(result);
  }

  function stopped(item, rest, result) {
    rest.forEach(function (t) { setRow(t.i, 'idle', t === item ? 'Stopped' : 'Not fetched'); });
    bridge('progress hook', 'raise _Cancelled()  # on the next chunk');
    result.cancelled = true;
    busy(false);
    say(resultCard(result));
    finish(result);
  }

  function finish(result) {
    runs++;
    lastRun = result;
    var gone = DELETE_ORDER.some(function (i) { var r = room[key(i, 'audio')]; return r && !r.exists; });
    var allHere = TRACKS.every(function (t) { return existsInMediaStore(t.i, 'audio'); });
    hint.innerHTML = result.errorMessage ? 'Most videos fail like this — try <strong>Music</strong> instead.'
      : result.cancelled ? 'Stopped. Press <strong>Download</strong> to pick up where it left off.'
      : gone ? 'Press <strong>Download</strong> to fetch it back.'
      : allHere && result.saved > 0 ? 'Now press <strong>Download</strong> again.'
      : allHere ? 'Nothing new. Delete a song, then run it again.'
      : 'Press <strong>Download</strong> on the phone.';
  }

  /* ── Controls ────────────────────────────────────────────────────────── */

  dlBtn.addEventListener('click', run);

  formatBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      format = b.getAttribute('data-format');
      formatBtns.forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-pressed', String(on));
      });
    });
  });

  tabBtns.forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
  });

  delBtn.addEventListener('click', function () {
    if (running) return;
    for (var n = 0; n < DELETE_ORDER.length; n++) {
      var i = DELETE_ORDER[n];
      var row = room[key(i, 'audio')];
      if (row && row.exists) {
        row.exists = false; // the file is gone; the Room row stays
        if (lastRun) setRow(i, 'gone', 'Deleted');
        else idleRows();
        renderAlbums();
        renderLibrary();
        syncDelete();
        hint.innerHTML = 'Deleted “' + esc(TRACKS[i].title) + '”. Press <strong>Download</strong>.';
        say('Deleted ' + TRACKS[i].title + ' from the phone. Room still remembers it.');
        return;
      }
    }
  });

  $('[data-reset]').addEventListener('click', function () {
    fresh();
    format = 'audio';
    formatBtns.forEach(function (x) {
      var on = x.getAttribute('data-format') === 'audio';
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    aartBtn.setAttribute('aria-pressed', 'true');
    busy(false);
    dlBtn.classList.add('is-invite');
    init();
    say('Demo reset. Six of ten songs are on the phone.');
  });

  aartBtn.addEventListener('click', function () {
    aart = !aart;
    aartBtn.setAttribute('aria-pressed', String(aart));
    renderAlbums();
    renderTags(false);
  });

  function init() {
    clearSlot();
    homeView.scrollTop = 0;
    setTab('home');
    buildQueue();
    idleRows();
    counts(null, null, null);
    bridge('Python → Kotlin', 'Waiting for a link.');
    hint.innerHTML = 'Press <strong>Download</strong> on the phone.';
    renderTags(false);
    renderAlbums();
    renderLibrary();
    syncDelete();
  }

  fresh();
  dlBtn.classList.add('is-invite');
  init();
})();
