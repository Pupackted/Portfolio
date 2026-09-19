/*
 * AI Journal: the typing iPad in the hero, and the "reflect" demo.
 *
 * The demo is deliberately honest about what it is — a tiny word-list model
 * running in the browser — so it can show the shape of the product (write,
 * reflect, nothing sent) without pretending to be the app's language model.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };

  /* ── Hero: an entry being written, then a quiet insight ─────────────── */

  function initHero() {
    var target = $('[data-hero-type]');
    var insight = $('[data-hero-insight]');
    if (!target) return;
    var text = 'Long day. The demo went better than I expected — I think I finally stopped over-preparing.';

    if (reducedMotion) {
      target.textContent = text;
      insight.classList.add('is-on');
      return;
    }

    var started = false;
    function type() {
      if (started) return;
      started = true;
      var i = 0;
      (function step() {
        i++;
        target.textContent = text.slice(0, i);
        if (i < text.length) {
          // A human rhythm: quick within words, a beat after punctuation.
          var ch = text.charAt(i - 1);
          var delay = /[.,—]/.test(ch) ? 260 : 26 + Math.random() * 44;
          setTimeout(step, delay);
        } else {
          setTimeout(function () { insight.classList.add('is-on'); }, 700);
        }
      })();
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          io.disconnect();
          setTimeout(type, 700);
        }
      }, { threshold: 0.4 });
      io.observe(target);
    } else {
      type();
    }
  }

  /* ── The demo ───────────────────────────────────────────────────────── */

  var SAMPLES = [
    'Rode to the beach after work and didn’t check my phone once. Dinner with friends, a lot of laughing. I feel lighter than I have in weeks.',
    'Couldn’t focus today. The deadline keeps moving and I keep telling everyone it’s fine. I’m worried I’m letting the team down.',
    'Slept four hours. Coffee, meetings, more coffee. I got things done but I barely remember any of it. I just want a quiet evening.',
  ];

  var LEXICON = {
    content: ['good', 'great', 'happy', 'lighter', 'laugh', 'laughing', 'love', 'loved', 'calm', 'proud', 'grateful', 'fun', 'enjoyed', 'better', 'excited', 'relaxed', 'peaceful', 'shipped', 'finally', 'win', 'won', 'beautiful', 'glad', 'smile', 'thankful'],
    anxious: ['worried', 'worry', 'anxious', 'stress', 'stressed', 'nervous', 'afraid', 'scared', 'pressure', 'deadline', 'overwhelmed', 'panic', 'fail', 'failed', 'letting', 'fine', 'couldn’t', "couldn't", 'can’t', "can't", 'sad', 'angry', 'lonely', 'hurt'],
    drained: ['tired', 'slept', 'sleep', 'sleepy', 'exhausted', 'coffee', 'drained', 'late', 'barely', 'blur', 'long', 'quiet', 'rest', 'burned', 'burnt', 'hours'],
  };

  var TOPICS = [
    { words: ['deadline', 'meeting', 'meetings', 'team', 'work', 'project', 'boss', 'office', 'demo'], label: 'work' },
    { words: ['friends', 'friend', 'family', 'mom', 'dad', 'partner', 'dinner'], label: 'the people around you' },
    { words: ['slept', 'sleep', 'coffee', 'evening', 'tired', 'rest'], label: 'rest' },
    { words: ['beach', 'rode', 'ride', 'walk', 'run', 'outside', 'sea', 'park'], label: 'getting outside' },
  ];

  var MOODS = {
    content: {
      label: 'Content',
      color: '#7ee79b',
      lines: [
        'This reads like a good day — the kind worth remembering on a worse one.',
        'Most of the warmth in it sits around {topic}.',
        'A question to sit with: what would it take to have one more day like this, this week?',
      ],
    },
    anxious: {
      label: 'Under pressure',
      color: '#ffb340',
      lines: [
        'There’s a lot of pressure in this entry, most of it around {topic}.',
        'Worry tends to shrink once it’s written down — and you just did that.',
        'A question to sit with: what is one thing you could hand off, or let go of, tomorrow?',
      ],
    },
    drained: {
      label: 'Running low',
      color: '#93c5fd',
      lines: [
        'You sound like you’re running on empty, especially around {topic}.',
        'Getting through a day isn’t the same as living it. Both still count.',
        'A question to sit with: what would make tonight actually restful?',
      ],
    },
    reflective: {
      label: 'Reflective',
      color: '#c4b5fd',
      lines: [
        'A quiet, reflective entry.',
        'Nothing here needs fixing — sometimes writing it down is the whole point.',
        'A question to sit with: what do you want to remember about today?',
      ],
    },
  };

  function analyse(text) {
    var words = text.toLowerCase().match(/[a-z’']+/g) || [];
    var score = { content: 0, anxious: 0, drained: 0 };
    words.forEach(function (w) {
      Object.keys(LEXICON).forEach(function (k) {
        if (LEXICON[k].indexOf(w) !== -1) score[k]++;
      });
    });
    var mood = 'reflective';
    var best = 0;
    Object.keys(score).forEach(function (k) {
      if (score[k] > best) { best = score[k]; mood = k; }
    });
    var topic = 'your day';
    for (var i = 0; i < TOPICS.length; i++) {
      if (TOPICS[i].words.some(function (w) { return words.indexOf(w) !== -1; })) { topic = TOPICS[i].label; break; }
    }
    return { mood: mood, topic: topic, words: words.length };
  }

  function initDemo() {
    var root = $('[data-journal-demo]');
    if (!root) return;

    var entry = $('[data-entry]', root);
    var reflect = $('[data-reflect]', root);
    var wordsEl = $('[data-words]', root);
    var consoleEl = $('[data-console]', root);
    var stateEl = $('[data-state]', root);
    var tokensEl = $('[data-tokens]', root);
    var timeEl = $('[data-time]', root);
    var output = $('[data-output]', root);
    var offline = $('[data-offline]', root);
    var netLabel = $('[data-net-label]', root);
    var dateEl = $('[data-demo-date]', root);
    var busy = false;
    var runs = 0;

    try {
      dateEl.textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    } catch (err) { /* keep "Today" */ }

    function countWords() {
      var n = (entry.value.trim().match(/\S+/g) || []).length;
      wordsEl.textContent = n + (n === 1 ? ' word' : ' words');
    }
    entry.addEventListener('input', countWords);

    root.querySelectorAll('[data-sample]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        entry.value = SAMPLES[parseInt(btn.getAttribute('data-sample'), 10)];
        countWords();
        entry.focus();
      });
    });

    offline.addEventListener('change', function () {
      netLabel.textContent = offline.checked ? 'Network: off · requests: 0' : 'Network: on · requests: 0';
      if (window.SITE && window.SITE.toast && offline.checked) window.SITE.toast('Airplane mode on — it still works');
    });

    function setState(label, cls) {
      stateEl.textContent = label;
      consoleEl.classList.remove('is-thinking', 'is-done');
      if (cls) consoleEl.classList.add(cls);
    }

    reflect.addEventListener('click', function () {
      if (busy) return;
      var text = entry.value.trim();
      if (!text) {
        entry.focus();
        entry.setAttribute('placeholder', 'Write a line or two first — or pick a sample above.');
        return;
      }

      busy = true;
      runs++;
      reflect.disabled = true;
      var result = analyse(text);
      var mood = MOODS[result.mood];
      var lines = mood.lines.map(function (l) { return l.replace('{topic}', result.topic); });
      var reply = lines.join(' ');
      var tokens = reply.split(/(\s+)/).filter(Boolean);
      var promptTokens = Math.round(result.words * 1.3);
      var start = performance.now();

      setState('Thinking…', 'is-thinking');
      output.innerHTML = '';
      tokensEl.textContent = String(promptTokens);

      var clock = setInterval(function () {
        timeEl.textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
      }, 60);

      // A short "prefill" pause, then the reply streams in token by token.
      setTimeout(function () {
        setState('Writing…', 'is-thinking');
        var badge = document.createElement('span');
        badge.className = 'aj-output__mood';
        badge.style.setProperty('--mood', mood.color);
        badge.innerHTML = '<i aria-hidden="true"></i>' + mood.label;
        var para = document.createElement('p');
        var textNode = document.createTextNode('');
        var cursor = document.createElement('span');
        cursor.className = 'aj-output__cursor';
        cursor.setAttribute('aria-hidden', 'true');
        para.appendChild(textNode);
        para.appendChild(cursor);
        output.appendChild(badge);
        output.appendChild(para);

        var i = 0;
        var generated = 0;
        function finish() {
          clearInterval(clock);
          timeEl.textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
          cursor.remove();
          setState(runs > 1 && offline.checked ? 'Done · offline' : 'Done', 'is-done');
          busy = false;
          reflect.disabled = false;
        }
        if (reducedMotion) {
          textNode.textContent = reply;
          tokensEl.textContent = String(promptTokens + tokens.length);
          finish();
          return;
        }
        (function step() {
          if (i >= tokens.length) return finish();
          textNode.textContent += tokens[i];
          if (!/^\s+$/.test(tokens[i])) generated++;
          tokensEl.textContent = String(promptTokens + generated);
          i++;
          setTimeout(step, /[.?]$/.test(tokens[i - 1]) ? 180 : 28 + Math.random() * 30);
        })();
      }, reducedMotion ? 0 : 650);
    });
  }

  function boot() {
    initHero();
    initDemo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
