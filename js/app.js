/* ===== Japanese Learning Website — shared app core ===== */
/* ---------- page-heading icons ----------
   Each page title starts with a lone glyph or emoji (漢, 語, あア, ⚙️, 🎧 …).
   This turns it into a polished tile (styled in css/style.css as .h-ic):
   Japanese glyphs get a terracotta gradient badge, emojis a soft framed tile.
   Runs once per page load; safe to re-run (skips titles already done). */
function jlTitleIcons() {
  try {
    var emoRe = null;
    try { emoRe = new RegExp('^(\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*)\\s+', 'u'); } catch (e0) {}
    var jpRe = /^([\u3040-\u30ff\u4e00-\u9faf\u3005]{1,2})\s+/;
    var els = document.querySelectorAll('h1.page-title');
    for (var i = 0; i < els.length; i++) {
      var h = els[i];
      if (!h || h.querySelector('.h-ic')) continue;
      var txt = String(h.textContent || '').replace(/^\s+/, '');
      var m = (emoRe && emoRe.test(txt)) ? txt.match(emoRe) : txt.match(jpRe);
      if (!m) continue;
      var isJp = /[\u3040-\u30ff\u4e00-\u9faf\u3005]/.test(m[1]);
      var ic = document.createElement('span');
      ic.className = 'h-ic' + (isJp ? ' jp' : ' emo');
      ic.textContent = m[1];
      h.textContent = '';
      h.appendChild(ic);
      h.appendChild(document.createTextNode(txt.slice(m[0].length)));
    }
  } catch (e) {}
}

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
  /* a record with no user content at all must never be pushed — pushing
     emptiness can only destroy the newer cloud copy (fresh browser, cleared
     profile, prefs-only state). The `level` pref alone is not content. */
  function userHasContent(u) {
    try {
      var kinds = ['kanji', 'vocab', 'grammar', 'sentences', 'tests'];
      for (var i = 0; i < kinds.length; i++) {
        var s = u[kinds[i]];
        if (!s || typeof s !== 'object') continue;
        if (Array.isArray(s.added) && s.added.length) return true;
        if (s.edited && typeof s.edited === 'object' && !Array.isArray(s.edited) && Object.keys(s.edited).length) return true;
        if (s.deleted && typeof s.deleted === 'object' && !Array.isArray(s.deleted) && Object.keys(s.deleted).length) return true;
      }
      if (u.files && Array.isArray(u.files.added) && u.files.added.length) return true;
      var p = u.prefs || {};
      for (var pk in p) { if (pk !== 'level') return true; }
    } catch (e) {}
    return false;
  }
  /* Merge two user records — this is what makes the cloud copy durable:
     items ACCUMULATE by id (like uploaded files), deletions accumulate as
     tombstones, and `overlay`'s version wins per id. Nothing is ever dropped
     from the merged result because the other side didn't know about it. */
  function mergeRecords(base, overlay) {
    var out = {};
    try {
      out = JSON.parse(JSON.stringify((base && typeof base === 'object') ? base : {}));
    } catch (e) { out = {}; }
    ['kanji', 'vocab', 'grammar', 'sentences', 'tests'].forEach(function (k) {
      var b = (base && base[k]) || {}, o = (overlay && overlay[k]) || {};
      function adds(x) { return (x && Array.isArray(x.added)) ? x.added.filter(function (it) { return it && typeof it === 'object' && it.id != null; }) : []; }
      function map(x) { return (x && typeof x === 'object' && !Array.isArray(x)) ? x : {}; }
      /* added: union by id, overlay wins on the same id */
      var byId = {};
      adds(b).forEach(function (it) { byId[it.id] = it; });
      adds(o).forEach(function (it) { byId[it.id] = it; });
      /* deleted: tombstones accumulate from both sides */
      var del = {};
      Object.keys(map(b.deleted)).forEach(function (id) { if (map(b.deleted)[id]) del[id] = true; });
      Object.keys(map(o.deleted)).forEach(function (id) { if (map(o.deleted)[id]) del[id] = true; });
      var added = [];
      Object.keys(byId).forEach(function (id) { if (!del[id]) added.push(byId[id]); });
      /* edited: overlay wins per id */
      var edited = {};
      Object.keys(map(b.edited)).forEach(function (id) { edited[id] = map(b.edited)[id]; });
      Object.keys(map(o.edited)).forEach(function (id) { edited[id] = map(o.edited)[id]; });
      out[k] = { added: added, edited: edited, deleted: del };
    });
    /* uploaded-file metadata: union by id */
    var fB = (base && base.files && Array.isArray(base.files.added)) ? base.files.added : [];
    var fO = (overlay && overlay.files && Array.isArray(overlay.files.added)) ? overlay.files.added : [];
    var fById = {};
    fB.concat(fO).forEach(function (m) { if (m && m.id != null) fById[m.id] = m; });
    out.files = { added: Object.keys(fById).map(function (id) { return fById[id]; }) };
    /* prefs: keys merged, overlay wins */
    out.prefs = Object.assign({}, (base && base.prefs) || {}, (overlay && overlay.prefs) || {});
    return out;
  }
  function pushUserData() {
    if (location.protocol === 'file:' || typeof fetch === 'undefined') return;
    cloudCfg().then(function (c) {
      if (!c) return;
      try {
        var local = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        if (!userHasContent(local)) return; /* never push an empty record */
        /* fetch the server copy first and MERGE: the posted record keeps
           everything the server already has, so no device — stale, fresh or
           broken — can ever remove another device's items by pushing */
        var q = c.url + '/rest/v1/user_data?select=data&user_id=eq.' + encodeURIComponent(c.user || 'main');
        fetch(q, { headers: cloudHeaders(c) }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
          var srv = (rows && rows[0] && rows[0].data) || null;
          var merged = srv ? mergeRecords(srv, local) : local;
          merged._sync = { at: Date.now(), dev: String(navigator.userAgent || '').slice(0, 40) };
          fetch(c.url + '/rest/v1/user_data', {
            method: 'POST',
            headers: cloudHeaders(c, { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }),
            body: JSON.stringify({ user_id: c.user || 'main', data: merged })
          }).then(function () {
            /* remember that the cloud now matches this browser — otherwise the
               next live-sync poll would believe "server is newer" and reload
               the page the user is working on every ~30s */
            try {
              var cur = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
              if (!cur._sync || (cur._sync.at || 0) <= merged._sync.at) {
                cur._sync = merged._sync;
                localStorage.setItem(STORE_KEY, JSON.stringify(cur));
              }
            } catch (e3) {}
          }).catch(function () {});
        }).catch(function () { /* server unreadable — fall back to posting local only */
          try {
            fetch(c.url + '/rest/v1/user_data', {
              method: 'POST',
              headers: cloudHeaders(c, { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }),
              body: JSON.stringify({ user_id: c.user || 'main', data: local })
            }).catch(function () {});
          } catch (e2) {}
        });
      } catch (e) {}
    });
  }
  var syncTimer = null, pendingRefresh = false;
  function schedulePush() {
    if (location.protocol === 'file:') return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushUserData, 1500);
  }
  function pullUserData(done) {
    if (location.protocol === 'file:' || typeof fetch === 'undefined') return;
    cloudCfg().then(function (c) {
      if (!c) { if (done) done({ updated: false }); return; }
      var q = c.url + '/rest/v1/user_data?select=data&user_id=eq.' + encodeURIComponent(c.user || 'main');
      fetch(q, { headers: cloudHeaders(c) }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
        var srv = rows && rows[0] && rows[0].data;
        if (!srv || !srv._sync) { if (done) done({ updated: false }); return; }
        var local = getUser();
        var lat = (local && local._sync && local._sync.at) || 0;
        if ((srv._sync.at || 0) > lat && !userBusy()) {
          /* server is newer — MERGE it into local instead of blind-replacing:
             the server (newer) wins per id, but items that exist only in this
             browser (made offline / not yet pushed) are kept, never lost */
          var merged;
          if (!userHasContent(local)) {
            merged = srv; /* nothing here — just take the server copy */
          } else {
            merged = mergeRecords(local, srv);
            merged._sync = srv._sync;
          }
          localStorage.setItem(STORE_KEY, JSON.stringify(merged));
          /* if local had items the server lacks, push the merged copy up so
             they survive everywhere; harmless no-op when nothing was unique */
          if (merged !== srv && JSON.stringify(merged) !== JSON.stringify(srv)) schedulePush();
          /* only reload when the current page can safely take it — an open
             Add/Edit form, a drawing pad or a busy quiz is never yanked away */
          if (refreshBlocked()) {
            pendingRefresh = true;
            if (done) done({ updated: true, pending: true });
          } else {
            pendingRefresh = false;
            refreshPage();
            if (done) done({ updated: true });
          }
        } else if (done) done({ updated: false });
      }).catch(function () { if (done) done({ updated: false }); });
    });
  }
  function userBusy() {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return true;
    if (document.querySelector('.quiz-opts, .flashcard, .modal:not(.hidden)')) return true;
    return false;
  }
  /* pages that hold in-progress state in the DOM (unsaved form position,
     drawing pad) must never be auto-reloaded out from under the user */
  function refreshBlocked() {
    var pg = location.pathname.split('/').pop() || 'index.html';
    if (pg === 'edit.html' || pg === 'kanji-draw.html' || pg === 'vocab-draw.html') return true;
    return userBusy();
  }
  function refreshPage() {
    if (location.protocol === 'file:') return;
    var p = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    setTimeout(function () { navigate(p, false, { restoreScroll: y }); }, 60);
  }
  function startLiveSync() {
    if (location.protocol === 'file:') return;
    setInterval(function () {
      if (pendingRefresh && !refreshBlocked()) { pendingRefresh = false; refreshPage(); return; }
      pullUserData();
    }, 30000);
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

  /* merge base + user layer — defensive against corrupt or legacy saved
     data: a broken store shape (null added/edited/deleted, old array format,
     null entries) must never crash a page; bad parts are ignored */
  function normStore(u) {
    if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
    return u;
  }
  function merged(kind) {
    var raw = getUser()[kind];
    var u = normStore(raw);
    if (!u) { u = (Array.isArray(raw)) ? { added: raw } : {}; }
    var del = (u.deleted && typeof u.deleted === 'object' && !Array.isArray(u.deleted) && u.deleted) || {};
    var ed = (u.edited && typeof u.edited === 'object' && !Array.isArray(u.edited) && u.edited) || {};
    var out = [];
    (base[kind] || []).forEach(function (it) {
      if (!it || it.id == null) return;
      if (del[it.id]) return;
      var e = ed[it.id];
      out.push((e && typeof e === 'object') ? Object.assign({}, it, e) : it);
    });
    (Array.isArray(u.added) ? u.added : []).forEach(function (it) {
      if (it && typeof it === 'object') out.push(it);
    });
    return out;
  }
  /* one-time repair of saved user data (any shape damage from older site
     versions): rebuilds each store as {added:[valid], edited:{}, deleted:{}},
     rescuing an old array-format store as `added`. IMPORTANT: the repair is
     written to THIS browser only and never synced — an empty or stale device
     must never be able to overwrite the newer cloud copy. (The first version
     of this repair pushed after repairing, which could wipe cloud data.) */
  function migrateShape() {
    try {
      if (localStorage.getItem('jl_shapefix_v2')) return;
      localStorage.setItem('jl_shapefix_v2', '1');
      if (!localStorage.getItem(STORE_KEY)) return; /* fresh browser — nothing to repair, nothing to push */
      var u = getUser(), changed = false;
      ['kanji', 'vocab', 'grammar', 'sentences', 'tests'].forEach(function (k) {
        var s = u[k];
        var fixed;
        if (Array.isArray(s)) {
          fixed = { added: s.filter(function (it) { return it && typeof it === 'object'; }), edited: {}, deleted: {} };
        } else if (!s || typeof s !== 'object') {
          fixed = { added: [], edited: {}, deleted: {} };
        } else {
          fixed = {
            added: (Array.isArray(s.added) ? s.added : []).filter(function (it) { return it && typeof it === 'object'; }),
            edited: (s.edited && typeof s.edited === 'object' && !Array.isArray(s.edited)) ? s.edited : {},
            deleted: (s.deleted && typeof s.deleted === 'object' && !Array.isArray(s.deleted)) ? s.deleted : {}
          };
          var clean = {};
          Object.keys(fixed.edited).forEach(function (id) { if (fixed.edited[id] && typeof fixed.edited[id] === 'object') clean[id] = fixed.edited[id]; });
          fixed.edited = clean;
          clean = {};
          Object.keys(fixed.deleted).forEach(function (id) { if (fixed.deleted[id]) clean[id] = fixed.deleted[id]; });
          fixed.deleted = clean;
        }
        if (JSON.stringify(u[k]) !== JSON.stringify(fixed)) { u[k] = fixed; changed = true; }
      });
      if (u.files && !Array.isArray(u.files.added)) { u.files = { added: (u.files && Array.isArray(u.files)) ? u.files : [] }; changed = true; }
      else if (Array.isArray(u.files)) { u.files = { added: u.files.filter(function (m) { return m && typeof m === 'object'; }) }; changed = true; }
      if (changed) { try { localStorage.setItem(STORE_KEY, JSON.stringify(u)); } catch (e2) {} } /* local write only — never a cloud push */
    } catch (e) {}
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
    migrateShape();
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
  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast-' + kind : '');
    var ic = kind === 'ok' ? '✓' : kind === 'warn' ? '⚠' : kind === 'err' ? '✕' : 'ℹ';
    t.innerHTML = '<span class="toast-ic">' + ic + '</span><span>' + esc(msg) + '</span>';
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2400);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 2950);
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
    /* Japanese speech via the app server, chunked at sentence boundaries */
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
    /* retired: audio just works — no Google-TTS notice is shown anymore */
  }

  /* ---------- navigation ---------- */
  /* grouped header: Home + three dropdown groups + Add/Edit + control cluster.
     Top level is text-only (icons live inside the dropdown panels). */
  var NAV_GROUPS = [
    { label: 'Learn', items: [
      { href: 'learn.html', icon: '🎯', label: 'Learn' },
      { href: 'kanji.html', icon: '漢', label: 'Kanji' },
      { href: 'vocab.html', icon: '語', label: 'Vocabulary' },
      { href: 'kana.html', icon: 'あ', label: 'Kana' },
      { href: 'grammar.html', icon: '文', label: 'Grammar' }
    ] },
    { label: 'Practice', items: [
      { href: 'write.html', icon: '✍️', label: 'Writing' },
      { href: 'listening.html', icon: '🎧', label: 'Listening' },
      { href: 'tests.html', icon: '📝', label: 'Tests' }
    ] },
    { label: 'Tools', items: [
      { href: 'dictionary.html', icon: '辞', label: 'Dictionary' },
      { href: 'textbook.html', icon: '📖', label: 'Library' },
      { href: 'files.html', icon: '🗂️', label: 'Files' },
      { href: 'partner.html', icon: '🤝', label: 'Study Partner' },
      { href: 'board.html', icon: '📌', label: 'Cardboard' }
    ] }
  ];
  function renderNav() {
    var el = document.getElementById('nav');
    if (!el) return;
    var page = (location.pathname.split('/').pop() || 'index.html');
    var html = '<a class="nav-link' + (page === 'index.html' ? ' active' : '') + '" href="index.html">' + tt('Home') + '</a>';
    NAV_GROUPS.forEach(function (g) {
      var hasActive = g.items.some(function (n) { return n.href === page; });
      html += '<div class="nav-group' + (hasActive ? ' has-active' : '') + '">' +
        '<button class="nav-link nav-drop-btn" type="button">' + tt(g.label) + '<span class="caret">▾</span></button>' +
        '<div class="nav-menu">' + g.items.map(function (n) {
          return '<a class="' + (n.href === page ? 'active' : '') + '" href="' + n.href + '"><span class="ic">' + n.icon + '</span>' + tt(n.label) + '</a>';
        }).join('') + '</div></div>';
    });
    html += '<a class="nav-link nav-edit' + (page === 'edit.html' ? ' active' : '') + '" href="edit.html">' + tt('Add / Edit') + '</a>' +
      '<button class="nav-sync-btn" id="nav-refresh" type="button" title="Check for new data">↻</button>' +
      '<button class="nav-lang-btn" id="nav-lang" type="button" title="Myanmar / English">' + (langPref() === 'mm' ? tt('English') : 'မြန်မာ') + '</button>' +
      '<button class="nav-theme-btn" id="nav-theme" type="button" title="Light / dark theme">' + (getTheme() === 'dark' ? '☀️' : '🌙') + '</button>';
    el.innerHTML = html;
    /* dropdowns: hover on desktop (CSS), tap-toggle on touch, outside click closes */
    Array.prototype.forEach.call(el.querySelectorAll('.nav-group'), function (grp) {
      var btn = grp.querySelector('.nav-drop-btn');
      if (btn) btn.onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var was = grp.classList.contains('open');
        Array.prototype.forEach.call(el.querySelectorAll('.nav-group.open'), function (o) { o.classList.remove('open'); });
        if (!was) grp.classList.add('open');
      };
    });
    if (!renderNav._outsideBound) {
      renderNav._outsideBound = true;
      document.addEventListener('click', function () {
        var nav = document.getElementById('nav');
        if (!nav) return;
        Array.prototype.forEach.call(nav.querySelectorAll('.nav-group.open'), function (o) { o.classList.remove('open'); });
      });
    }
    var rf = document.getElementById('nav-refresh');
    if (rf) rf.onclick = function () {
      rf.classList.add('spin');
      pullUserData(function (r) {
        rf.classList.remove('spin');
        if (r && r.updated && r.pending) JL.toast(tt('New data is ready — it will load when you leave this page.'), 'ok');
        else JL.toast(r && r.updated ? tt('Data updated ✓') : tt('Already up to date'), 'ok');
      });
    };
    var lb = document.getElementById('nav-lang');
    if (lb) lb.onclick = function () { setLang(langPref() === 'mm' ? 'en' : 'mm'); };
    var tb = document.getElementById('nav-theme');
    if (tb) tb.onclick = function () {
      toggleTheme();
      tb.textContent = getTheme() === 'dark' ? '☀️' : '🌙';
    };
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
      var open = ch.classList.contains('chips-closed') ? pref(key) === '1' : pref(key) !== '0';
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
    if (i >= scripts.length) { JL.renderNav(); JL.initCatToggle(); JL.levelBar(); JL.translateNode(document.body); JL.sync.pull(); return; }
    var s = document.createElement('script');
    s.text = scripts[i];
    document.body.appendChild(s);
    runScripts(scripts, i + 1);
  }
  function navigate(href, push, opts) {
    if (router.busy) return;
    router.busy = true; router.busyAt = Date.now();
    /* stage markers: if the main thread ever freezes mid-navigation, the
       last written stage (localStorage 'jl_navstage') pinpoints where */
    function navMark(stage) { try { localStorage.setItem('jl_navstage', href + ' @ ' + stage + ' ' + new Date().toISOString()); } catch (e) {} }
    navMark('start');
    var pathOnly = href.split('?')[0];
    fetch(pathOnly).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var main = doc.querySelector('main');
      if (!main) { router.busy = false; location.href = href; return; }
      ensureHeadResources(doc.head, function () {
        navMark('head-done');
        if (push !== false) { try { history.pushState(null, '', href); } catch (e) {} }
        document.title = doc.title || 'Japanese Learning';
        document.querySelector('main').replaceWith(main);
        navMark('swapped');
        var scripts = [];
        Array.prototype.forEach.call(doc.querySelectorAll('script:not([src])'), function (s) {
          scripts.push(s.textContent);
        });
        runScripts(scripts, 0);
        navMark('scripts-done');
        window.scrollTo(0, (opts && opts.restoreScroll != null) ? opts.restoreScroll : 0);
        router.busy = false;
      });
    }).catch(function () {
      navMark('fallback-reload');
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
    /* safety: if a navigation ever hangs (e.g. a CDN script stalls), unstick
       the router so header links keep working */
    setInterval(function () {
      if (router.busy && Date.now() - (router.busyAt || 0) > 8000) {
        try { localStorage.setItem('jl_hang', 'busy stuck >8s | last stage: ' + localStorage.getItem('jl_navstage')); } catch (e) {}
        router.busy = false; router.busyAt = 0;
      }
    }, 3000);
  }

  /* ---------- unified chapter list (shared by every page) ---------- */
  /* All pages show the SAME chapters: the union across kanji/vocab/grammar/
     sentences/tests plus the user's custom chapters (uchapters). So a chapter
     created anywhere — e.g. a new kanji in chapter 16 — appears on every page.
     `count` = items of THIS kind in that chapter; chapter 0 ("Essential / my
     words") only shows on the kind that owns it. */
  function chapters(kind, lvl) {
    var LV = lvl || level();
    var seen = {}, out = [];
    ['kanji', 'vocab', 'grammar', 'sentences', 'tests'].forEach(function (k2) {
      merged(k2).forEach(function (it) {
        if (it == null) return;
        if ((it.level || 'N5') !== LV) return;
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
      if ((c.lvl || 'N5') !== LV) return;
      var n = Number(c.n);
      if (!seen[n]) { seen[n] = { n: n, t: c.t || ('Chapter ' + n), count: 0 }; out.push(seen[n]); }
      else seen[n].t = c.t || seen[n].t;
    });
    out.sort(function (a, b) { return a.n - b.n; });
    return out;
  }

  /* ---------- JLPT levels (N5 … N1) — data items carry .level, default N5 ---------- */
  var LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
  function level() {
    var l = pref('level');
    return LEVELS.indexOf(l) >= 0 ? l : 'N5';
  }
  function setLevel(l) {
    if (LEVELS.indexOf(l) < 0) return;
    pref('level', l);
    refreshPage(); /* re-run the current page with the new level's data */
  }
  function byLevel(arr) {
    var l = level();
    return (arr || []).filter(function (it) { return it && (it.level || 'N5') === l; });
  }
  /* every page that wants the level picker just includes <div id="level-bar"></div> */
  function mountLevelBar() {
    var el = document.getElementById('level-bar');
    if (!el) return;
    var cur = level();
    el.className = 'level-bar';
    el.innerHTML = '<span class="lb-label">JLPT</span>' + LEVELS.map(function (l) {
      return '<button class="lvl-btn' + (l === cur ? ' active' : '') + '" data-lvl="' + l + '" title="Show ' + l + ' content">' + l + '</button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.lvl-btn'), function (b) {
      b.onclick = function () { if (b.dataset.lvl !== level()) setLevel(b.dataset.lvl); };
    });
  }

  /* ---------- per-kanji memorization images (cloud-synced mapping kanjiId -> fileId) ---------- */
  function kimgGet(kanjiId) { return (pref('kimg') || {})[kanjiId] || null; }
  function kimgSet(kanjiId, fileId) {
    var m = pref('kimg') || {};
    if (fileId) m[kanjiId] = fileId; else delete m[kanjiId];
    pref('kimg', m);
  }

  /* display title of chapter n — a renamed chapter (uchapters registry)
     always wins over the title baked into the data items */
  function chapterTitle(kind, n, fb) {
    var num = Number(n) || 0;
    if (num > 0) {
      var c = (pref('uchapters') || []).filter(function (x) { return Number(x.n) === num; })[0];
      if (c && c.t) return c.t;
    }
    return fb || '';
  }

  /* ---------- UI language (English / Myanmar) + theme (light / dark) ---------- */
  var THEME_KEY = 'jl_theme';
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme() {
    try { document.documentElement.setAttribute('data-theme', getTheme()); } catch (e) {}
  }
  function setTheme(th) {
    try {
      if (th === 'dark') localStorage.setItem(THEME_KEY, 'dark');
      else localStorage.removeItem(THEME_KEY);
    } catch (e) {}
    applyTheme();
  }
  function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

  /* Myanmar UI dictionary: exact English phrase -> Myanmar phrase. Anything
     not listed stays in English. Keys are matched against the trimmed text
     of every text node (static and dynamically inserted), and via tt(). */
  var MM = {
    'Home': 'ပင်မ', 'Library': 'စာကြည့်တိုက်', 'Learn': 'လေ့လာ', 'Kanji': 'ခန်းဂျိ',
    'Vocabulary': 'စကားလုံးများ', 'Dictionary': 'အဘိဓာန်', 'Writing': 'စာရေးမည်', 'Kana': 'ကာန',
    'Grammar': 'သဒ္ဒါ', 'Listening': 'နားထောင်မည်', 'Tests': 'စာမေးပွဲများ', 'Practice': 'လေ့ကျင့်ခန်း', 'Tools': 'ကိရိယာများ', 'Files': 'ဖိုင်များ',
    'Study Partner': 'လေ့လာရေးအဖော်',
    'Cardboard': 'ကတ်ထူ',
    'Cardboard History': 'ကတ်ထူ မှတ်တမ်း',
    'Upcoming': 'လာမည့် တာဝန်များ',
    'Finished': 'ပြီးစီးပြီး',
    'What needs doing?': 'ဘာလုပ်ရမလဲ?',
    'Today': 'ဒီနေ့',
    'Overdue': 'ရက်လွန်',
    'Someday': 'အချိန်မရွေး',
    'No tasks yet — pin your first one!': 'တာဝန် ဘာမှ မရှိသေးပါ — ပင်တပ်လိုက်ပါ!',
    'Nothing finished yet.': 'မပြီးစီးရသေးပါ။',
    'Task updated ✏️': 'တာဝန် ပြင်ဆင်ပြီးပါပြီး ✏️',
    'Pin tasks to plan, finish them, and look back on what you did.': 'လုပ်ရမည့် တာဝန်များကို ပင်တပ်ထားပြီး ပြီးမြောက်သည့်အခါ မှတ်တမ်းတင်ပါ။',
    'Type a task first.': 'တာဝန် ရိုက်ထည့်ပါ။', 'Add / Edit': 'ထည့်ရန် / ပြင်ရန်', 'More': 'နောက်ထပ်', 'Close': 'ပိတ်မည်',
    'All': 'အားလုံး', 'All chapters': 'အခန်းအားလုံး', 'All kanji': 'ခန်းဂျိ အားလုံး',
    'All words': 'စကားလုံး အားလုံး', 'All sentences': 'ဝါကျအားလုံး', 'All grammar': 'သဒ္ဒါအားလုံး',
    'All levels': 'အဆင့်အားလုံး', 'Chapters': 'အခန်းများ', 'Level': 'အဆင့်', 'Title': 'ခေါင်းစဉ်',
    'Meaning': 'အဓိပ္ပာယ်', 'Category': 'အမျိုးအစား', 'Pattern': 'ပုံစံ', 'Explanation': 'ရှင်းလင်းချက်',
    'Japanese': 'ဂျပန်', 'Reading': 'ဖတ်ပုံ', 'Romaji': 'ရိုမားဂျိ', 'Vocab': 'စကားလုံး',
    'Listen': 'နားထောင်ရန်', 'Open': 'ဖွင့်မည်', 'Save': 'သိမ်းမည်', 'Cancel': 'ပယ်ဖျက်မည်',
    'Delete': 'ဖျက်မည်', 'Edit': 'ပြင်မည်', 'Search': 'ရှာဖွေရန်', 'Back': 'နောက်သို့', 'Next': 'ရှေ့သို့',
    'Clear': 'ရှင်းမည်', 'Undo': 'ပြန်ဖျက်မည်', 'Score': 'အမှတ်', 'Review': 'ပြန်သုံးသပ်ရန်',
    'Select': 'ရွေးရန်', 'Selected': 'ရွေးချယ်ပြီး', 'Backup': 'အရံသိမ်းမည်', 'Words': 'စကားလုံးများ',
    'Sentences': 'ဝါကျများ', 'Type': 'အမျိုးအစား', 'Size': 'အရွယ်အစား', 'On': 'အွန်', 'Kun': 'ကွန်',
    'Correct!': 'မှန်ပါသည်!', 'Wrong!': 'မှားပါသည်!', 'Show answer': 'အဖြေပြရန်', 'Reveal': 'အဖြေပြရန်',
    'English': 'အင်္ဂလိပ်', 'English meaning': 'အင်္ဂလိပ်အဓိပ္ပာယ်', 'Burmese meaning': 'မြန်မာအဓိပ္ပာယ်',
    '🔊 Listen': '🔊 နားထောင်ရန်', 'Next →': 'ရှေ့သို့ →', '← Prev': '← နောက်သို့', '🧹 Clear': '🧹 ရှင်းရန်',
    '↩ Undo stroke': '↩ စုတ်တံပြန်ဖျက်ရန်', '👁 Hide guide': '👁 လမ်းညွှန်ဝှက်ရန်', '— no chapter —': '— အခန်းမရှိပါ —',
    '✨ New / clear': '✨ အသစ် / ရှင်းရန်', '📚 Chapters': '📚 အခန်းများ', '🗑 Delete': '🗑 ဖျက်ရန်',
    'My Files': 'ကျွန်ုပ်၏ ဖိုင်များ', '🗂️ My Files': '🗂️ ကျွန်ုပ်၏ ဖိုင်များ', '✍️ Write': '✍️ ရေးရန်',
    'Flashcards': 'ဖလက်ရှ်ကဒ်', 'Start flashcards': 'ဖလက်ရှ်ကဒ် စတင်ရန်', 'Start quiz': 'ဉာဏ်စမ်း စတင်ရန်',
    'Start quiz (10 questions)': 'ဉာဏ်စမ်း စတင်ရန် (မေးခွန်း ၁၀ ခု)', 'Next word →': 'နောက်စကားလုံး →',
    '← Prev word': '← ရှေ့စကားလုံး', 'My tests': 'ကျွန်ုပ်၏ test များ', 'Your tests': 'သင်၏ test များ',
    'No matches.': 'မတွေ့ရှိပါ။', 'No tests yet.': 'tests မရှိသေးပါ။',
    '💾 Save quiz': '💾 ဉာဏ်စမ်း သိမ်းရန်', '💾 Save deck': '💾 Deck သိမ်းရန်', '💾 Save word': '💾 Word သိမ်းရန်',
    '💾 Save kanji': '💾 ခန်းဂျိသိမ်းရန်', '💾 Save grammar point': '💾 သဒ္ဒါသိမ်းရန်',
    '💾 Add / update chapter': '💾 အခန်း ထည့်ရန် / ပြင်ရန်', '✏️ Rename': '✏️ အမည်ပြောင်းရန်', '✏️ Edit': '✏️ ပြင်ရန်',
    '➕ Add vocabulary': '➕ စကားလုံးထည့်ရန်', '➕ Add kanji': '➕ ခန်းဂျိထည့်ရန်', '➕ Add grammar point': '➕ သဒ္ဒါထည့်ရန်',
    '➕ Build your own quiz': '➕ ကိုယ်ပိုင် ဉာဏ်စမ်း ဖန်တီးရန်', '➕ Build a flashcard deck': '➕ Flashcard ဖန်တီးရန်',
    '💾 Backup your additions': '💾 ထည့်သွင်းမှုများ အရံသိမ်းရန်', '⬇ Download': '⬇ ဒေါင်းလုဒ်မည်',
    '⬇ Download book': '⬇ စာအုပ် ဒေါင်းလုဒ်မည်', '⬇ Export my data (JSON)': '⬇ ဒေတာထုတ်ယူမည် (JSON)',
    '⬆ Import backup': '⬆ backup import လုပ်မည်', '⬆ Upload': '⬆ တင်မည်',
    '♻️ Restore all deleted base items': '♻️ ဖျက်ထားသော မူလအရာများအားလုံး ပြန်ထည့်သွင်းရန်',
    '🗑 Reset ALL my changes': '🗑 ကျွန်ုပ်၏ ပြောင်းလဲမှုများအားလုံး ပြန်စတင်ရန်',
    '+ Add example': '+ ဥပမာ ထည့်ရန်', '+ Add exercise': '+ လေ့ကျင့်ခန်း ထည့်ရန်', '+ Add example word': '+ ဥပမာ စကားလုံး ထည့်ရန်',
    '+ Add question': '+ မေးခွန်း ထည့်ရန်', '+ Add card': '+ ကတ်ပြား ထည့်ရန်',
    '🐢 Slow': '🐢 နှေး', '🔁 Replay': '🔁 ပြန်ဖွင့်ရန်', '✕ Clear': '✕ ရှင်းရန်',
    '✕ Clear selection': '✕ Selection ရှင်းရန်', '☑ Select': '☑ ရွေးရန်', 'Clear selection': 'Selection ရှင်းရန်',
    '🔍 Search': '🔍 ရှာဖွေရန်', '👀 Show word': '👀 စကားလုံးပြရန်', '👀 Show sentence': '👀 ဝါကျပြရန်',
    '👀 See': '👀 ကြည့်မည်', 'Next sentence →': 'နောက်ဝါကျ →', '✓ Check': '✓ စစ်ဆေးရန်',
    '💡 Give up': '💡 လက်လျှော့ရန်', '🔀 Shuffle': '🔀 ရောနှောရန်', '👀 Reveal': '👀 အဖြေပြရန်', '🙈 Hide': '🙈 ဖျက်ရန်',
    'Send ➤': 'ပို့ရန် ➤', '＋ New chat': '＋ Chat အသစ်စရန်', '⏮ First': '⏮ ပထမ', 'Last ⏭': 'နောက်ဆုံး ⏭',
    '📖 Open in Library': '📖 စာကြည့်တိုက်တွင် ဖွင့်ရန်', '▶ Take': '▶ ဖြေရန်', '▶ Take this test': '▶ ဤစမ်းသပ်မှုကို ဖြေရန်',
    '▶ Take this quiz again': '▶ ဤဉာဏ်စမ်းကို ထပ်ဖြေရန်',
    '🔊 Listen to the word': '🔊 စကားလုံးကို နားထောင်ရန်', '🔊 Listen to word': '🔊 စကားလုံးကို နားထောင်ရန်',
    '🔊 Listen to the kanji': '🔊 ခန်းဂျိကို နားထောင်ရန်',
    '✍️ Practice writing': '✍️ စာရေး လေ့ကျင့်မည်', '✍️ Write it': '✍️ ရေးပါ',
    '↩ Back': '↩ နောက်သို့', '🔄 Change image': '🔄 ပုံ ပြောင်းမည်', '🗑 Remove': '🗑 ဖယ်ရှားမည်',
    '⬆️ Upload image': '⬆️ ပုံ တင်မည်', '🗂️ Pick from my files': '🗂️ ဖိုင်များမှ ရွေးမည်',
    '➖ Zoom out': '➖ ချုံ့ရန်', '➕ Zoom in': '➕ ချဲ့မည်', '↺ 100%': '↺ ၁၀၀%',
    'Open in new tab ↗': 'Tab အသစ်တွင် ဖွင့်ရန် ↗', '👁 Open': '👁 ဖွင့်ရန်',
    'My Library': 'ကျွန်ုပ်၏ စာကြည့်တိုက်', '📖 My Library': '📖 ကျွန်ုပ်၏ စာကြည့်တိုက်',
    '🗂️ Categories': '🗂️ အမျိုးအစားများ', '📚 Books': '📚 စာအုပ်များ',
    'Writing practice': 'စာရေး လေ့ကျင့်ခန်း', 'Writing Practice': 'စာရေး လေ့ကျင့်ခန်း',
    'Kanji Writing Practice': 'ခန်းဂျိ စာရေး လေ့ကျင့်ခန်း', 'Vocabulary Writing Practice': 'စကားလုံး စာရေး လေ့ကျင့်ခန်း',
    'Practice Tests': 'လေ့ကျင့် စမ်းသပ်မှုများ', 'Learn Session': 'လေ့လာမှု', 'Listening Session': 'နားထောင်မှု',
    'Data updated ✓': 'ဒေတာ အသစ်သို့ ပြောင်းပြီးပါပြီ ✓', 'Already up to date': 'ဒေတာသည် up to date အခြေအနေတွင် ရှိပါသည်',
    'New data is ready — it will load when you leave this page.': 'ဒေတာအသစ် ရှိပါသည် — ဤစာမျက်နှာမှ ထွက်သွားပါက ပြောင်းလဲပါမည်။',
    'Ch.': 'အခန်း', 'Chapter no.': 'အခန်းနံပါတ်', 'Quiz title': 'ဉာဏ်စမ်း ခေါင်းစဉ်', 'Deck title': 'ကတ်ပြား ခေါင်းစဉ်',
    'On readings (comma separated)': 'အွန် ဖတ်ပုံများ (ကော်မာဖြင့် ခွဲရန်)', 'Kun reading': 'ကွန် ဖတ်ပုံ',
    'Japanese (word)': 'ဂျပန် (စကားလုံး)', 'Reading (kana)': 'ဖတ်ပုံ (ခါနာ)',
    'Synonyms (comma separated)': 'အဓိပ္ပါယ်တူစကားလုံးများ (ကော်မာဖြင့် ခွဲရန်)', 'Antonyms (comma separated)': 'ဆန့်ကျင်ဘက်စကားလုံးများ (ကော်မာဖြင့် ခွဲရန်)',
    'Lesson no. (reference)': 'သင်ခန်းစာ အမှတ် (အညွှန်း)',
    'Essential / my words': 'အဓိက / ကျွန်ုပ်၏ စကားလုံးများ', 'Essential & my words': 'အဓိက & ကျွန်ုပ်၏ စကားလုံးများ',
    'Kanji entries': 'ခန်းဂျိ အရေအတွက်', 'Vocabulary words': 'စကားလုံး အရေအတွက်',
    'Grammar points': 'သဒ္ဒါ အချက်များ', 'Listening sentences': 'နားထောင်ရမည့် ဝါကျများ',
    'Your custom tests': 'သင်၏ ကိုယ်ပိုင် စမ်းသပ်မှုများ', 'Add / Edit Content': 'အကြောင်းအရာ ထည့်ရန် / ပြင်ရန်',
    'Kanji Learning & Practice': 'ခန်းဂျိ လေ့လာခြင်းနှင့် လေ့ကျင့်ခန်း', 'Vocabulary Learning & Practice': 'စကားလုံး လေ့လာခြင်းနှင့် လေ့ကျင့်ခန်း',
    'Grammar Learning & Exercises': 'သဒ္ဒါ လေ့လာခြင်းနှင့် လေ့ကျင့်ခန်း',
    'No sentences in this chapter yet.': 'ဤအခန်းတွင် ဝါကျများ မရှိသေးပါ။',
    'Characters in this word — tap to practice one:': 'ဤစကားလုံးရှိ စာလုံးများ — လေ့ကျင့်ရန် နှိပ်ပါ:'
  };
  function langPref() { return pref('lang') === 'mm' ? 'mm' : 'en'; }
  function tt(s) { return (langPref() === 'mm' && MM[s]) ? MM[s] : s; }
  var MM_REV = null;
  function revMap() {
    if (!MM_REV) { MM_REV = {}; for (var k in MM) if (MM[k]) MM_REV[MM[k]] = k; }
    return MM_REV;
  }
  function translateNode(root) {
    if (!root) return;
    var mm = langPref() === 'mm', map = mm ? MM : revMap();
    (function walk(n) {
      if (!n) return;
      if (n.nodeType === 3) {
        var s = n.nodeValue, key = s.replace(/^\s+|\s+$/g, '');
        /* only set when the value actually changes — setting an unchanged
           value still fires the characterData observer, which re-enters
           translateNode and can loop forever (froze the page whenever a
           translation equaled its key, e.g. 'Tests': 'Tests') */
        if (key && map[key]) { var t = s.replace(key, map[key]); if (t !== s) n.nodeValue = t; }
      } else if (n.nodeType === 1 && !/^(script|style)$/i.test(n.tagName)) {
        /* in English mode never touch Japanese / Myanmar data content */
        if (!mm && typeof n.className === 'string' && /(^|\s)(jp|mm)(\s|$)/.test(n.className)) return;
        for (var i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
      }
    })(root);
  }
  var langObserver = null;
  function watchLang() {
    if (langPref() !== 'mm' || langObserver || typeof MutationObserver === 'undefined') return;
    try {
      langObserver = new MutationObserver(function (muts) {
        if (langPref() !== 'mm') return;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'characterData') translateNode(m.target);
          else if (m.addedNodes) for (var j = 0; j < m.addedNodes.length; j++) translateNode(m.addedNodes[j]);
        }
      });
      langObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
  }
  function setLang(l) {
    pref('lang', l === 'mm' ? 'mm' : 'en');
    renderNav();
    translateNode(document.body);
    watchLang();
    /* full re-render where the page has no in-progress state */
    if (!refreshBlocked()) refreshPage();
  }

  /* diagnostics: surface uncaught errors instead of failing silently —
     shows a toast and remembers the last error for support */
  window.addEventListener('error', function (ev) {
    try {
      var msg = (ev && ev.message) ? ev.message : 'unknown error';
      try { localStorage.setItem('jl_lasterr', new Date().toISOString() + ' | ' + msg + ' | ' + String((ev && ev.filename) || '').split('/').pop() + ':' + ((ev && ev.lineno) || 0)); } catch (e2) {}
      if (typeof toast === 'function') toast('⚠️ Page error: ' + msg);
    } catch (e) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev && ev.reason; var msg = (r && r.message) ? r.message : String(r || 'unhandled rejection');
      try { localStorage.setItem('jl_lasterr', new Date().toISOString() + ' | promise: ' + msg); } catch (e2) {}
    } catch (e) {}
  });

  /* ---------- public API ---------- */
  return {
    data: merged, save: save, remove: remove, restore: restore,
    esc: esc, shuffle: shuffle, pickN: pickN, toast: toast, norm: norm, download: download,
    speak: speak, ttsSupported: ttsSupported, renderNav: renderNav, ttsBanner: ttsBanner, initRouter: initRouter, initCatToggle: initCatToggle, titleIcons: jlTitleIcons,
    quiz: quiz, flashcards: flashcards, pad: pad,
    files: { list: filesList, put: filePut, get: fileGet, del: fileDel, cat: fileCat },
    sync: { push: pushUserData, pull: pullUserData, live: startLiveSync },
    pref: pref, chapters: chapters, chapterTitle: chapterTitle, kimg: { get: kimgGet, set: kimgSet }, mmfix: mmfixValue,
    t: tt, translateNode: translateNode, watchLang: watchLang, lang: { get: langPref, set: setLang },
    applyTheme: applyTheme, theme: { get: getTheme, set: setTheme, toggle: toggleTheme },
    level: level, setLevel: setLevel, byLevel: byLevel, levelBar: mountLevelBar, LEVELS: LEVELS
  };
})();
document.addEventListener('DOMContentLoaded', function () { JL.applyTheme(); JL.renderNav(); JL.initRouter(); JL.initCatToggle(); JL.levelBar(); JL.titleIcons(); JL.translateNode(document.body); JL.watchLang(); JL.sync.pull(); JL.sync.live(); });
