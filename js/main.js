/* ==========================================================================
   Chez Virginie : interactions, réservation (SMS / .ics, sans back-end) et motion design.
   Dépendances locales : GSAP 3.12 + ScrollTrigger, Lenis (js/vendor/).
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var html = document.documentElement;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]reduced=1/.test(location.search);
  var finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var hasGSAP = !!(window.gsap && window.ScrollTrigger);
  if (reduced || !hasGSAP) html.classList.add('reduced');
  if (!hasGSAP) html.classList.add('no-anim');

  var PHONE_INTL = '+33660057205';
  var PHONE_SHOWN = '06 60 05 72 05';
  var ADDRESS = "130 rue du Revol, 84240 La Tour-d'Aigues";
  var HOURS = { 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19], 6: [9, 14] }; // 0 = dimanche
  var DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  var lenis = null;
  var menuOpen = false;

  /* ------------------------------------------------------------------ *
   * Heure de Paris, statut « ouvert / fermé », horaires du jour
   * ------------------------------------------------------------------ */
  function parisNow() {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { day: map[o.weekday], h: parseInt(o.hour, 10), m: parseInt(o.minute, 10) };
  }
  function initStatus() {
    var el = $('#status'); if (!el) return;
    var n = parisNow(), t = n.h + n.m / 60, span = $('span', el);
    var today = HOURS[n.day], text = '';
    $$('#hours li').forEach(function (li) { li.classList.toggle('is-today', Number(li.dataset.d) === n.day); });
    if (today && t >= today[0] && t < today[1]) {
      el.classList.add('is-open'); text = 'Ouvert maintenant · jusqu’à ' + today[1] + 'h';
    } else if (today && t < today[0]) {
      text = 'Fermé · ouvre aujourd’hui à ' + today[0] + 'h';
    } else {
      for (var i = 1; i <= 7; i++) {
        var d = (n.day + i) % 7;
        if (HOURS[d]) { text = 'Fermé · rouvre ' + (i === 1 ? 'demain' : DAY_NAMES[d]) + ' à ' + HOURS[d][0] + 'h'; break; }
      }
    }
    span.textContent = text;
  }

  /* ------------------------------------------------------------------ *
   * Réservation sans back-end : SMS pré-rempli, copie, fichier .ics
   * ------------------------------------------------------------------ */
  function initBooking() {
    var form = $('#resaForm'); if (!form) return;
    var rows = $$('.row[data-id]');
    var byId = {};
    var sel = [];           // ids dans l'ordre de choix
    var chosenDay = null;   // Date (minuit local)
    var chosenTime = null;  // 'HH:MM'
    var touched = false;

    var chipsWrap = $('#serviceChips');
    var chipEls = {};

    /* chips groupés par catégorie, construits depuis la carte (source unique des prix) */
    $$('.cat').forEach(function (cat) {
      var label = $('.cat__title span', cat).textContent;
      var group = document.createElement('div'); group.className = 'chips__group';
      var lab = document.createElement('p'); lab.className = 'chips__label'; lab.textContent = label; group.appendChild(lab);
      $$('.row[data-id]', cat).forEach(function (r) {
        var price = r.dataset.price === '' ? null : Number(r.dataset.price);
        var s = { id: r.dataset.id, name: r.dataset.name.replace(/&amp;/g, '&'), price: price, row: r };
        byId[s.id] = s;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', 'false'); b.dataset.id = s.id;
        b.innerHTML = '<span></span><small></small>';
        $('span', b).textContent = s.name; $('small', b).textContent = price === null ? 'sur demande' : price + ' €';
        b.addEventListener('click', function () { toggle(s.id); });
        chipEls[s.id] = b; group.appendChild(b);
      });
      chipsWrap.appendChild(group);
    });

    function isOn(id) { return sel.indexOf(id) > -1; }
    function setPicked(id, on) {
      var i = sel.indexOf(id);
      if (on && i < 0) sel.push(id);
      if (!on && i > -1) sel.splice(i, 1);
      var s = byId[id]; if (!s) return;
      chipEls[id].setAttribute('aria-pressed', String(on));
      s.row.classList.toggle('is-picked', on);
      var use = $('use', s.row); if (use) use.setAttribute('href', on ? '#check' : '#plus');
      var btn = $('.row__add', s.row);
      if (btn) btn.setAttribute('aria-pressed', String(on));
    }
    function toggle(id) { setPicked(id, !isOn(id)); update(); }

    rows.forEach(function (r) {
      var b = $('.row__add', r);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { toggle(r.dataset.id); });
    });
    $$('[data-book]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var id = el.dataset.book;
        if (byId[id] && !isOn(id)) setPicked(id, true);
        update();
        if (el.tagName !== 'A') { e.preventDefault(); goTo('#reservation'); }
      });
    });

    /* jours : prochains jours d'ouverture */
    var daysWrap = $('#dayChips'), timesWrap = $('#timeChips');
    var fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
    var fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
    var fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    function sameDay(a, b) { return a && b && a.getTime() === b.getTime(); }
    function slotsFor(d) {
      var h = HOURS[d.getDay()]; if (!h) return [];
      var out = [], now = new Date(), isToday = sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      for (var m = h[0] * 60; m <= (h[1] - 1) * 60; m += 30) {
        var disabled = false;
        if (isToday) { var slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m); disabled = slot.getTime() < now.getTime() + 60 * 60 * 1000; }
        out.push({ label: pad(Math.floor(m / 60)) + ':' + pad(m % 60), disabled: disabled });
      }
      return out;
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function openDays() {
      var list = [], d = new Date(); d.setHours(0, 0, 0, 0);
      for (var i = 0; i < 40 && list.length < 14; i++) {
        var c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
        if (!HOURS[c.getDay()]) continue;
        if (slotsFor(c).every(function (s) { return s.disabled; })) continue;
        list.push(c);
      }
      return list;
    }
    openDays().forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'day'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', fmtLong.format(d));
      b.innerHTML = '<small>' + fmtDay.format(d).replace('.', '') + '</small><b>' + d.getDate() + '</b><span>' + fmtMonth.format(d).replace('.', '') + '</span>';
      b.addEventListener('click', function () {
        chosenDay = d; chosenTime = null;
        $$('.day', daysWrap).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        renderTimes(); update();
      });
      daysWrap.appendChild(b);
    });
    function renderTimes() {
      timesWrap.innerHTML = '';
      var hint = $('#timeHint');
      if (!chosenDay) { hint.textContent = 'choisissez d’abord un jour'; return; }
      var h = HOURS[chosenDay.getDay()];
      hint.textContent = 'ouvert de ' + h[0] + 'h à ' + h[1] + 'h';
      slotsFor(chosenDay).forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'time'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
        b.textContent = Number(s.label.slice(0, 2)) + 'h' + s.label.slice(3); b.disabled = s.disabled;
        b.addEventListener('click', function () {
          chosenTime = s.label;
          $$('.time', timesWrap).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
          update();
        });
        timesWrap.appendChild(b);
      });
    }
    renderTimes();

    /* champs */
    var fName = $('#fName'), fPhone = $('#fPhone'), fNote = $('#fNote'), fErr = $('#fErr');
    [fName, fPhone, fNote].forEach(function (f) { f.addEventListener('input', function () { f.removeAttribute('aria-invalid'); update(); }); });
    function phoneOK(v) { return /^(?:\+33|0033|0)[1-9]\d{8}$/.test(v.replace(/[\s.\-()]/g, '')); }
    function timeText(t) { var p = t.split(':'); return Number(p[0]) + 'h' + (p[1] === '00' ? '' : p[1]); }
    function listText(names) { return names.length > 1 ? names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1] : (names[0] || ''); }

    function message() {
      var names = sel.map(function (id) { return byId[id].name; });
      var m = 'Bonjour Virginie, je souhaite réserver : ' + listText(names) + ', le ' + fmtLong.format(chosenDay) + ' à ' + timeText(chosenTime) + '.';
      var n = fName.value.trim(), p = fPhone.value.trim();
      if (n) m += ' Je m’appelle ' + n + (p ? ' (' + p + ')' : '') + '.';
      var note = fNote.value.trim();
      if (note) m += ' ' + note + (/[.!?…]$/.test(note) ? '' : '.');
      return m + ' Pouvez-vous me confirmer ce créneau ? Merci !';
    }

    var smsBtn = $('#smsBtn'), copyBtn = $('#copyBtn'), icsBtn = $('#icsBtn');
    var recapText = $('#recapText'), recapTotal = $('#recapTotal'), svcCount = $('#svcCount');
    var picked = document.createElement('a');
    picked.className = 'picked'; picked.href = '#reservation'; picked.setAttribute('aria-live', 'polite');
    document.body.appendChild(picked);
    var resaInView = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { resaInView = e[0].isIntersecting; updatePicked(); }, { threshold: 0.15 }).observe($('#reservation'));
    }
    function updatePicked() {
      picked.classList.toggle('is-on', sel.length > 0 && !resaInView);
      picked.innerHTML = '<b>' + sel.length + '</b> ' + (sel.length > 1 ? 'soins choisis' : 'soin choisi') + ' · Voir ma réservation';
    }

    function update() {
      svcCount.textContent = sel.length ? sel.length + (sel.length > 1 ? ' choisis' : ' choisi') : 'aucun choisi';
      var ready = sel.length > 0 && chosenDay && chosenTime;
      var total = 0, unknown = 0;
      sel.forEach(function (id) { var p = byId[id].price; if (p === null) unknown++; else total += p; });
      if (ready) {
        recapText.textContent = listText(sel.map(function (id) { return byId[id].name; })) + ' · ' + fmtLong.format(chosenDay) + ' à ' + timeText(chosenTime);
      } else {
        var missing = [];
        if (!sel.length) missing.push('au moins un soin');
        if (!chosenDay) missing.push('un jour'); else if (!chosenTime) missing.push('une heure');
        recapText.textContent = 'Choisissez ' + listText(missing) + '.';
      }
      recapTotal.innerHTML = sel.length ? 'Estimation : <b>' + total + ' €</b>' + (unknown ? ' + ' + unknown + ' soin' + (unknown > 1 ? 's' : '') + ' sur demande' : '') + ' · prix confirmé par Virginie' : '';
      copyBtn.disabled = icsBtn.disabled = !ready;
      var valid = ready && fName.value.trim().length > 1 && phoneOK(fPhone.value);
      smsBtn.classList.toggle('is-disabled', !valid);
      smsBtn.setAttribute('aria-disabled', String(!valid));
      smsBtn.setAttribute('href', valid ? 'sms:' + PHONE_INTL + '?&body=' + encodeURIComponent(message()) : '#reservation');
      updatePicked();
    }

    function toast(msg) {
      var t = $('#toast'); t.textContent = msg;
      clearTimeout(toast._t); toast._t = setTimeout(function () { t.textContent = ''; }, 9000);
    }
    smsBtn.addEventListener('click', function (e) {
      if (smsBtn.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        var errs = [];
        if (!sel.length) errs.push('choisissez au moins un soin');
        else if (!chosenDay) errs.push('choisissez un jour');
        else if (!chosenTime) errs.push('choisissez une heure');
        if (fName.value.trim().length < 2) { fName.setAttribute('aria-invalid', 'true'); errs.push('indiquez votre prénom'); }
        if (!phoneOK(fPhone.value)) { fPhone.setAttribute('aria-invalid', 'true'); errs.push('indiquez un numéro de téléphone valide'); }
        fErr.textContent = 'Presque prêt : ' + errs.join(', ') + '.';
        if (!sel.length || !chosenDay || !chosenTime) $('#stepServices').scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        else (fName.getAttribute('aria-invalid') ? fName : fPhone).focus();
        return;
      }
      fErr.textContent = '';
      toast('Votre messagerie s’ouvre avec le message prêt. Rien ne s’ouvre ? Copiez le message et envoyez-le au ' + PHONE_SHOWN + '.');
    });
    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      return new Promise(function (res, rej) {
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy') ? res() : rej(); } catch (err) { rej(err); }
        document.body.removeChild(ta);
      });
    }
    copyBtn.addEventListener('click', function () {
      copyText(message()).then(function () { toast('Message copié. Collez-le dans un SMS ou WhatsApp au ' + PHONE_SHOWN + '.'); }, function () { toast('Copie impossible : appelez-nous au ' + PHONE_SHOWN + '.'); });
    });
    icsBtn.addEventListener('click', function () {
      var p = chosenTime.split(':').map(Number);
      var start = new Date(chosenDay.getFullYear(), chosenDay.getMonth(), chosenDay.getDate(), p[0], p[1]);
      var end = new Date(start.getTime() + 60 * 60 * 1000);
      var f = function (d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'; };
      var esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); };
      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      var desc = 'Demande de rendez-vous à confirmer par Virginie (' + PHONE_SHOWN + ').\n' + listText(sel.map(function (id) { return byId[id].name; }));
      var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chez Virginie//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
        'UID:' + Date.now() + '@chez-virginie', 'DTSTAMP:' + stamp, 'DTSTART:' + f(start), 'DTEND:' + f(end),
        'SUMMARY:' + esc('Chez Virginie – rendez-vous (à confirmer)'), 'LOCATION:' + esc(ADDRESS), 'DESCRIPTION:' + esc(desc),
        'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Rendez-vous Chez Virginie', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rendez-vous-chez-virginie.ics';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast('Fichier d’agenda téléchargé. N’oubliez pas d’envoyer la demande à Virginie !');
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); smsBtn.click(); });
    update();
  }

  /* ------------------------------------------------------------------ *
   * Navigation d'ancre (Lenis si dispo), menu mobile, dialogues, avis
   * ------------------------------------------------------------------ */
  function goTo(hash) {
    var el = typeof hash === 'string' ? $(hash) : hash;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: hash === '#top' ? 0 : -10, duration: 1.7, easing: function (t) { return 1 - Math.pow(1 - t, 4); } });
    else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  function initNavigation() {
    var burger = $('#burger'), menu = $('#menu');
    function setMenu(open) {
      menuOpen = open;
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      menu.classList.toggle('is-open', open);
      $('#nav').classList.toggle('menu-open', open);
      menu.setAttribute('aria-hidden', String(!open));
      if (menu.inert !== undefined) menu.inert = !open;
      if (lenis) open ? lenis.stop() : lenis.start();
      document.body.style.overflow = open && !lenis ? 'hidden' : '';
      if (open) { $('#nav').classList.remove('is-hidden'); var first = $('a', menu); first && setTimeout(function () { first.focus({ preventScroll: true }); }, 500); } else { burger.focus({ preventScroll: true }); }
    }
    if (menu.inert !== undefined) menu.inert = true;
    burger.addEventListener('click', function () { setMenu(!menuOpen); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) setMenu(false); });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var h = a.getAttribute('href'); if (h.length < 2) return;
      var t = $(h); if (!t) return;
      e.preventDefault();
      var wasOpen = menuOpen;
      if (wasOpen) { menuOpen = false; burger.setAttribute('aria-expanded', 'false'); menu.classList.remove('is-open'); $('#nav').classList.remove('menu-open'); menu.setAttribute('aria-hidden', 'true'); if (menu.inert !== undefined) menu.inert = true; document.body.style.overflow = ''; if (lenis) lenis.start(); }
      setTimeout(function () { goTo(h); try { history.replaceState(null, '', h); } catch (er) { } }, wasOpen ? 350 : 0);
    });
  }

  function initDialogs() {
    var lb = $('#lightbox'), shots = $$('.shot'), idx = 0;
    function show(i) {
      idx = (i + shots.length) % shots.length;
      var s = shots[idx], img = $('img', s);
      $('#lbImg').src = img.currentSrc || img.src; $('#lbImg').alt = img.alt;
      $('#lbCap').textContent = $('.shot__cap', s).textContent;
    }
    function open(i) { show(i); if (lb.showModal) lb.showModal(); else lb.setAttribute('open', ''); if (lenis) lenis.stop(); }
    function close() { if (lb.close) lb.close(); else lb.removeAttribute('open'); }
    shots.forEach(function (s, i) { s.addEventListener('click', function () { open(i); }); });
    $('#lbClose').addEventListener('click', close);
    $('#lbPrev').addEventListener('click', function () { show(idx - 1); });
    $('#lbNext').addEventListener('click', function () { show(idx + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    lb.addEventListener('close', function () { if (lenis && !menuOpen) lenis.start(); });
    lb.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') show(idx + 1); if (e.key === 'ArrowLeft') show(idx - 1); });

    var legal = $('#legal');
    $('#legalBtn').addEventListener('click', function () { legal.showModal ? legal.showModal() : legal.setAttribute('open', ''); if (lenis) lenis.stop(); });
    $('#legalClose').addEventListener('click', function () { legal.close ? legal.close() : legal.removeAttribute('open'); });
    legal.addEventListener('close', function () { if (lenis) lenis.start(); });
    legal.addEventListener('click', function (e) { if (e.target === legal) legal.close(); });
  }

  function initReviews() {
    var rail = $('#avisRail'); if (!rail) return;
    var bar = $('.avis__bar i'), cards = $$('.rev', rail);
    function step() { return cards[0].getBoundingClientRect().width + parseFloat(getComputedStyle($('.avis__track', rail)).columnGap || 24); }
    function prog() { var max = rail.scrollWidth - rail.clientWidth; var p = max > 0 ? rail.scrollLeft / max : 1; bar.style.transform = 'scaleX(' + (0.1 + 0.9 * p) + ')'; }
    rail.addEventListener('scroll', prog, { passive: true }); prog();
    $('#avisNext').addEventListener('click', function () { rail.scrollBy({ left: step(), behavior: 'smooth' }); });
    $('#avisPrev').addEventListener('click', function () { rail.scrollBy({ left: -step(), behavior: 'smooth' }); });
    /* glisser à la souris */
    var down = false, sx = 0, sl = 0, moved = 0;
    rail.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; down = true; moved = 0; sx = e.clientX; sl = rail.scrollLeft; });
    window.addEventListener('pointermove', function (e) {
      if (!down) return; var dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx));
      if (moved > 4) { rail.classList.add('is-drag'); rail.scrollLeft = sl - dx; }
    });
    window.addEventListener('pointerup', function () { down = false; rail.classList.remove('is-drag'); });
    rail.addEventListener('click', function (e) { if (moved > 6) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
    /* défilement automatique doux, arrêté dès qu'on interagit */
    if (!reduced && 'IntersectionObserver' in window) {
      var inView = false, paused = false, timer;
      new IntersectionObserver(function (e) { inView = e[0].isIntersecting; }, { threshold: 0.35 }).observe(rail);
      ['pointerenter', 'focusin', 'touchstart', 'wheel'].forEach(function (ev) { rail.addEventListener(ev, function () { paused = true; }, { passive: true }); });
      timer = setInterval(function () {
        if (!inView || paused) return;
        var max = rail.scrollWidth - rail.clientWidth;
        if (rail.scrollLeft >= max - 8) rail.scrollTo({ left: 0, behavior: 'smooth' }); else rail.scrollBy({ left: step(), behavior: 'smooth' });
      }, 5200);
    }
  }

  /* ------------------------------------------------------------------ *
   * Utilitaires d'animation : découpe de texte, pétales
   * ------------------------------------------------------------------ */
  function splitNode(node, mode, out) {
    Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) {
        var frag = document.createDocumentFragment();
        var tokens = mode === 'chars' ? ch.textContent.split('') : ch.textContent.split(/(\s+)/);
        tokens.forEach(function (tok) {
          if (tok === '') return;
          if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
          var o = document.createElement('span'), i = document.createElement('span');
          o.className = mode === 'chars' ? 'c' : 'w'; i.className = mode === 'chars' ? 'ci' : 'wi';
          o.setAttribute('aria-hidden', 'true'); i.textContent = tok; o.appendChild(i); frag.appendChild(o); out.push(i);
        });
        node.replaceChild(frag, ch);
      } else if (ch.nodeType === 1) { splitNode(ch, mode, out); }
    });
    return out;
  }
  function split(el, mode) {
    if (el.__split) return el.__split;
    var label = el.textContent.replace(/\s+/g, ' ').trim();
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-hidden')) el.setAttribute('aria-label', label);
    el.__split = splitNode(el, mode, []);
    return el.__split;
  }

  var PETAL_COLORS = ['#E88CA2', '#F1C9C6', '#F8DFDA', '#BE405F', '#F4B7BF'];
  function spawnPetals(container, count, big) {
    if (!container) return [];
    var NS = 'http://www.w3.org/2000/svg', list = [];
    for (var i = 0; i < count; i++) {
      var near = big && i % 4 === 0;
      var size = near ? gsap.utils.random(50, 86) : gsap.utils.random(14, 38);
      var wrap = document.createElement('div'); wrap.className = 'petal'; wrap.style.setProperty('--s', size + 'px');
      if (near) wrap.style.filter = 'blur(2.5px)';
      var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 20 30');
      svg.style.fill = PETAL_COLORS[i % PETAL_COLORS.length]; svg.style.opacity = near ? .85 : gsap.utils.random(.55, .95);
      var use = document.createElementNS(NS, 'use'); use.setAttribute('href', '#petal-shape'); svg.appendChild(use);
      wrap.appendChild(svg); container.appendChild(wrap);
      var W = container.clientWidth || window.innerWidth, H = container.clientHeight || window.innerHeight;
      gsap.set(wrap, { x: gsap.utils.random(0, W), y: -100, rotation: gsap.utils.random(0, 360) });
      var fall = gsap.to(wrap, { y: H + 120, x: '+=' + gsap.utils.random(-140, 140), rotation: '+=' + gsap.utils.random(-300, 300), duration: near ? gsap.utils.random(9, 14) : gsap.utils.random(16, 28), ease: 'none', repeat: -1 });
      fall.progress(Math.random());
      gsap.to(svg, { x: gsap.utils.random(14, 46), rotationY: 180, rotation: gsap.utils.random(-25, 25), duration: gsap.utils.random(2.6, 5), ease: 'sine.inOut', yoyo: true, repeat: -1 });
      list.push(wrap);
    }
    return list;
  }

  /* ------------------------------------------------------------------ *
   * Animations (GSAP / ScrollTrigger / Lenis)
   * ------------------------------------------------------------------ */
  function initVideo() {
    var v = $('.hero__video'); if (!v || reduced) return;
    var conn = navigator.connection || {};
    if (!window.matchMedia('(min-width:768px)').matches || conn.saveData) return;
    v.preload = 'auto'; v.src = v.dataset.src;
    v.addEventListener('playing', function () { v.classList.add('is-playing'); });
    var tryPlay = function () { var p = v.play(); if (p && p.catch) p.catch(function () { }); };
    v.__play = tryPlay;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { if (e[0].isIntersecting) { if (v.__ready) tryPlay(); } else v.pause(); }, { threshold: 0.05 }).observe(v);
    }
  }

  function runLoader() {
    return new Promise(function (resolve) {
      var loader = $('#loader'); if (!loader) return resolve();
      var count = $('#loaderCount'), o = { v: 0 }, done = false;
      function finish() { if (done) return; done = true; resolve(); }
      var tl = gsap.timeline({ onComplete: function () { loader.remove(); finish(); } });
      tl.to('.loader__lotus', { strokeDashoffset: 0, duration: 1.5, ease: 'power2.inOut' }, 0)
        .to(o, { v: 100, duration: 1.9, ease: 'power2.inOut', onUpdate: function () { count.textContent = Math.round(o.v); } }, 0)
        .from('.loader__name', { yPercent: 40, opacity: 0, duration: 1, ease: 'expo.out' }, 0.2)
        .to('.loader__center', { yPercent: -25, opacity: 0, duration: 0.6, ease: 'power3.in' }, 2.0)
        .to('.loader__half--top', { yPercent: -101, duration: 1.15, ease: 'expo.inOut' }, 2.15)
        .to('.loader__half--bottom', { yPercent: 101, duration: 1.15, ease: 'expo.inOut' }, 2.15)
        .add(finish, 2.55);
      setTimeout(function () { if (!done) { loader.remove(); finish(); } }, 7000);
    });
  }

  function heroIntro() {
    var v = $('.hero__video'); if (v && v.src) { v.__ready = true; v.__play && v.__play(); }
    var tl = gsap.timeline({ defaults: { ease: 'expo.out' }, onComplete: heroScroll });
    tl.fromTo('.hero__media', { scale: 1.28 }, { scale: 1, duration: 2.6, ease: 'power3.out' }, 0)
      .fromTo('.hero__blush', { opacity: 0, scale: .6 }, { opacity: 1, scale: 1, duration: 2.4 }, 0.1)
      .to('.hero__title .ci', { yPercent: 0, rotate: 0, duration: 1.5, stagger: 0.05 }, 0.15)
      .to('.hero__fade', { opacity: 1, y: 0, duration: 1.2, stagger: 0.12 }, 0.55)
      .fromTo('.nav', { opacity: 0 }, { opacity: 1, duration: 1 }, 0.5)
      .add(function () { var d = $('.dock'); d && d.classList.add('is-on'); }, 1.2);
  }

  function heroScroll() {
    gsap.to('.hero__media', { yPercent: 14, scale: 1.1, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__blush', { yPercent: -35, xPercent: -10, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__petals', { yPercent: 28, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__inner', { yPercent: 12, opacity: 0.1, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '85% top', scrub: true } });
    if (finePointer) {
      var hero = $('.hero'), px = gsap.quickTo('.hero__petals', 'x', { duration: 1.4, ease: 'power3.out' }), bx = gsap.quickTo('.hero__blush', 'x', { duration: 1.8, ease: 'power3.out' });
      hero.addEventListener('pointermove', function (e) { var n = e.clientX / window.innerWidth - 0.5; px(n * -50); bx(n * 70); });
    }
  }

  function initAnimations() {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    /* smooth scroll */
    if (!reduced && window.Lenis) {
      lenis = new Lenis({ duration: 1.15, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }, smoothWheel: true, wheelMultiplier: 0.95 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
      lenis.stop();
    }

    /* état initial avant le loader */
    split($('.hero__line'), 'chars'); split($('.hero__line--it'), 'chars');
    gsap.set('.hero__fade', { y: 30 });
    gsap.set('.hero__title .ci', { yPercent: 118, rotate: 7 });
    $$('[data-split]').forEach(function (el) { var w = split(el, 'words'); gsap.set(w, { yPercent: 118 }); el.classList.add('is-split'); });
    var foot = $('[data-foot-big]'); var footChars = foot ? split(foot, 'chars') : []; gsap.set(footChars, { yPercent: 110 });
    var heroPetals = spawnPetals($('.hero__petals'), window.innerWidth < 900 ? 7 : 16, true);
    var ctaPetals = spawnPetals($('.cta__petals'), window.innerWidth < 900 ? 6 : 12, true);

    var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    Promise.all([ready, runLoader()]).then(function () { heroIn(); });
    function heroIn() { if (lenis) lenis.start(); heroIntro(); }

    /* titres : mots qui montent */
    $$('[data-split]').forEach(function (el) {
      var w = el.__split;
      ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: function () { gsap.to(w, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.055 }); } });
    });
    if (footChars.length) ScrollTrigger.create({ trigger: foot, start: 'top 95%', once: true, onEnter: function () { gsap.to(footChars, { yPercent: 0, duration: 1.5, ease: 'expo.out', stagger: 0.04 }); } });

    /* apparitions génériques */
    ScrollTrigger.batch('[data-reveal]', { start: 'top 90%', once: true, onEnter: function (els) { gsap.to(els, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1 }); } });

    /* affiches : cercle qui s'agrandit */
    $$('[data-reveal-circle]').forEach(function (el) {
      var img = $('img', el);
      gsap.fromTo(el, { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(78% at 50% 50%)', duration: 1.9, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 82%', once: true } });
      gsap.fromTo(img, { scale: 1.45 }, { scale: 1, duration: 2.4, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 82%', once: true } });
    });

    /* parallax d'images dans leur cadre */
    $$('[data-parallax]').forEach(function (img) {
      var frame = img.closest('.shot__frame') || img.closest('.cta__bg') || img.parentElement;
      var trig = img.closest('.cta') || frame;
      var r = img.closest('.cta__bg') ? 6 : 7;
      gsap.fromTo(img, { yPercent: -r }, { yPercent: r, ease: 'none', scrollTrigger: { trigger: trig, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    gsap.set('.shot', { opacity: 0, y: 70 });
    ScrollTrigger.batch('.shot', { start: 'top 93%', once: true, onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: 1.3, ease: 'expo.out', stagger: 0.12 }); } });

    /* compteurs */
    $$('[data-count]').forEach(function (el) {
      var end = parseFloat(el.dataset.count), dec = Number(el.dataset.decimals || 0), o = { v: 0 };
      var fmt = function (v) { return v.toFixed(dec).replace('.', ','); };
      el.textContent = fmt(0);
      ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: function () { gsap.to(o, { v: end, duration: 2.4, ease: 'power3.out', onUpdate: function () { el.textContent = fmt(o.v); } }); } });
    });

    /* rubans : vitesse et sens liés au scroll */
    $$('[data-marquee]').forEach(function (row) {
      var track = $('.ribbon__track', row), dir = Number(row.dataset.dir) || -1, base = track.innerHTML;
      track.insertAdjacentHTML('beforeend', base + base);
      var tw = gsap.fromTo(track, { xPercent: dir < 0 ? 0 : -100 / 3 }, { xPercent: dir < 0 ? -100 / 3 : 0, duration: 34, ease: 'none', repeat: -1 });
      row.__tw = tw;
    });
    ScrollTrigger.create({
      start: 0, end: 'max', onUpdate: function (self) {
        var boost = 1 + Math.min(Math.abs(self.getVelocity()) / 380, 5), target = self.direction * boost;
        $$('[data-marquee]').forEach(function (row) { gsap.to(row.__tw, { timeScale: target, duration: 0.5, overwrite: true, ease: 'power2.out' }); });
      }
    });

    /* navigation : se cache en descendant, revient en remontant */
    var nav = $('#nav');
    ScrollTrigger.create({
      start: 0, end: 'max', onUpdate: function (self) {
        var y = self.scroll();
        nav.classList.toggle('is-solid', y > 40);
        if (menuOpen) return;
        if (y > 260 && self.direction === 1) nav.classList.add('is-hidden'); else if (self.direction === -1 || y < 120) nav.classList.remove('is-hidden');
      }
    });
    gsap.to('.progress i', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

    /* sections épinglées / horizontales (desktop) et versions simples (mobile) */
    var mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', function () {
      /* storytelling : 4 étapes dans une section fixée */
      var story = $('.story'), steps = $$('.step', story), n = steps.length, num = $('#storyNum'), prog = $('.story__progress i');
      gsap.set(steps, { autoAlpha: 0 }); gsap.set(steps[0], { autoAlpha: 1 });
      var tl = gsap.timeline({
        defaults: { ease: 'power3.inOut' },
        scrollTrigger: {
          trigger: story, start: 'top top', end: function () { return '+=' + Math.round(window.innerHeight * (n - 0.35)); }, pin: $('.story__pin'), scrub: 0.7, anticipatePin: 1, invalidateOnRefresh: true
        },
        onUpdate: function () { var i = Math.min(n - 1, Math.floor(tl.time() + 0.35)); num.textContent = '0' + (i + 1); prog.style.setProperty('--p', Math.min(1, (tl.time() + 0.35) / n).toFixed(3)); }
      });
      steps.forEach(function (s, i) {
        if (i === 0) return;
        var t = i - 0.25, prev = steps[i - 1];
        tl.to($('.step__text', prev), { y: -50, opacity: 0, duration: 0.4 }, t - 0.1)
          .to($('.step__media', prev), { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.5 }, t - 0.1)
          .set(prev, { autoAlpha: 0 }, t + 0.42)
          .set(s, { autoAlpha: 1 }, t + 0.2)
          .fromTo($('.step__text', s), { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55 }, t + 0.2)
          .fromTo($('.step__media', s), { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6 }, t + 0.2)
          .fromTo($('.step__media img', s), { scale: 1.35 }, { scale: 1.06, duration: 0.7 }, t + 0.2);
      });
      tl.to({}, { duration: 0.35 });
      gsap.fromTo($('.step__media img', steps[0]), { scale: 1.3 }, { scale: 1.06, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: story, start: 'top 70%', once: true } });

      /* prestations : défilement horizontal piloté par le scroll vertical */
      var track = $('.soins__track'), bar = $('.soins__bar i');
      var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
      var h = gsap.to(track, {
        x: function () { return -dist(); }, ease: 'none',
        scrollTrigger: { trigger: '.soins', start: 'top top', end: function () { return '+=' + dist(); }, pin: $('.soins__pin'), scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true, onUpdate: function (s) { bar.style.transform = 'scaleX(' + s.progress + ')'; } }
      });
      $$('.card__img img').forEach(function (img) {
        gsap.fromTo(img, { xPercent: -5 }, { xPercent: 5, ease: 'none', scrollTrigger: { trigger: img.closest('.card'), containerAnimation: h, start: 'left right', end: 'right left', scrub: true } });
        img.style.transition = 'none';
      });
      return function () { };
    });
    mm.add('(max-width: 899px)', function () {
      $$('.step').forEach(function (s) {
        gsap.from($('.step__text', s), { y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 82%', once: true } });
        gsap.fromTo($('.step__media', s), { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 75%', once: true } });
      });
    });

    /* tilt 3D, boutons magnétiques, curseur */
    if (finePointer) {
      $$('.tilt').forEach(function (el) {
        var rx = gsap.quickTo(el, 'rotationX', { duration: 0.7, ease: 'power3.out' }), ry = gsap.quickTo(el, 'rotationY', { duration: 0.7, ease: 'power3.out' });
        gsap.set(el, { transformPerspective: 900 });
        el.addEventListener('pointermove', function (e) {
          if (e.pointerType !== 'mouse') return;
          var r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          ry((px - 0.5) * 12); rx(-(py - 0.5) * 12);
          el.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        });
        el.addEventListener('pointerleave', function () { rx(0); ry(0); });
      });
      $$('.magnetic').forEach(function (el) {
        var xTo = gsap.quickTo(el, 'x', { duration: 1, ease: 'elastic.out(1,.5)' }), yTo = gsap.quickTo(el, 'y', { duration: 1, ease: 'elastic.out(1,.5)' });
        el.addEventListener('pointermove', function (e) {
          var r = el.getBoundingClientRect();
          xTo((e.clientX - (r.left + r.width / 2)) * 0.3); yTo((e.clientY - (r.top + r.height / 2)) * 0.4);
        });
        el.addEventListener('pointerleave', function () { xTo(0); yTo(0); });
      });
      var cur = $('.cursor'), cx = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'power3.out' }), cy = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'power3.out' });
      window.addEventListener('pointermove', function (e) { cur.classList.add('is-on'); cx(e.clientX); cy(e.clientY); });
      document.addEventListener('pointerover', function (e) {
        var t = e.target;
        cur.classList.toggle('is-drag', !!(t.closest && t.closest('.avis__rail') && !t.closest('a,button')));
        $('.cursor__label').textContent = cur.classList.contains('is-drag') ? 'Glisser' : '';
        cur.classList.toggle('is-link', !!(t.closest && t.closest('a,button,summary,.tilt,input,label')) && !cur.classList.contains('is-drag'));
      });
      document.addEventListener('pointerleave', function () { cur.classList.remove('is-on'); });
    }

    /* retour en haut */
    $$('[data-top]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); goTo('#top'); }); });

    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    window.addEventListener('resize', function () { /* ScrollTrigger gère le recalcul */ });
  }

  /* ------------------------------------------------------------------ *
   * Démarrage
   * ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () { /* no-op : script chargé en fin de body */ });
  var y = $('#year'); if (y) y.textContent = new Date().getFullYear();
  try { initStatus(); } catch (e) { }
  try { initBooking(); } catch (e) { console.error(e); }
  try { initNavigation(); initDialogs(); initReviews(); } catch (e) { console.error(e); }

  if (hasGSAP && !reduced) {
    try { initVideo(); initAnimations(); }
    catch (e) { console.error(e); html.classList.add('no-anim', 'reduced'); var l = $('#loader'); if (l) l.remove(); if (lenis) lenis.start(); }
  } else {
    var ld = $('#loader'); if (ld) ld.remove();
    var dk = $('.dock'); if (dk) dk.classList.add('is-on');
    if (reduced) $$('[data-count]').forEach(function (el) { /* valeurs finales déjà dans le HTML */ });
    $$('[data-top]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); goTo('#top'); }); });
  }
})();
