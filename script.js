/* VIZOR — поведінка сторінки: меню, поява блоків, форма бронювання, запуск 3D-сцени. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Навігація ---------- */
  var nav = $('#nav');
  var toggle = $('.nav__toggle');
  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрити меню' : 'Відкрити меню');
  }
  toggle.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });
  $$('.nav__links a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
  });

  var hero = $('#top');
  if ('IntersectionObserver' in window) {
    /* Шапка отримує тло й кнопку «Забронювати», коли перший екран майже прокручено. */
    new IntersectionObserver(function (en) {
      nav.classList.toggle('is-stuck', !en[0].isIntersecting);
    }, { rootMargin: '-45% 0px 0px 0px', threshold: 0 }).observe(hero);
  }

  /* ---------- М'яка поява блоків ---------- */
  var reveals = $$('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var sibs = el.parentElement ? $$(':scope > .reveal', el.parentElement) : [el];
        el.style.transitionDelay = Math.min(sibs.indexOf(el), 4) * 70 + 'ms';
        el.classList.add('is-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  $('#year').textContent = String(new Date().getFullYear());

  /* ---------- Бронювання ---------- */
  /* [уточнити] Ціни мають збігатися з блоком «Ціни» в index.html.
     per: 'p' — за людину, 'g' — за компанію/заїзд. */
  var PRICES = {
    station30: { code: 'S-01', label: 'VR-станція, 30 хв', price: 200, per: 'p', max: 4 },
    station60: { code: 'S-02', label: 'VR-станція, 60 хв', price: 350, per: 'p', max: 4 },
    student:   { code: 'S-03', label: 'Студентська година', price: 280, per: 'p', max: 4 },
    arena:     { code: 'A-01', label: 'Арена, місце в команді', price: 400, per: 'p', max: 6 },
    arenafull: { code: 'A-02', label: 'Арена цілком', price: 2000, per: 'g', max: 6 },
    sim15:     { code: 'R-01', label: 'Автосимулятор, 15 хв', price: 150, per: 'p', max: 2 },
    sim30:     { code: 'R-02', label: 'Автосимулятор, 30 хв', price: 250, per: 'g', max: 2 },
    quest:     { code: 'Q-01', label: 'VR-квест', price: 1400, per: 'g', max: 4 },
    party:     { code: 'DN-10', label: 'День народження «Десятка»', price: 5500, per: 'g', max: 10 }
  };
  var form = $('#booking-form');
  var f = {
    name: $('#f-name'), phone: $('#f-phone'), date: $('#f-date'),
    time: $('#f-time'), format: $('#f-format'), people: $('#f-people')
  };
  var out = {
    no: $('#p-no'), name: $('#p-name'), date: $('#p-date'), time: $('#p-time'),
    format: $('#p-format'), people: $('#p-people'), sum: $('#p-sum')
  };
  var statusEl = $('#form-status');

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' грн'; }

  var today = new Date();
  var last = new Date(); last.setDate(last.getDate() + 60);
  f.date.min = iso(today);
  f.date.max = iso(last);

  /* Слоти залежать від дня: будні з 13:00, вихідні з 10:00; останній старт о 20:00. */
  function fillSlots() {
    var keep = f.time.value;
    var from = 10;
    if (f.date.value) {
      var d = new Date(f.date.value + 'T12:00:00');
      var wd = d.getDay();
      from = (wd === 0 || wd === 6) ? 10 : 13;
    }
    while (f.time.options.length > 1) f.time.remove(1);
    for (var h = from; h <= 20; h++) f.time.add(new Option(pad(h) + ':00'));
    f.time.value = keep;
    if (f.time.value !== keep) f.time.value = '';
  }

  function renderPass() {
    var fmt = PRICES[f.format.value];
    var n = Math.max(1, Math.min(10, parseInt(f.people.value, 10) || 1));
    out.name.textContent = f.name.value.trim() || '—';
    if (f.date.value) {
      var d = new Date(f.date.value + 'T12:00:00');
      out.date.textContent = d.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' });
    } else { out.date.textContent = '—'; }
    out.time.textContent = f.time.value || '—';
    out.format.textContent = fmt ? fmt.label : '—';
    out.people.textContent = String(n);
    out.no.textContent = fmt ? fmt.code : 'S-00';
    out.sum.textContent = fmt ? '≈ ' + money(fmt.per === 'p' ? fmt.price * n : fmt.price) : '—';
  }

  function onFormat() {
    var fmt = PRICES[f.format.value];
    f.people.max = fmt ? fmt.max : 10;
    if (fmt && parseInt(f.people.value, 10) > fmt.max) f.people.value = fmt.max;
  }

  f.date.addEventListener('change', function () { fillSlots(); renderPass(); });
  f.format.addEventListener('change', function () { onFormat(); renderPass(); });
  form.addEventListener('input', renderPass);
  fillSlots(); renderPass();

  /* Клік по квитку в цінах підставляє формат у форму. */
  $$('[data-format]').forEach(function (el) {
    el.addEventListener('click', function () {
      f.format.value = el.getAttribute('data-format');
      onFormat(); renderPass();
    });
  });

  function showStatus(kind, text) {
    statusEl.hidden = false;
    statusEl.className = 'form__status ' + (kind === 'ok' ? 'is-ok' : 'is-err');
    statusEl.textContent = text;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    statusEl.hidden = true;
    if (!form.checkValidity()) {
      var bad = $(':invalid', form);
      showStatus('err', 'Перевір поля: потрібні ім\'я, телефон, дата, час, формат і кількість людей.');
      if (bad) bad.focus();
      return;
    }
    var btn = $('button[type="submit"]', form);
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Надсилаємо…';
    var done = function () { btn.disabled = false; btn.textContent = label; };
    var okText = 'Заявку прийнято. Передзвонимо або напишемо, щоб підтвердити час.';

    /* Поки в action стоїть заглушка, нічого не надсилаємо: це демо. */
    if (form.action.indexOf('YOUR_FORM_ID') !== -1) {
      setTimeout(function () {
        done();
        showStatus('ok', okText + ' (Демо-режим: форма ще не підключена, дані нікуди не надіслано.)');
      }, 500);
      return;
    }

    var data = new FormData(form);
    var fmt = PRICES[f.format.value];
    if (fmt) data.set('format', fmt.label);
    fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        form.reset(); fillSlots(); onFormat(); renderPass();
        showStatus('ok', okText);
      })
      .catch(function () {
        showStatus('err', 'Не вдалося надіслати заявку. Спробуй ще раз або напиши нам у Telegram чи подзвони.');
      })
      .then(done);
  });

  /* ---------- 3D-сцена першого екрана ---------- */
  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (err) { return false; }
  }

  function startScene() {
    var canvas = $('#scene');
    var mobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    import('./scene.js').then(function (mod) {
      window.__vizor = mod.initHero({
        canvas: canvas, hero: hero, anchor: $('#poster'), mobile: mobile,
        onFirstFrame: function () { hero.classList.add('is-live'); },
        onHelmet: function () { hero.classList.add('has-helmet'); },
        onError: function (err) {
          /* Модель не завантажилась: лишаємо постер, стрічка продовжує жити. */
          if (window.console) console.warn('VIZOR: 3D-шолом недоступний, показуємо постер.', err && err.message);
        }
      });
    }).catch(function () { hero.classList.add('is-static'); });
  }

  if (reduced || !hasWebGL()) {
    hero.classList.add('is-static'); /* статичний постер і статична стрічка, без руху */
  } else {
    /* Спершу текст і постер, сцена — після першої відрисовки. */
    var kick = function () {
      if ('requestIdleCallback' in window) requestIdleCallback(startScene, { timeout: 1200 });
      else setTimeout(startScene, 200);
    };
    if (document.readyState === 'complete') kick();
    else window.addEventListener('load', kick, { once: true });
  }
})();
