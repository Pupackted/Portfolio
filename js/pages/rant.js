/*
 * A place to rant: the "read a messy AI reply" demo.
 *
 * extractJson below is the app's own function, unchanged. Around it, the demo
 * narrates what it had to do (find the fence, strip the chatter, repair the
 * JSON) and draws a small preview of the chapter it got back.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-rant-demo]');
  if (!root) return;

  var icon = (window.SITE && SITE.icon) || function () { return ''; };
  var text = root.querySelector('[data-reply-text]');
  var out = root.querySelector('[data-result]');
  var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-reply]'));

  var REPLIES = [
    'Of course — I read all eight entries carefully. Here’s your checkpoint:\n\n' +
    '```json\n' +
    '{\n' +
    '  "chapter_title": "Waiting on other people",\n' +
    '  "headline": "Most of the heaviness came from waiting on replies, not from the work itself.",\n' +
    '  "trajectory": "improving",\n' +
    '  "scores": { "overall": 54, "mood": 52, "energy": 47, "connection": 66 },\n' +
    '  "themes": [\n' +
    '    { "name": "Waiting on replies", "weight": 78, "sentiment": "negative" },\n' +
    '    { "name": "The thesis", "weight": 64, "sentiment": "mixed" },\n' +
    '    { "name": "Old friends", "weight": 42, "sentiment": "positive" }\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    'Let me know if you’d like me to go deeper on any of these themes!',

    '{\n' +
    '  “chapter_title”: “Mornings are kinder”,\n' +
    '  “headline”: “The early runs did more for the week than any list did.”,\n' +
    '  “trajectory”: “stable”,\n' +
    '  “scores”: { “mood”: 61, “energy”: 58, “clarity”: 66, “connection”: 70, },\n' +
    '  “themes”: [\n' +
    '    { “name”: “Running”, “weight”: 70, “sentiment”: “positive” },\n' +
    '    { “name”: “Sleep”, “weight”: 45, “sentiment”: “mixed” },\n' +
    '  ],\n' +
    '}',

    'I’m really sorry you’ve had such a heavy couple of weeks. It sounds like a lot of what you wrote ' +
    'comes back to waiting — on your supervisor, on the job applications — and that the waiting turns ' +
    'into being hard on yourself.\n\nWould it help to talk through what a kinder version of this week ' +
    'might have looked like?'
  ];

  /* ── The app's parser, verbatim ─────────────────────────────────────── */

  function extractJson(raw){
    let s = String(raw||"").trim();
    if(!s) throw new Error("Nothing pasted yet.");

    const fences = s.match(/```(?:json)?\s*([\s\S]*?)```/gi);
    if(fences){
      // prefer the fence that actually contains a brace
      for(const f of fences){
        const inner = f.replace(/^```(?:json)?\s*/i,"").replace(/```$/,"");
        if(inner.includes("{")){ s = inner; break; }
      }
    }
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if(a < 0 || b < 0 || b < a) throw new Error("I couldn't find any JSON in that. Make sure you copied the whole reply, including the { … } block.");
    s = s.slice(a, b+1);

    let obj;
    try { obj = JSON.parse(s); }
    catch(e1){
      try { obj = JSON.parse(s.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"')); }
      catch(e2){ throw new Error("The JSON is malformed and I couldn't repair it. " + e1.message); }
    }
    if(!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("That parsed, but it isn't a JSON object.");
    return obj;
  }

  function repairPrompt(msg){
    return "That didn't work. Here is exactly what went wrong when my app tried to read your reply:\n\n"
      + "  " + msg + "\n\n"
      + "Please send the checkpoint again as ONE fenced ```json code block containing a single valid JSON object "
      + "that matches the schema I gave you — every required key present, every score an integer 0–100, "
      + "no text before or after the code block, and no comments inside the JSON.";
  }

  /* ── Narration: what the parser had to deal with ────────────────────── */

  function describe(raw) {
    var steps = [];
    var s = String(raw || '').trim();
    var fence = /```(?:json)?\s*[\s\S]*?```/i.test(s);
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (fence) {
      steps.push({ fix: true, t: 'Found a fenced code block and read only that.' });
      var before = s.slice(0, s.indexOf('```')).trim();
      var after = s.slice(s.lastIndexOf('```') + 3).trim();
      if (before || after) steps.push({ fix: true, t: 'Ignored the chatter around it.' });
    } else if (a > 0 || (b >= 0 && b < s.length - 1)) {
      steps.push({ fix: true, t: 'Ignored the text around the JSON.' });
    }
    if (a >= 0 && b > a) {
      var body = s.slice(a, b + 1);
      var strict = true;
      try { JSON.parse(body); } catch (e) { strict = false; }
      if (!strict) {
        if (/[“”]/.test(body)) steps.push({ fix: true, t: 'Swapped curly quotes for straight ones.' });
        if (/,\s*[}\]]/.test(body)) steps.push({ fix: true, t: 'Dropped trailing commas.' });
      }
    }
    return steps;
  }

  /* ── Rendering ──────────────────────────────────────────────────────── */

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  // The app's own band edges: a score and its colour always agree.
  function scoreColor(v) {
    return v >= 72 ? '#84ad8c' : v >= 56 ? '#a8b47e' : v >= 42 ? '#d8a566' : v >= 26 ? '#cf8f6a' : '#c8776c';
  }

  var SENT = { negative: '#c8776c', mixed: '#d8a566', neutral: '#9c968c', positive: '#84ad8c' };
  var TRAJ = { improving: '↗ Improving', stable: '→ Stable', declining: '↘ Declining', volatile: '↕ Volatile' };

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }

  function log(items) {
    return '<ul class="rant-log">' + items.map(function (it, i) {
      var cls = it.bad ? ' class="is-bad"' : it.fix ? ' class="is-fix"' : '';
      var ico = it.bad ? 'x' : it.fix ? 'wrench' : 'check';
      return '<li' + cls + ' style="--i:' + i + '">' + icon(ico) + '<span>' + esc(it.t) + '</span></li>';
    }).join('') + '</ul>';
  }

  function run() {
    var raw = text.value;
    var steps = describe(raw);
    var obj;

    try {
      obj = extractJson(raw);
    } catch (err) {
      steps.push({ bad: true, t: err.message });
      out.innerHTML = log(steps) +
        '<div class="rant-repair"><p>Instead of a dead end, the app writes the follow-up for you to paste back into the chat:</p><pre>' +
        esc(repairPrompt(err.message)) + '</pre></div>';
      return;
    }

    var scores = obj.scores && typeof obj.scores === 'object' ? obj.scores : {};
    var overall = num(scores.overall);
    if (overall == null) {
      var vals = Object.keys(scores).map(function (k) { return num(scores[k]); }).filter(function (v) { return v != null; });
      if (vals.length) {
        overall = Math.round(vals.reduce(function (x, y) { return x + y; }, 0) / vals.length);
        steps.push({ fix: true, t: 'No overall score, so it averaged the others.' });
      }
    }
    steps.push({ t: 'Parsed and checked. Ready to draw.' });

    var themes = Array.isArray(obj.themes) ? obj.themes.slice(0, 4) : [];
    var c = 2 * Math.PI * 27;
    var ring = overall == null ? '' :
      '<div class="rant-ring"><svg viewBox="0 0 64 64" aria-hidden="true">' +
        '<circle cx="32" cy="32" r="27" fill="none" stroke="#2c2925" stroke-width="6"/>' +
        '<circle cx="32" cy="32" r="27" fill="none" stroke="' + scoreColor(overall) + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (c * overall / 100).toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
      '</svg><b>' + overall + '</b></div>';

    out.innerHTML = log(steps) +
      '<div class="rant-mini">' +
        '<p class="rant-mini__kicker">Chapter · ' + esc(TRAJ[String(obj.trajectory).toLowerCase()] || '→ Stable') + '</p>' +
        '<p class="rant-mini__title">' + esc(obj.chapter_title || 'Untitled chapter') + '</p>' +
        (obj.headline ? '<p class="rant-mini__headline">' + esc(obj.headline) + '</p>' : '') +
        '<div class="rant-mini__row">' + ring +
          '<div class="rant-mini__themes">' + themes.map(function (t) {
            return '<span><i style="background:' + (SENT[String(t && t.sentiment).toLowerCase()] || SENT.neutral) + '"></i>' + esc(t && t.name) + '</span>';
          }).join('') + '</div>' +
        '</div>' +
      '</div>';
  }

  function pick(i) {
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-reply') === i)); });
    text.value = REPLIES[i];
    run();
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () { pick(+b.getAttribute('data-reply')); });
  });
  root.querySelector('[data-parse]').addEventListener('click', run);

  text.value = REPLIES[0];

  // Read the first reply as the demo scrolls in, so it never sits empty.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { io.disconnect(); run(); }
    }, { threshold: 0.2 });
    io.observe(root);
  } else {
    run();
  }
})();
