/*
 * The one interaction on this page: the pantry.
 *
 * The design's whole premise was that what you own decides what you see, so
 * ticking an ingredient re-scores every recipe and the list reorders itself,
 * FLIP-animated. Nothing else on the page is interactive — it was a Figma
 * exercise, and this is only the idea, made clickable.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-pantry]');
  if (!root) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var list = root.querySelector('[data-pantry-recipes]');
  var live = root.querySelector('[data-pantry-live]');
  var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-has]'));

  var RECIPES = [
    { name: 'Mayo Meatball', needs: ['mayo', 'potatoes', 'parsley', 'garlic'] },
    { name: 'Garlic Chicken', needs: ['chicken', 'garlic', 'rice'] },
    { name: 'Omelette', needs: ['eggs', 'cheese', 'parsley'] },
    { name: 'Fried rice', needs: ['rice', 'eggs', 'garlic', 'chicken'] },
  ];

  var LABELS = {};
  buttons.forEach(function (b) { LABELS[b.getAttribute('data-has')] = b.textContent.trim(); });

  // One row per recipe, built once and then only re-scored and re-ordered.
  var rows = RECIPES.map(function (recipe) {
    var el = document.createElement('article');
    el.className = 'rcp-recipe';
    el.innerHTML =
      '<span class="rcp-ring"><b></b></span>' +
      '<div><h4></h4><p></p></div>' +
      '<span class="rcp-recipe__go">' + (window.SITE && window.SITE.icon ? window.SITE.icon('arrow-right') : '') + '</span>';
    el.querySelector('h4').textContent = recipe.name;
    list.appendChild(el);
    return { recipe: recipe, el: el, ring: el.querySelector('.rcp-ring'), count: el.querySelector('.rcp-ring b'), note: el.querySelector('p') };
  });

  function owned() {
    var set = {};
    buttons.forEach(function (b) {
      if (b.getAttribute('aria-pressed') === 'true') set[b.getAttribute('data-has')] = true;
    });
    return set;
  }

  function render(announce) {
    var have = owned();
    var before = rows.map(function (r) { return r.el.getBoundingClientRect().top; });

    rows.forEach(function (row) {
      var needs = row.recipe.needs;
      var missing = needs.filter(function (n) { return !have[n]; });
      var got = needs.length - missing.length;
      row.score = got / needs.length;
      row.count.textContent = got + '/' + needs.length;
      row.ring.style.setProperty('--p', row.score.toFixed(3));
      row.el.classList.toggle('is-ready', missing.length === 0);
      row.note.textContent = missing.length === 0
        ? 'Everything in the kitchen'
        : 'Missing ' + missing.map(function (m) { return (LABELS[m] || m).toLowerCase(); }).join(', ');
    });

    var order = rows.slice().sort(function (a, b) {
      return b.score - a.score || a.recipe.needs.length - b.recipe.needs.length;
    });
    order.forEach(function (row) { list.appendChild(row.el); });

    if (!reducedMotion && list.getAnimations) {
      rows.forEach(function (row, i) {
        var dy = before[i] - row.el.getBoundingClientRect().top;
        if (Math.abs(dy) < 0.5) return;
        row.el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }], {
          duration: 420,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        });
      });
    }

    if (announce) {
      var ready = rows.filter(function (r) { return r.score === 1; }).length;
      live.textContent = ready
        ? ready + (ready === 1 ? ' recipe' : ' recipes') + ' you can cook right now'
        : 'Nothing you can cook yet — ' + order[0].recipe.name + ' is closest';
    }
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
      render(true);
    });
  });

  render(false);
})();
