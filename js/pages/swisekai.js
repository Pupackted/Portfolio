/*
 * SwiSekai: a playable lesson with Taylor, and the quest map that fills in as
 * the features scroll past.
 *
 * Taylor's replies are scripted — this page makes no API calls — but they
 * stream in token by token and drive the same three moods the app's mentor
 * has: thinking, happy and pout.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var icon = function (name) { return window.SITE && window.SITE.icon ? window.SITE.icon(name) : ''; };

  /* ── The lesson ─────────────────────────────────────────────────────── */

  // Backticks mark code in both prompts and replies.
  var QUESTIONS = [
    {
      q: 'Which Swift data type is used to store text?',
      options: ['`Int`', '`String`', '`Bool`', '`Double`'],
      answer: 1,
      right: 'Exactly — `String` holds text. Write `let name = "Taylor"` and Swift even infers the type for you.',
      wrong: [
        'Not quite — `Int` only holds whole numbers, like 42. Text lives in a `String`.',
        '',
        '`Bool` is just true or false. Text lives in a `String`.',
        '`Double` is for decimals, like 3.14. For text you want `String`.',
      ],
    },
    {
      q: 'Which keyword declares a constant?',
      options: ['`var`', '`let`', '`const`', '`static`'],
      answer: 1,
      right: 'Yes! `let` makes a constant — set it once and it can’t change. Reach for `let` by default, and `var` only when you need to.',
      wrong: [
        'Close! `var` declares a variable you can change later. For a constant, Swift uses `let`.',
        '',
        'That’s JavaScript talking. In Swift, constants use `let`.',
        '`static` belongs to a type, not to constants. The keyword you want is `let`.',
      ],
    },
    {
      q: 'What does `String?` mean?',
      options: ['A String, or nil', 'An empty String', 'An array of Strings', 'A String that’s required'],
      answer: 0,
      right: 'Right — the question mark makes it an optional. It holds a `String` or nothing at all, and Swift makes you unwrap it safely.',
      wrong: 'Not quite. The `?` marks an optional: a `String`, or `nil`. Swift makes you check before you use it.',
    },
    {
      q: 'How do you put a value inside a string?',
      options: ['`"Score: " + score`', '`"Score: \\(score)"`', '`"Score: ${score}"`', '`"Score: %score"`'],
      answer: 1,
      right: 'That’s string interpolation — `\\(score)` drops the value right into the text. Clean, right?',
      wrong: 'Almost — that works in other languages. In Swift, interpolation looks like `\\(score)`.',
    },
  ];

  var XP_PER_LEVEL = 200;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function markup(text) {
    return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function segments(text) {
    return text.split(/(`[^`]+`)/).filter(Boolean).map(function (part) {
      return part.charAt(0) === '`' ? { code: true, text: part.slice(1, -1) } : { code: false, text: part };
    });
  }

  function initLesson() {
    var root = $('[data-lesson]');
    if (!root) return;

    var questionEl = $('[data-question]', root);
    var optionsEl = $('[data-options]', root);
    var countEl = $('[data-count-label]', root);
    var hintEl = $('[data-hint]', root);
    var nextBtn = $('[data-next]', root);
    var mentor = $('[data-mentor]', root);
    var moodLabel = $('[data-mood-label]', root);
    var chat = $('[data-chat]', root);
    var xpEl = $('[data-xp]', root);
    var xpFill = $('[data-xp-fill]', root);
    var xpGain = $('[data-xp-gain]', root);
    var levelEl = $('[data-level]', root);

    var index = 0;
    var xp = 120;
    var level = 3;
    var busy = false;

    function setMood(mood) {
      mentor.setAttribute('data-mood', mood);
      moodLabel.textContent = mood === 'thinking' ? 'Thinking…' : mood === 'happy' ? 'Happy' : 'Pout';
    }

    function renderXp() {
      xpEl.textContent = String(xp);
      levelEl.textContent = String(level);
      xpFill.style.setProperty('--xp', (xp / XP_PER_LEVEL).toFixed(3));
    }

    function render() {
      var item = QUESTIONS[index];
      countEl.textContent = 'Question ' + (index + 1) + ' of ' + QUESTIONS.length;
      questionEl.innerHTML = markup(item.q);
      optionsEl.innerHTML = item.options.map(function (opt, i) {
        return '<button class="swi-option" type="button" data-i="' + i + '" aria-pressed="false">' +
          '<span class="swi-option__key">' + 'ABCD'.charAt(i) + '</span>' +
          '<span>' + markup(opt) + '</span>' +
          icon('check') +
        '</button>';
      }).join('');
      hintEl.textContent = 'Pick an answer.';
      nextBtn.classList.remove('is-on');
    }

    function addBubble(who, html) {
      var p = document.createElement('p');
      p.className = 'swi-bubble swi-bubble--' + (who === 'You' ? 'you' : 'taylor');
      p.innerHTML = '<span class="swi-bubble__who">' + who + '</span>' + (html || '');
      chat.appendChild(p);
      // Keep the conversation short enough to read at a glance.
      while (chat.children.length > 4) chat.removeChild(chat.firstElementChild);
      return p;
    }

    function stream(bubble, text, done) {
      var segs = segments(text);
      var cursor = document.createElement('span');
      cursor.className = 'swi-cursor';
      cursor.setAttribute('aria-hidden', 'true');

      if (reducedMotion) {
        bubble.insertAdjacentHTML('beforeend', markup(text));
        done();
        return;
      }

      var s = 0;
      var w = 0;
      var target = null;
      var words = [];
      bubble.appendChild(cursor);

      (function step() {
        if (!target) {
          if (s >= segs.length) {
            cursor.remove();
            done();
            return;
          }
          target = document.createElement(segs[s].code ? 'code' : 'span');
          bubble.insertBefore(target, cursor);
          words = segs[s].text.split(/(\s+)/).filter(Boolean);
          w = 0;
        }
        target.textContent += words[w];
        w++;
        if (w >= words.length) {
          target = null;
          s++;
        }
        setTimeout(step, 22 + Math.random() * 38);
      })();
    }

    optionsEl.addEventListener('click', function (event) {
      var btn = event.target.closest('.swi-option');
      if (!btn || busy) return;
      busy = true;

      var item = QUESTIONS[index];
      var picked = parseInt(btn.getAttribute('data-i'), 10);
      var correct = picked === item.answer;
      var buttons = $$('.swi-option', optionsEl);

      buttons.forEach(function (b, i) {
        b.disabled = true;
        b.setAttribute('aria-pressed', String(i === picked));
        if (i === item.answer) b.classList.add('is-right');
      });
      if (!correct) {
        btn.classList.add('is-wrong');
        btn.querySelector('use').setAttribute('href', '#i-x');
      }

      var pickedText = item.options[picked].replace(/`/g, '');
      addBubble('You', 'I think it’s ' + markup('`' + pickedText + '`') + '.');

      setMood('thinking');
      var bubble = addBubble('Taylor', '<span class="swi-typing" aria-label="Taylor is typing"><i></i><i></i><i></i></span>');
      hintEl.textContent = 'Taylor is thinking…';

      setTimeout(function () {
        bubble.querySelector('.swi-typing').remove();
        var reply = correct ? item.right : (Array.isArray(item.wrong) ? item.wrong[picked] : item.wrong);
        stream(bubble, reply, function () {
          setMood(correct ? 'happy' : 'pout');
          if (correct) {
            xp += 10;
            if (xp >= XP_PER_LEVEL) {
              xp -= XP_PER_LEVEL;
              level++;
              hintEl.textContent = 'Level up! You’re now level ' + level + '.';
            } else {
              hintEl.textContent = 'Correct — +10 XP.';
            }
            renderXp();
            xpGain.classList.remove('is-on');
            void xpGain.offsetWidth;
            xpGain.classList.add('is-on');
          } else {
            hintEl.textContent = 'Not quite — see Taylor’s note.';
          }
          nextBtn.classList.add('is-on');
          busy = false;
        });
      }, reducedMotion ? 0 : 750);
    });

    nextBtn.addEventListener('click', function () {
      index = (index + 1) % QUESTIONS.length;
      render();
      var first = $('.swi-option', optionsEl);
      if (first) first.focus({ preventScroll: true });
    });

    renderXp();
    render();
  }

  /* ── The quest map ──────────────────────────────────────────────────── */

  function initQuest() {
    var quest = $('[data-quest]');
    if (!quest || !('IntersectionObserver' in window)) return;

    var steps = $$('[data-quest-step]', quest);
    var nodes = $$('[data-node]', quest);
    var gems = $$('[data-gem]', quest);
    var summit = $('[data-summit]', quest);
    var map = $('[data-map]', quest);
    var trail = $('.swi-map__trail-lit', quest);

    // Where each node sits along the trail, measured once from the path.
    var stops = [];
    if (trail && trail.getTotalLength) {
      var total = trail.getTotalLength();
      var samples = [];
      for (var k = 0; k <= 400; k++) {
        var pt = trail.getPointAtLength((k / 400) * total);
        samples.push({ x: pt.x, y: pt.y, t: k / 400 });
      }
      nodes.forEach(function (node) {
        var x = parseFloat(node.style.left);
        var y = parseFloat(node.style.top) - 16; // the hexagon's centre, above its label
        var best = samples[0];
        var bestD = Infinity;
        samples.forEach(function (s) {
          var d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
          if (d < bestD) { bestD = d; best = s; }
        });
        stops.push(best.t);
      });
    }

    function setActive(i) {
      steps.forEach(function (s, j) { s.classList.toggle('is-active', j === i); });
      nodes.forEach(function (n, j) {
        n.classList.toggle('is-done', j < i);
        n.classList.toggle('is-now', j === i);
      });
      gems.forEach(function (g, j) { g.classList.toggle('is-done', j < i); });
      var last = i === steps.length - 1;
      summit.classList.toggle('is-now', last);
      if (map) map.style.setProperty('--trail', String(last ? 1 : stops[i] || 0));
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(steps.indexOf(entry.target));
      });
    }, { rootMargin: '-46% 0px -46% 0px' });
    steps.forEach(function (s) { io.observe(s); });
    setActive(0);
  }

  function boot() {
    initLesson();
    initQuest();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
