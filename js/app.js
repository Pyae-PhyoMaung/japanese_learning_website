/* ===== Japanese Learning Website — shared app core ===== */
/* Base data comes from js/data.js (window.KANJI / VOCAB / GRAMMAR / SENTENCES).
   User additions & edits are kept in localStorage and merged on top of the base data. */
window.JL = (function () {
  var STORE_KEY = 'jl_user_v1';

  /* ---------- cloud backend (Supabase) — configured in js/config.js ---------- */
  /* Plain REST calls, no SDK needed. If js/config.js is missing or left empty,
     the site still works — it just stays local to this browser (no cross-device sync). */
  var CLOUD = { p: null };
  function cloudCfg() {
    if (!CLOUD.p) {
      CLOUD.p = new Promise(function (res) {
        function settle() {
          var c = window.JL_CLOUD || null;
          CLOUD.cfg = (c && c.url && c.key) ? c : null;
          res(CLOUD.cfg);
        }
        if (window.JL_CLOUD !== undefined) { settle(); return; }
        var s = document.createElement('script');
        s.src = 'js/config.js';
        s.onload = settle;
        s.onerror = function () { res(null); };
        document.head.appendChild(s);
      });
    }
    return CLOUD.p;
  }
  function cloudHeaders(c, extra) {
    var h = { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function cloudFileUrl(c, id) {
    return c.url + '/storage/v1/object/' + c.bucket + '/' +
      encodeURIComponent(c.user || 'main') + '/' + encodeURIComponent(id);
  }

  var base = {
    kanji: (typeof window.KANJI !== 'undefined') ? window.KANJI : [],
    vocab: (typeof window.VOCAB !== 'undefined') ? window.VOCAB : [],
    grammar: (typeof window.GRAMMAR !== 'undefined') ? window.GRAMMAR : [],
    sentences: (typeof window.SENTENCES !== 'undefined') ? window.SENTENCES : []
  };

  /* ---------- user store ---------- */
  function getUser() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setUser(u) {
    u._sync = { at: Date.now(), dev: String(navigator.userAgent || '').slice(0, 40) };
    localStorage.setItem(STORE_KEY, JSON.stringify(u));
    schedulePush();
  }

  /* ---------- cross-device sync (server-backed user data) ---------- */
  function pushUserData() {
    if (location.protocol === 'file:' || typeof fetch === 'undefined') return;
    cloudCfg().then(function (c) {
      if (!c) return;
      try {
        var body = JSON.stringify({ user_id: c.user || 'main', data: JSON.parse(localStorage.getItem(STORE_KEY) || '{}') });
        fetch(c.url + '/rest/v1/user_data', {
          method: 'POST',
          headers: cloudHeaders(c, { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }),
          body: body
        }).catch(function () {});
      } catch (e) {}
    });
  }
  var syncTimer = null;
  function schedulePush() {
    if (location.protocol === 'file:') return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushUserData, 1500);
  }
  function pullUserData() {
    if (location.protocol === 'file:' || typeof fetch === 'undefined') return;
    cloudCfg().then(function (c) {
      if (!c) return;
      var q = c.url + '/rest/v1/user_data?select=data&user_id=eq.' + encodeURIComponent(c.user || 'main');
      fetch(q, { headers: cloudHeaders(c) }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
        var srv = rows && rows[0] && rows[0].data;
        if (!srv || !srv._sync) return;
        var local = getUser();
        var lat = (local && local._sync && local._sync.at) || 0;
        if ((srv._sync.at || 0) > lat && !userBusy()) {
          localStorage.setItem(STORE_KEY, JSON.stringify(srv));
          refreshPage();
        }
      }).catch(function () {});
    });
  }
  function userBusy() {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return true;
    if (document.querySelector('.quiz-opts, .flashcard, .modal:not(.hidden)')) return true;
    return false;
  }
  function refreshPage() {
    if (location.protocol === 'file:') return;
    var p = (location.pathname.split('/').pop() || 'index.html') + location.search;
    setTimeout(function () { navigate(p, false); }, 60);
  }
  function startLiveSync() {
    if (location.protocol === 'file:') return;
    setInterval(function () { pullUserData(); }, 30000);
  }
  function pref(key, val) {
    var u = getUser();
    if (!u.prefs) u.prefs = {};
    if (typeof val === 'undefined') return u.prefs[key];
    val = mmfixValue(val);
    u.prefs[key] = val;
    setUser(u);
    return val;
  }
  function kindStore(kind) {
    var u = getUser();
    if (!u[kind]) u[kind] = { added: [], edited: {}, deleted: {} };
    return u;
  }

  /* merge base + user layer */
  function merged(kind) {
    var u = getUser()[kind] || {};
    var out = [];
    (base[kind] || []).forEach(function (it) {
      if (u.deleted && u.deleted[it.id]) return;
      var e = (u.edited && u.edited[it.id]) || null;
      out.push(e ? Object.assign({}, it, e) : it);
    });
    (u.added || []).forEach(function (it) { out.push(it); });
    return out;
  }
  /* ---------- Myanmar (Burmese) text: always store real Unicode, never Zawgyi ---------- */
  /* js/zg2uni.js is a vendored copy of Google's myanmar-tools (Zawgyi detector + converter).
     It turns Zawgyi — or wrongly-ordered "visual order" typing — into proper Unicode Myanmar,
     and leaves Japanese, English and already-correct Unicode untouched. */
  /* laptop-keyboard fallback: on the user's Myanmar keyboard a few keys emit raw Latin
     letters instead of Myanmar signs (observed: m -> ာ U+102C, g -> ါ U+102B; extend the
     map if more keys are found). Replace a letter only when the neighbour char is Myanmar,
     so real English words inside the same text stay untouched. */
  var KB_FIX = { m: '\u102C', g: '\u102B' };
  function kbfix(s) {
    if (typeof s !== 'string' || !s) return s;
    var MM = /[\u1000-\u109F]/, out = '', i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (KB_FIX[c] && (MM.test(s.charAt(i - 1)) || MM.test(s.charAt(i + 1)))) out += KB_FIX[c];
      else out += c;
    }
    return out;
  }
  function mmfixValue(v) {
    try {
      var ZG = window.JL_ZG;
      if (!ZG) return v;
      if (typeof v === 'string') return ZG.fix(kbfix(v));
      if (Object.prototype.toString.call(v) === '[object Array]') {
        for (var i = 0; i < v.length; i++) v[i] = mmfixValue(v[i]);
        return v;
      }
      if (v && typeof v === 'object') {
        for (var k in v) v[k] = mmfixValue(v[k]);
      }
    } catch (e) {}
    return v;
  }
  /* one-time migration: fix everything saved so far (setUser also pushes the fixed copy to the cloud) */
  function migrateZg() {
    try {
      if (!window.JL_ZG) return;
      if (localStorage.getItem('jl_zgfix_v1')) return;
      localStorage.setItem('jl_zgfix_v1', '1');
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var u = getUser();
      mmfixValue(u);
      if (JSON.stringify(u) !== raw) setUser(u);
    } catch (e) {}
  }
  /* one-time chapter sync: normalize chapter numbers to real numbers, remap old
     grammar items that used the lesson number as chapter, and register chapters
     that exist only in the user's data in the shared uchapters registry */
  function migrateChapters() {
    try {
      if (localStorage.getItem('jl_chfix_v1')) return;
      localStorage.setItem('jl_chfix_v1', '1');
      var u = getUser(), changed = false;
      var uch = (u.prefs && u.prefs.uchapters) || [];
      /* chapters already covered by the shipped data keep their proper titles,
         so they are not re-registered from user items */
      var builtin = {};
      ['kanji', 'vocab', 'grammar', 'sentences', 'tests'].forEach(function (k2) {
        merged(k2).forEach(function (it) {
          if (it && it.chapter != null) builtin[Number(it.chapter) || 0] = 1;
        });
      });
      ['kanji', 'vocab', 'grammar', 'tests'].forEach(function (k) {
        var st = u[k]; if (!st) return;
        var items = (st.added || []).concat(Object.keys(st.edited || {}).map(function (id) { return st.edited[id]; }));
        items.forEach(function (it) {
          if (!it || it.chapter == null) return;
          var n = Number(it.chapter);
          if (!isFinite(n) || n <= 0) return;
          /* old grammar saves stored the lesson number as the chapter — remap them
             onto the unified thematic chapters */
          if (k === 'grammar' && it.lesson != null && it.chapter === it.lesson && window.LESSON_CH && window.LESSON_CH[it.lesson]) n = window.LESSON_CH[it.lesson];
          if (it.chapter !== n) { it.chapter = n; changed = true; }
          if (!builtin[n] && !uch.some(function (c) { return Number(c.n) === n; })) {
            uch.push({ n: n, t: 'Chapter ' + n });
            changed = true;
          }
        });
      });
      if (changed) {
        if (!u.prefs) u.prefs = {};
        u.prefs.uchapters = uch.sort(function (a, b) { return a.n - b.n; });
        setUser(u);
      }
    } catch (e) {}
  }
  function loadZg() {
    migrateChapters();
    if (window.JL_ZG) { migrateZg(); return; }
    var s = document.createElement('script');
    s.src = 'js/zg2uni.js';
    s.onload = function () { migrateZg(); };
    s.onerror = function () {};
    (document.head || document.getElementsByTagName('head')[0]).appendChild(s);
  }
  loadZg();
  /* convert Zawgyi in any text field the moment the user leaves it */
  document.addEventListener('blur', function (ev) {
    try {
      var t = ev.target, ZG = window.JL_ZG;
      if (!ZG || !t || !t.tagName) return;
      var isField = (t.tagName === 'INPUT' && t.type === 'text') || t.tagName === 'TEXTAREA';
      if (!isField) return;
      var f = ZG.fix(kbfix(t.value));
      if (f !== t.value) { t.value = f; toast('Myanmar text converted to Unicode ✓'); }
    } catch (e2) {}
  }, true);

  function save(kind, item) {
    item = mmfixValue(item);
    var u = kindStore(kind); var s = u[kind];
    if (String(item.id).indexOf('u_') === 0) {
      var found = -1;
      for (var i = 0; i < s.added.length; i++) if (s.added[i].id === item.id) { found = i; break; }
      if (found >= 0) s.added[found] = item; else s.added.push(item);
    } else {
      s.edited[item.id] = item; // full override of the base entry
    }
    setUser(u);
  }
  function remove(kind, id) {
    var u = kindStore(kind); var s = u[kind];
    if (String(id).indexOf('u_') === 0) {
      s.added = s.added.filter(function (x) { return x.id !== id; });
    } else {
      s.deleted[id] = true;
      if (s.edited) delete s.edited[id];
    }
    setUser(u);
  }
  function restore(kind, id) {
    var u = getUser(); var s = u[kind];
    if (s && s.deleted && s.deleted[id]) { delete s.deleted[id]; setUser(u); }
  }

  /* ---------- utilities ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(a) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function pickN(arr, n) { return shuffle(arr).slice(0, n); }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function norm(s) {
    return String(s || '').replace(/[\s。、．.,\u3000?？!！'’“”"()（）]/g, '');
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  /* ---------- Japanese text-to-speech ---------- */
  var voices = [];
  function loadVoices() {
    try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; }
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;
  }
  function jaVoice() {
    for (var i = 0; i < voices.length; i++) {
      if (/^ja([-_](JP|Jpan))?$/i.test(voices[i].lang)) return voices[i];
    }
    for (var j = 0; j < voices.length; j++) {
      if (/ja/i.test(voices[j].lang)) return voices[j];
    }
    return null;
  }
  function ttsSupported() { return 'speechSynthesis' in window; }
  var curAudio = null;
  var noServerTTS = false; /* set true after a server TTS failure (e.g. on static hosting) */
  function speakFallback(text, rate) {
    if (!ttsSupported()) { toast('Audio is unavailable in this browser — try Chrome, Edge or Safari.'); return; }
    if (!voices.length) loadVoices();
    var v = jaVoice();
    try { speechSynthesis.cancel(); } catch (e) {}
    try { speechSynthesis.resume(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(String(text || ''));
    u.lang = 'ja-JP';
    u.rate = rate || 1;
    if (v) u.voice = v;
    u.onerror = function (ev) {
      var err = ev && ev.error ? String(ev.error) : '';
      if (err === 'interrupted' || err === 'canceled') return;
      toast('Audio error (' + (err || 'unknown') + ') — please try again.');
    };
    speechSynthesis.speak(u);
    setTimeout(function () { try { speechSynthesis.resume(); } catch (e) {} }, 300);
  }
  function speak(text, rate) {
    var txt = String(text || '').trim();
    if (!txt) return false;
    if (location.protocol === 'file:' || noServerTTS || typeof fetch === 'undefined') { speakFallback(txt, rate); return true; }
    /* Google text-to-speech via the app server, chunked at sentence boundaries */
    var chunks = txt.match(/[^。！？!?.]{1,150}([。！？!?.]+|$)/g) || [txt];
    var i = 0, failed = false;
    if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; }
    function fail() {
      if (failed) return;
      failed = true;
      noServerTTS = true; /* static hosts have no /api/tts — use the device voice from now on */
      speakFallback(txt, rate);
    }
    function next() {
      if (failed || i >= chunks.length) return;
      var c = chunks[i++];
      fetch('/api/tts?q=' + encodeURIComponent(c)).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (b) {
        var url = URL.createObjectURL(b);
        var a = new Audio(url);
        curAudio = a;
        a.playbackRate = rate || 1;
        a.onended = function () { URL.revokeObjectURL(url); if (curAudio === a) curAudio = null; next(); };
        a.onerror = function () { URL.revokeObjectURL(url); fail(); };
        var p = a.play();
        if (p && p.catch) p.catch(function () { URL.revokeObjectURL(url); fail(); });
      }).catch(function () { fail(); });
    }
    next();
    return true;
  }
  function ttsBanner(id) {
    var box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = '<div class="notice">🔊 Audio: Google text-to-speech voice (with your device voice as backup). If a sound does not play, check your volume is on.</div>';
  }

  /* ---------- navigation ---------- */
  var NAV = [
    { href: 'index.html', icon: '🏠', label: 'Home' },
    { href: 'textbook.html', icon: '📖', label: 'Textbook' },
    { href: 'learn.html', icon: '🎯', label: 'Learn' },
    { href: 'kanji.html', icon: '漢', label: 'Kanji' },
    { href: 'vocab.html', icon: '語', label: 'Vocabulary' },
    { href: 'write.html', icon: '✍️', label: 'Writing' },
    { href: 'kana.html', icon: 'あ', label: 'Kana' },
    { href: 'grammar.html', icon: '文', label: 'Grammar' },
    { href: 'listening.html', icon: '🎧', label: 'Listening' },
    { href: 'tests.html', icon: '📝', label: 'Tests' },
    { href: 'files.html', icon: '🗂️', label: 'Files' },
    { href: 'partner.html', icon: '🤝', label: 'Study Partner' },
    { href: 'edit.html', icon: '⚙️', label: 'Add / Edit' }
  ];
  function renderNav() {
    var el = document.getElementById('nav');
    if (!el) return;
    var page = (location.pathname.split('/').pop() || 'index.html');
    el.innerHTML = NAV.map(function (n) {
      return '<a class="' + (n.href === page ? 'active' : '') + '" href="' + n.href + '"><span class="ic">' + n.icon + '</span>' + n.label + '</a>';
    }).join('');
  }

  /* ---------- generic quiz runner ---------- */
  /* items: [{ q, opts:[...], ans:index, note:html?, say:text? }] */
  function quiz(el, items, opts) {
    opts = opts || {};
    var order, idx, score, wrong;
    function start() {
      order = shuffle(items.slice()); idx = 0; score = 0; wrong = []; renderQ();
    }
    function renderQ() {
      if (idx >= order.length) { renderDone(); return; }
      var it = order[idx];
      el.innerHTML =
        '<div class="quiz-head"><span>' + esc(opts.title || 'Quiz') + ' · Q' + (idx + 1) + '/' + order.length +
        '</span><span class="muted">Score: ' + score + '</span></div>' +
        '<div class="quiz-q jp">' + esc(it.q) + '</div>' +
        (it.say ? '<div style="text-align:center;margin-bottom:12px"><button class="btn ghost qz-say">🔊 Play audio</button></div>' : '') +
        '<div class="quiz-opts">' + it.opts.map(function (o, i) {
          return '<button class="option jp" data-i="' + i + '">' + esc(o) + '</button>';
        }).join('') + '</div>' +
        '<div class="quiz-note" hidden></div>' +
        '<div class="fc-actions" style="display:none"><button class="btn primary qz-next">Next →</button></div>';
      if (it.say) el.querySelector('.qz-say').onclick = function () { speak(it.say, opts.rate); };
      Array.prototype.forEach.call(el.querySelectorAll('.option'), function (b) {
        b.onclick = function () { pick(b); };
      });
    }
    function pick(btn) {
      var it = order[idx]; var i = parseInt(btn.dataset.i, 10);
      Array.prototype.forEach.call(el.querySelectorAll('.option'), function (b, j) {
        b.disabled = true;
        if (j === it.ans) b.classList.add('correct');
      });
      if (i === it.ans) score++; else { btn.classList.add('wrong'); wrong.push(it); }
      var note = el.querySelector('.quiz-note');
      if (it.note) { note.hidden = false; note.innerHTML = it.note; }
      var act = el.querySelector('.fc-actions');
      act.style.display = 'flex';
      act.querySelector('.qz-next').onclick = function () { idx++; renderQ(); };
    }
    function renderDone() {
      var pct = order.length ? Math.round(score / order.length * 100) : 0;
      el.innerHTML = '<div class="quiz-done"><div class="score-big">' + score + ' / ' + order.length + '</div>' +
        '<p>' + (pct >= 80 ? 'すごい！ Great job!' : pct >= 50 ? 'よくできました！ Good work!' : 'もう一度！ Try again!') + '</p>' +
        (wrong.length ? '<div style="text-align:left"><h4>Review</h4>' + wrong.map(function (w) {
          return '<div class="review-item"><span class="jp">' + esc(w.q) + '</span> → <b class="ok">' + esc(w.opts[w.ans]) + '</b></div>';
        }).join('') + '</div>' : '') +
        '<p><button class="btn primary qz-restart">↻ Restart quiz</button></p></div>';
      el.querySelector('.qz-restart').onclick = start;
    }
    start();
  }

  /* ---------- generic flashcards ---------- */
  /* cards: [{ front:html, back:html, say:text? }] */
  function flashcards(el, cards, opts) {
    opts = opts || {};
    var deck = shuffle(cards.slice()), i = 0, shown = false;
    function render() {
      var c = deck[i] || { front: '—', back: '—' };
      el.innerHTML =
        '<div class="quiz-head"><span>' + esc(opts.title || 'Flashcards') + '</span><span class="muted">' + (i + 1) + '/' + deck.length + '</span></div>' +
        '<div class="flashcard jp" title="Click to flip">' + (shown ? c.back : c.front) + '</div>' +
        '<div class="fc-actions">' +
        '<button class="btn ghost fc-prev">← Prev</button>' +
        (c.say ? '<button class="btn fc-say">🔊 Listen</button>' : '') +
        '<button class="btn primary fc-flip">' + (shown ? 'Show front' : 'Show back') + '</button>' +
        '<button class="btn ghost fc-next">Next →</button></div>' +
        '<div class="fc-actions"><button class="btn small ghost fc-shuffle">🔀 Shuffle</button>' +
        '<span class="muted small">Click the card to flip it</span></div>';
      el.querySelector('.flashcard').onclick = function () { shown = !shown; render(); };
      el.querySelector('.fc-prev').onclick = function () { i = (i - 1 + deck.length) % deck.length; shown = false; render(); };
      el.querySelector('.fc-next').onclick = function () { i = (i + 1) % deck.length; shown = false; render(); };
      el.querySelector('.fc-flip').onclick = function () { shown = !shown; render(); };
      if (c.say) el.querySelector('.fc-say').onclick = function () { speak(c.say, opts.rate); };
      el.querySelector('.fc-shuffle').onclick = function () { deck = shuffle(deck); i = 0; shown = false; render(); };
    }
    render();
  }

  /* ---------- drawing pad ---------- */
  /* JL.pad(drawCanvasId, guideCanvasId) -> { clear, undo, setGuide(char, show), strokes } */
  function pad(drawId, guideId) {
    var c = document.getElementById(drawId);
    var g = document.getElementById(guideId);
    if (!c || !g) return null;
    var size = 480; // internal logical size (CSS scales it down)
    [c, g].forEach(function (x) {
      x.width = size * 2; x.height = size * 2;
      x.style.width = '100%'; x.style.height = '100%';
    });
    var ctx = c.getContext('2d');
    var gctx = g.getContext('2d');
    ctx.scale(2, 2); gctx.scale(2, 2);
    ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d3557';
    var strokes = [], cur = null;
    function pos(e) {
      var r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (size / r.width), y: (e.clientY - r.top) * (size / r.height) };
    }
    c.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (err) {} }
      cur = [pos(e)]; strokes.push(cur); draw();
    });
    c.addEventListener('pointermove', function (e) {
      if (!cur) return; cur.push(pos(e)); draw();
    });
    window.addEventListener('pointerup', function () { cur = null; });
    window.addEventListener('pointercancel', function () { cur = null; });
    function draw() {
      ctx.clearRect(0, 0, size, size);
      strokes.forEach(function (s) {
        if (s.length === 1) {
          ctx.beginPath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.arc(s[0].x, s[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        for (var k = 1; k < s.length; k++) ctx.lineTo(s[k].x, s[k].y);
        ctx.stroke();
      });
    }
    function grid() {
      gctx.clearRect(0, 0, size, size);
      gctx.strokeStyle = '#d8d2c8'; gctx.lineWidth = 1; gctx.setLineDash([5, 5]);
      gctx.beginPath();
      gctx.moveTo(size / 2, 0); gctx.lineTo(size / 2, size);
      gctx.moveTo(0, size / 2); gctx.lineTo(size, size / 2);
      gctx.moveTo(0, 0); gctx.lineTo(size, size);
      gctx.moveTo(size, 0); gctx.lineTo(0, size);
      gctx.stroke();
      gctx.setLineDash([]);
    }
    function setGuide(ch, show) {
      grid();
      if (show !== false && ch) {
        gctx.fillStyle = 'rgba(29,53,87,0.13)';
        gctx.font = Math.floor(size * 0.8) + 'px "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
        gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
        gctx.fillText(ch, size / 2, size / 2 + size * 0.03);
      }
    }
    return {
      clear: function () { strokes = []; draw(); },
      undo: function () { strokes.pop(); draw(); },
      setGuide: setGuide,
      strokes: function () { return strokes.length; }
    };
  }

  /* ---------- uploaded files (IndexedDB) ---------- */
  var FDB_NAME = 'jl-files';
  function fdb() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(FDB_NAME, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('files'); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function fop(mode, fn) {
    return fdb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('files', mode);
        var rq = fn(tx.objectStore('files'));
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function fileCat(name, mime) {
    var n = String(name || '').toLowerCase();
    var m = String(mime || '');
    if (m.indexOf('pdf') >= 0 || /\.pdf$/.test(n)) return 'pdf';
    if (m.indexOf('image') >= 0 || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'image';
    if (m.indexOf('video') >= 0 || /\.(mp4|webm|mov|mkv|avi)$/.test(n)) return 'video';
    if (m.indexOf('audio') >= 0 || /\.(mp3|wav|m4a|ogg|aac)$/.test(n)) return 'audio';
    if (/\.(docx?|xlsx?|pptx?|txt|csv)$/.test(n)) return 'doc';
    return 'other';
  }
  function fileMetaAdd(meta) {
    meta = mmfixValue(meta);
    var u = getUser();
    if (!u.files || !u.files.added) u.files = { added: [] };
    var found = -1;
    for (var i = 0; i < u.files.added.length; i++) if (u.files.added[i].id === meta.id) { found = i; break; }
    if (found >= 0) u.files.added[found] = meta; else u.files.added.push(meta);
    setUser(u);
  }
  function fileMetaRemove(id) {
    var u = getUser();
    if (u.files && u.files.added) {
      u.files.added = u.files.added.filter(function (m) { return m.id !== id; });
      setUser(u);
    }
  }
  function filesList() {
    return fop('readonly', function (s) { return s.getAll(); }).then(function (rows) {
      var local = rows.map(function (r) {
        return { id: r.id, name: r.name, type: r.type, cat: r.cat || fileCat(r.name, r.type), size: r.size, added: r.added };
      });
      var have = {};
      local.forEach(function (r) { have[r.id] = true; });
      var meta = (getUser().files && getUser().files.added) || [];
      var remote = meta.filter(function (m) { return !have[m.id]; });
      return remote.concat(local);
    }).catch(function () {
      var meta = (getUser().files && getUser().files.added) || [];
      return meta.slice();
    });
  }
  function filePut(meta, blob) {
    var p = fop('readwrite', function (s) { return s.put({ id: meta.id, name: meta.name, type: meta.type, cat: meta.cat, size: meta.size, added: meta.added, blob: blob }); })
      .then(function () { fileMetaAdd(meta); return meta; })
      .catch(function () { fileMetaAdd(meta); return meta; });
    /* also upload the blob to cloud storage (Supabase) when configured and not too big */
    if (blob && (blob.size || meta.size || 0) <= 40 * 1024 * 1024) {
      cloudCfg().then(function (c) {
        if (!c) return;
        fetch(cloudFileUrl(c, meta.id), {
          method: 'POST',
          headers: cloudHeaders(c, { 'x-upsert': 'true', 'Content-Type': meta.type || 'application/octet-stream' }),
          body: blob
        }).catch(function () { toast(meta.name + ' was saved on this device only — it will not sync.'); });
      });
    }
    return p;
  }
  function fileGet(id) {
    function fromServer() {
      return cloudCfg().then(function (c) {
        if (!c) throw new Error('File not found on this device and cloud sync is not configured');
        return fetch(cloudFileUrl(c, id), { headers: cloudHeaders(c) }).then(function (r) {
          if (!r.ok) throw new Error('File not found on this device or the server');
          return r.blob();
        });
      }).then(function (b) {
        var meta = ((getUser().files && getUser().files.added) || []).filter(function (m) { return m.id === id; })[0] || {};
        return { id: id, name: meta.name || 'file', type: meta.type || '', cat: meta.cat || 'other', size: meta.size || b.size, added: meta.added || '', blob: b };
      });
    }
    return fop('readonly', function (s) { return s.get(id); }).then(function (rec) {
      if (rec && rec.blob) return rec;
      return fromServer();
    }).catch(fromServer);
  }
  function fileDel(id) {
    fileMetaRemove(id);
    if (location.protocol !== 'file:') {
      cloudCfg().then(function (c) {
        if (!c) return;
        try { fetch(cloudFileUrl(c, id), { method: 'DELETE', headers: cloudHeaders(c) }).catch(function () {}); } catch (e) {}
      });
    }
    return fop('readwrite', function (s) { return s.delete(id); }).catch(function () {});
  }

  /* ---------- collapsible category chips (kanji / vocab pages) ---------- */
  function initCatToggle() {
    Array.prototype.forEach.call(document.querySelectorAll('.chips'), function (ch) {
      if (ch.previousElementSibling && ch.previousElementSibling.classList.contains('cat-toggle')) return;
      var key = 'cats_' + (ch.id || 'x');
      var open = pref(key) !== '0';
      var btn = document.createElement('button');
      btn.className = 'btn small ghost cat-toggle';
      btn.onclick = function () {
        open = !open;
        pref(key, open ? '1' : '0');
        setLabel();
      };
      function setLabel() {
        btn.textContent = (open ? '▾' : '▸') + ' Categories';
        ch.style.display = open ? '' : 'none';
      }
      setLabel();
      ch.parentNode.insertBefore(btn, ch);
    });
  }

  /* ---------- SPA router (no full page reloads) ---------- */
  var router = { loadedSrc: {}, busy: false };
  function sameSite(href) {
    return /^[a-z0-9\-]+\.html(\?.*)?$/i.test(href);
  }
  function ensureHeadResources(headEl, done) {
    var jobs = [];
    Array.prototype.forEach.call(headEl.querySelectorAll('link[rel="stylesheet"]'), function (l) {
      var url = l.getAttribute('href');
      if (!url || router.loadedSrc[url]) return;
      router.loadedSrc[url] = true;
      var nl = document.createElement('link');
      nl.rel = 'stylesheet'; nl.href = url;
      document.head.appendChild(nl);
    });
    Array.prototype.forEach.call(headEl.querySelectorAll('script[src]'), function (sc) {
      var url = sc.getAttribute('src');
      if (!url || router.loadedSrc[url]) return;
      router.loadedSrc[url] = true;
      jobs.push(new Promise(function (res) {
        var ns = document.createElement('script');
        ns.src = url; ns.onload = res; ns.onerror = res;
        document.head.appendChild(ns);
      }));
    });
    Promise.all(jobs).then(done, done);
  }
  function runScripts(scripts, i) {
    if (i >= scripts.length) { JL.renderNav(); JL.initCatToggle(); JL.sync.pull(); return; }
    var s = document.createElement('script');
    s.text = scripts[i];
    document.body.appendChild(s);
    runScripts(scripts, i + 1);
  }
  function navigate(href, push) {
    if (router.busy) return;
    router.busy = true;
    var pathOnly = href.split('?')[0];
    fetch(pathOnly).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var main = doc.querySelector('main');
      if (!main) { router.busy = false; location.href = href; return; }
      ensureHeadResources(doc.head, function () {
        if (push !== false) { try { history.pushState(null, '', href); } catch (e) {} }
        document.title = doc.title || 'Japanese Learning';
        document.querySelector('main').replaceWith(main);
        var scripts = [];
        Array.prototype.forEach.call(doc.querySelectorAll('script:not([src])'), function (s) {
          scripts.push(s.textContent);
        });
        window.scrollTo(0, 0);
        runScripts(scripts, 0);
        router.busy = false;
      });
    }).catch(function () {
      router.busy = false;
      location.href = href;
    });
  }
  function initRouter() {
    Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (s) {
      router.loadedSrc[s.getAttribute('src')] = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
      router.loadedSrc[l.getAttribute('href')] = true;
    });
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      if (a.hasAttribute('download') || a.target === '_blank') return;
      var href = a.getAttribute('href') || '';
      if (!sameSite(href)) return;
      e.preventDefault();
      navigate(href);
    });
    window.addEventListener('popstate', function () {
      var p = location.pathname.split('/').pop() || 'index.html';
      navigate(p + location.search, false);
    });
  }

  /* ---------- unified chapter list (shared by every page) ---------- */
  /* All pages show the SAME chapters: the union across kanji/vocab/grammar/
     sentences/tests plus the user's custom chapters (uchapters). So a chapter
     created anywhere — e.g. a new kanji in chapter 16 — appears on every page.
     `count` = items of THIS kind in that chapter; chapter 0 ("Essential / my
     words") only shows on the kind that owns it. */
  function chapters(kind) {
    var seen = {}, out = [];
    ['kanji', 'vocab', 'grammar', 'sentences', 'tests'].forEach(function (k2) {
      merged(k2).forEach(function (it) {
        if (it == null) return;
        var n = (it.chapter != null) ? (Number(it.chapter) || 0) : ((k2 === kind) ? 0 : -1);
        if (n < 0) return;
        if (n === 0 && k2 !== kind) return;
        if (!seen[n]) { seen[n] = { n: n, t: it.chapterTitle || '', count: 0 }; out.push(seen[n]); }
        if (!seen[n].t && it.chapterTitle) seen[n].t = it.chapterTitle;
        if (k2 === kind) seen[n].count++;
      });
    });
    (pref('uchapters') || []).forEach(function (c) {
      if (!c || c.n == null) return;
      var n = Number(c.n);
      if (!seen[n]) { seen[n] = { n: n, t: c.t || ('Chapter ' + n), count: 0 }; out.push(seen[n]); }
      else seen[n].t = c.t || seen[n].t;
    });
    out.sort(function (a, b) { return a.n - b.n; });
    return out;
  }

  /* ---------- per-kanji memorization images (cloud-synced mapping kanjiId -> fileId) ---------- */
  function kimgGet(kanjiId) { return (pref('kimg') || {})[kanjiId] || null; }
  function kimgSet(kanjiId, fileId) {
    var m = pref('kimg') || {};
    if (fileId) m[kanjiId] = fileId; else delete m[kanjiId];
    pref('kimg', m);
  }

  /* ---------- public API ---------- */
  return {
    data: merged, save: save, remove: remove, restore: restore,
    esc: esc, shuffle: shuffle, pickN: pickN, toast: toast, norm: norm, download: download,
    speak: speak, ttsSupported: ttsSupported, renderNav: renderNav, ttsBanner: ttsBanner, initRouter: initRouter, initCatToggle: initCatToggle,
    quiz: quiz, flashcards: flashcards, pad: pad,
    files: { list: filesList, put: filePut, get: fileGet, del: fileDel, cat: fileCat },
    sync: { push: pushUserData, pull: pullUserData, live: startLiveSync },
    pref: pref, chapters: chapters, kimg: { get: kimgGet, set: kimgSet }, mmfix: mmfixValue
  };
})();
document.addEventListener('DOMContentLoaded', function () { JL.renderNav(); JL.initRouter(); JL.initCatToggle(); JL.sync.pull(); JL.sync.live(); });
