/* Plinth — offline-first data entry for Hassan Index screening.
   Author: Md. Farhad Momin.
   Data lives on the phone (IndexedDB) and is uploaded to the supervisor's
   Google Drive through a Google Apps Script web app. */
(function () {
  'use strict';
  var VERSION = '1.1.0';
  var H = window.HCalc;

  /* ---------------- storage (IndexedDB) ---------------- */
  var dbp = new Promise(function (res, rej) {
    var rq = indexedDB.open('plinth', 1);
    rq.onupgradeneeded = function () {
      var db = rq.result;
      db.createObjectStore('buildings', { keyPath: 'id' });
      db.createObjectStore('photos', { keyPath: 'id' });
      db.createObjectStore('kv');
    };
    rq.onsuccess = function () { res(rq.result); };
    rq.onerror = function () { rej(rq.error); };
  });
  function tx(store, mode, fn) {
    return dbp.then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { res(out && 'result' in out ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var db = {
    all: function (st) { return tx(st, 'readonly', function (s) { return s.getAll(); }); },
    get: function (st, k) { return tx(st, 'readonly', function (s) { return s.get(k); }); },
    put: function (st, v, k) { return tx(st, 'readwrite', function (s) { return k === undefined ? s.put(v) : s.put(v, k); }); },
    del: function (st, k) { return tx(st, 'readwrite', function (s) { return s.delete(k); }); }
  };

  /* ---------------- state ---------------- */
  var S = {
    view: 'home', step: 0, b: null, buildings: [], projects: ['Jolshiri'], project: 'Jolshiri',
    settings: { surveyor: '', url: '', key: '', plasterMm: 12, unit: 'in', areaUnit: 'sft', autoUpload: true },
    uploading: false, thumbs: {}
  };
  var STEPS = ['Details', 'Columns', 'Walls', 'Photos', 'Results'];
  var PHOTO_LABELS = ['Plan sketch', 'Front view', 'Ground storey', 'Columns', 'Walls / core', 'Other'];

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return document.querySelector(sel); }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 3 : d) : '—'; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2200); }
  function opts(list, val) {
    return list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
  }
  function seg(path, val, choices) {
    return '<div class="seg">' + choices.map(function (c) {
      return '<button type="button" data-seg="' + path + '" data-v="' + esc(c[0]) + '" class="' + (String(val) === String(c[0]) ? 'on' : '') + '">' + esc(c[1]) + '</button>';
    }).join('') + '</div>';
  }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) {
    var ks = p.split('.'), last = ks.pop();
    var t = ks.reduce(function (a, k) { if (a[k] == null) a[k] = {}; return a[k]; }, o);
    t[last] = v;
  }

  /* ---------------- settings & projects ---------------- */
  function loadSettings() {
    return Promise.all([db.get('kv', 'settings'), db.get('kv', 'projects'), db.get('kv', 'project')]).then(function (r) {
      if (r[0]) Object.assign(S.settings, r[0]);
      if (r[1] && r[1].length) S.projects = r[1];
      if (r[2] && S.projects.indexOf(r[2]) >= 0) S.project = r[2];
      // Setup link: ?url=...&key=...&project=...
      var q = new URLSearchParams(location.search), changed = false;
      if (q.get('url')) { S.settings.url = q.get('url'); changed = true; }
      if (q.get('key')) { S.settings.key = q.get('key'); changed = true; }
      if (q.get('project')) {
        var p = q.get('project').trim();
        if (p && S.projects.indexOf(p) < 0) S.projects.push(p);
        S.project = p; changed = true;
      }
      if (changed) {
        history.replaceState(null, '', location.pathname);
        setTimeout(function () { toast('Upload settings saved from the setup link.', 3000); }, 400);
        return saveSettings();
      }
    });
  }
  function saveSettings() {
    return Promise.all([db.put('kv', S.settings, 'settings'), db.put('kv', S.projects, 'projects'), db.put('kv', S.project, 'project')]);
  }

  /* ---------------- buildings ---------------- */
  function loadBuildings() { return db.all('buildings').then(function (l) { S.buildings = l || []; }); }
  function projectBuildings() {
    return S.buildings.filter(function (b) { return b.project === S.project; })
      .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), undefined, { numeric: true }); });
  }
  function nextCode() {
    var n = 0;
    projectBuildings().forEach(function (b) { var m = /(\d+)\s*$/.exec(b.code || ''); if (m) n = Math.max(n, +m[1]); });
    return 'B' + String(n + 1).padStart(3, '0');
  }
  function newBuilding() {
    var u = S.settings.unit;
    return {
      id: uid(), project: S.project, code: nextCode(), date: today(), surveyors: S.settings.surveyor,
      system: '', storeys: '', level: 'Ground storey', basement: 'No', N: '', ApUnit: S.settings.areaUnit, Ap: '',
      floorMode: 'uniform', floorGroups: [], extraArea: '', statedColumns: '',
      checks: { permission: '', transfer: '', weaker: '' }, location: { text: '', lat: '', lon: '' }, notes: '',
      columns: [{ qty: '', b: '', d: '', unit: u, plaster: '', source: 'Measured' }],
      walls: [], photos: [], status: 'draft', created: new Date().toISOString(), updated: new Date().toISOString(),
      dirty: true, uploadedAt: '', serverNote: ''
    };
  }
  var saveTimer;
  function touch() {
    S.b.updated = new Date().toISOString(); S.b.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 300);
  }
  function saveCurrent() {
    if (!S.b) return Promise.resolve();
    var copy = JSON.parse(JSON.stringify(S.b));
    var i = S.buildings.findIndex(function (x) { return x.id === copy.id; });
    if (i >= 0) S.buildings[i] = copy; else S.buildings.push(copy);
    return db.put('buildings', copy);
  }
  function results(b) { return H.indices(b, { plasterMm: S.settings.plasterMm }); }

  /* ---------------- rendering ---------------- */
  function render() {
    var app = $('#app');
    if (S.view === 'home') app.innerHTML = homeView();
    else if (S.view === 'edit') app.innerHTML = editView();
    else if (S.view === 'settings') app.innerHTML = settingsView();
    if (S.view === 'edit' && S.step === 3) loadThumbs();
  }
  function netChip() { return '<span class="net">' + (navigator.onLine ? 'Online' : 'Offline') + '</span>'; }

  function homeView() {
    var list = projectBuildings(), waiting = list.filter(function (b) { return b.dirty; }).length;
    var h = '<div class="top"><img class="logo" src="icons/icon-192.png" alt=""><h1>Plinth</h1>' + netChip() +
      '<button class="icon-btn" data-act="settings" aria-label="Settings">⚙︎</button></div><div class="wrap">';
    if (!S.settings.url) h += '<div class="banner">Upload is not set up yet. Open the setup link from your supervisor, or add the upload link in Settings. You can still enter data.</div>';
    h += '<div class="card"><label class="f" for="proj">Project</label><div class="row"><select id="proj" data-act="project">' +
      opts(S.projects, S.project) + '</select><button class="btn light narrow" data-act="addProject">+ New</button></div>' +
      '<div class="tot"><span>' + list.length + ' building(s) · ' + waiting + ' waiting to upload</span></div>' +
      (list.length ? '<button class="btn block' + (waiting ? '' : ' light') + '" style="margin-top:10px" data-act="uploadAll"' + (S.uploading ? ' disabled' : '') + '>' +
      (S.uploading ? 'Uploading…' : (waiting ? '⇪ Upload ' + waiting + ' building' + (waiting > 1 ? 's' : '') + ' to Google Drive' : '✓ All uploaded · Upload again')) + '</button>' : '') + '</div>';
    h += installCard();
    if (!list.length) h += '<div class="empty">No buildings yet.<br>Tap <b>+ New building</b> to start.</div>';
    list.forEach(function (b) {
      var r = results(b), A = r.A;
      h += '<div class="bcard" role="button" tabindex="0" data-act="open" data-id="' + b.id + '"><div class="t"><span class="code">' + esc(b.code || '(no code)') +
        '</span><span class="pi">PI ' + fmt(A.PI) + '%</span></div><div class="muted small">' + esc(b.storeys || '') +
        (b.storeys ? ' · ' : '') + esc(b.date || '') + '</div><div class="chips" style="margin-top:6px">' +
        (b.status === 'complete' ? '<span class="chip ok">Complete</span>' : '<span class="chip">Draft</span>') +
        (b.dirty ? '<span class="chip warn">Not uploaded</span>' : '<span class="chip ok">Uploaded</span>') +
        (r.warnings.length ? '<span class="chip warn">' + r.warnings.length + ' check(s)</span>' : '') +
        (A.PI < H.REF.PI ? '<span class="chip bad">PI &lt; 0.25%</span>' : '') + '</div>' +
        '<div class="cardfoot"><span class="muted small">' + (b.uploadedAt ? 'Last upload ' + esc(when(b.uploadedAt)) : 'Never uploaded') + '</span>' +
        '<button class="btn light mini" data-act="uploadCard" data-id="' + b.id + '"' + (S.uploading ? ' disabled' : '') + '>⇪ Upload</button></div></div>';
    });
    h += '</div><button class="btn fab" data-act="new">+ New building</button>';
    return h;
  }

  function editView() {
    var b = S.b;
    var h = '<div class="top"><button class="icon-btn" data-act="home" aria-label="Back">←</button><h1>' + esc(b.code || 'Building') +
      ' · ' + esc(b.project) + '</h1>' + netChip() + '</div><div class="steps">' +
      STEPS.map(function (s, i) { return '<button data-act="step" data-i="' + i + '" class="' + (i === S.step ? 'on' : '') + '">' + (i + 1) + ' ' + s + '</button>'; }).join('') +
      '</div><div class="wrap">' + [stepDetails, stepColumns, stepWalls, stepPhotos, stepResults][S.step](b) + '</div>';
    var upBtn = '<button class="btn ' + (S.step < 4 ? 'light up' : '') + '" data-act="uploadOne"' + (S.uploading ? ' disabled' : '') + '>' + (S.uploading ? 'Uploading…' : (S.step < 4 ? '⇪ Upload' : '⇪ Save & upload')) + '</button>';
    h += '<div class="bottom">' + (S.step > 0 ? '<button class="btn light" data-act="prev">Back</button>' : '<button class="btn light" data-act="home">Close</button>') +
      upBtn + (S.step < 4 ? '<button class="btn" data-act="next">Next</button>' : '') + '</div>';
    return h;
  }

  function field(label, path, val, type, hint, extra) {
    return '<label class="f">' + label + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label><input type="' + (type || 'text') + '" data-f="' + path +
      '" value="' + esc(val) + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + (extra || '') + '>';
  }
  function sel(label, path, val, list, hint) {
    return '<label class="f">' + label + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label><select data-f="' + path + '" data-rerender="1">' + opts(list, val) + '</select>';
  }
  var YN = [['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not sure']];

  function stepDetails(b) {
    var h = '<div class="card"><h2>Building</h2>' +
      field('Building code', 'code', b.code, 'text', 'Anonymous code only, e.g. B001. Never the owner’s name.') +
      '<div class="grid2"><div>' + field('Survey date', 'date', b.date, 'date') + '</div><div>' +
      field('Storeys (as described)', 'storeys', b.storeys, 'text', 'e.g. G+M+8') + '</div></div>' +
      field('Surveyor(s)', 'surveyors', b.surveyors) +
      sel('Structural system', 'system', b.system, [['', 'Choose…'], 'Cast-in-place RC frame', 'Cast-in-place RC frame-wall', 'Other or uncertain']) + '</div>';

    h += '<div class="card"><h2>Assessed level and floors</h2>' +
      sel('Assessed level', 'level', b.level, ['Ground storey', 'First storey above basement', 'First storey above podium', 'Other']) +
      sel('Basement', 'basement', b.basement, ['No', 'Yes, enclosed by RC retaining walls', 'Partial or sloping site']) +
      field('N = elevated slabs above the assessed level', 'N', b.N, 'number', 'Count every floor slab above, including the roof slab. G+9 → N = 10. G+M+8 → N = 10 if the mezzanine is a full floor. Roof stair/lift rooms are not counted.') +
      '<label class="f">Area unit</label>' + seg('ApUnit', b.ApUnit, [['sft', 'sq ft'], ['m2', 'm²']]) +
      field('Typical floor area', 'Ap', b.Ap, 'number', 'Area of one typical upper floor, including balconies and overhangs.') +
      '<label class="f">Are all floors the same size?</label>' + seg('floorMode', b.floorMode, [['uniform', 'Yes, all same'], ['groups', 'No, they differ']]);
    if (b.floorMode === 'groups') {
      h += '<div style="margin-top:10px">';
      (b.floorGroups || []).forEach(function (g, i) {
        h += '<div class="item"><div class="item-head">Floor group ' + (i + 1) + '<button class="x" data-act="delFloor" data-i="' + i + '">Remove</button></div><div class="row"><div>' +
          field('Number of floors', 'floorGroups.' + i + '.n', g.n, 'number') + '</div><div>' + field('Area per floor (' + (b.ApUnit === 'm2' ? 'm²' : 'sq ft') + ')', 'floorGroups.' + i + '.area', g.area, 'number') + '</div></div>' +
          field('Which floors?', 'floorGroups.' + i + '.desc', g.desc, 'text', 'e.g. 1st–6th, mezzanine') + '</div>';
      });
      h += '<button class="btn ghost" data-act="addFloor">+ Add floor group</button></div>';
    }
    h += field('Extra area: roof stair/lift room, penthouse', 'extraArea', b.extraArea, 'number', 'Same unit as above. Leave blank if none.');
    var fa = H.floorArea(b);
    h += '<div class="tot"><span>Total floor area above, A<sub>ft</sub></span><b data-live="aft">' + fmt(fa.Aft, 1) + ' m²</b></div></div>';

    h += '<div class="card"><h2>Eligibility checks</h2><label class="f">Permission from owner or manager?</label>' + seg('checks.permission', b.checks.permission, [['yes', 'Yes'], ['no', 'No']]) +
      '<label class="f">Transfer floor or floating columns above ground?</label>' + seg('checks.transfer', b.checks.transfer, YN) +
      '<label class="f">Likely weaker storey above ground?<span class="hint">e.g. an upper storey with fewer columns or walls than the ground storey</span></label>' + seg('checks.weaker', b.checks.weaker, YN) +
      field('Total number of columns at the assessed level', 'statedColumns', b.statedColumns, 'number', 'Used to check that every column is entered.') + '</div>';

    h += locationCard(b) + '<div class="card"><h2>Notes</h2><textarea data-f="notes">' + esc(b.notes) + '</textarea></div>';
    return h;
  }

  function locationCard(b) {
    var L = b.location || {}, has = L.lat !== '' && L.lat != null && L.lon !== '' && L.lon != null;
    var h = '<div class="card"><h2>Location (private)</h2><p class="muted">Taken from the phone’s GPS at the building. It goes only to the supervisor’s private location sheet, and is removed from this phone after upload.</p>';
    if (L.sent && !has) {
      h += '<div class="banner info">✓ Location sent to the supervisor and removed from this phone.</div><button class="btn light block" data-act="gps">Retake location</button>';
    } else if (S.gpsBusy) {
      h += '<div class="banner info">Getting GPS location… stand outside, close to the building.</div>';
    } else if (has) {
      var acc = H.num(L.acc), good = !(acc > 30);
      h += '<div class="gpsbox"><div><b>' + esc((+L.lat).toFixed(6)) + ', ' + esc((+L.lon).toFixed(6)) + '</b></div><div class="small ' + (good ? 'muted' : 'warntext') + '">' +
        (isNaN(acc) ? 'Entered by hand' : 'Accuracy ±' + Math.round(acc) + ' m' + (good ? '' : ': weak, retake outdoors')) + (L.time ? ' · ' + esc(when(L.time)) : '') + '</div></div>' +
        '<div class="grid2" style="margin-top:8px"><button class="btn light" data-act="gps">↻ Retake</button>' +
        '<a class="btn light" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(L.lat + ',' + L.lon) + '">Check on Google Maps</a></div>';
    } else {
      h += '<button class="btn block" data-act="gps">📍 Get location</button>' + (S.gpsError ? '<p class="small warntext">' + esc(S.gpsError) + '</p>' : '');
    }
    h += field('Landmark (optional)', 'location.text', L.text, 'text', 'e.g. corner plot opposite the mosque. The street address is added automatically from Google Maps.');
    if (S.editLoc) {
      h += '<div class="row"><div>' + field('Latitude', 'location.lat', L.lat, 'number') + '</div><div>' + field('Longitude', 'location.lon', L.lon, 'number') + '</div></div>';
    } else {
      h += '<button class="linkbtn" data-act="editLoc">Enter coordinates by hand instead</button>';
    }
    return h + '</div>';
  }

  var UNITS = [['in', 'inch'], ['ft', 'ft'], ['mm', 'mm'], ['cm', 'cm'], ['m', 'm']];

  function stepColumns(b) {
    var h = '<div class="card"><h2>Columns at the assessed level</h2><p class="muted">One row per column size. Enter the number of columns of that size.</p>';
    (b.columns || []).forEach(function (c, i) {
      h += '<div class="item"><div class="item-head">Size ' + (i + 1) + '<button class="x" data-act="delCol" data-i="' + i + '">Remove</button></div>' +
        '<div class="row"><div class="narrow">' + field('Count', 'columns.' + i + '.qty', c.qty, 'number') + '</div><div>' +
        field('Width', 'columns.' + i + '.b', c.b, 'number') + '</div><div>' + field('Depth', 'columns.' + i + '.d', c.d, 'number') + '</div></div>' +
        '<label class="f">Unit</label>' + seg('columns.' + i + '.unit', c.unit, UNITS) +
        '<label class="f">Measured over plaster?<span class="hint">If yes, the app deducts ' + esc(S.settings.plasterMm) + ' mm per face.</span></label>' +
        seg('columns.' + i + '.plaster', c.plaster, [['yes', 'Yes'], ['no', 'No, bare concrete'], ['drawing', 'From drawing']]) + '</div>';
    });
    var ca = H.columnArea(b, S.settings.plasterMm);
    h += '<button class="btn ghost" data-act="addCol">+ Add column size</button>' +
      '<div class="tot"><span>Columns entered</span><b data-live="ccount">' + ca.count + (b.statedColumns ? ' of ' + esc(b.statedColumns) : '') + '</b></div>' +
      '<div class="tot"><span>Total column area, A<sub>col</sub></span><b data-live="acol">' + fmt(ca.Acol, 4) + ' m²</b></div></div>';
    return h;
  }

  function stepWalls(b) {
    var h = '<div class="card"><h2>Walls at the assessed level</h2><p class="muted">One row per wall, or per group of identical walls. Use the X and Y directions marked on your plan sketch.</p>' +
      '<div class="note">• <b>RC wall</b>: confirmed structural concrete (shear walls, lift and stair core walls).<br>' +
      '• <b>Masonry infill</b>: brick wall fully enclosed by beams and columns on all edges. Measure net length after door and window openings.<br>' +
      '• <b>Lift/stair core</b>: split into straight segments and give each its own direction. Count each corner once.<br>' +
      '• <b>Not sure</b>: choose Uncertain and give its most likely type for Case B.</div>';
    (b.walls || []).forEach(function (w, i) {
      var p = 'walls.' + i + '.';
      h += '<div class="item"><div class="item-head">Wall ' + (i + 1) + '<button class="x" data-act="delWall" data-i="' + i + '">Remove</button></div>' +
        '<label class="f">Type</label>' + seg(p + 'type', w.type, [['rc', 'RC wall'], ['masonry', 'Masonry infill'], ['uncertain', 'Uncertain']]) +
        (w.type === 'uncertain' ? '<label class="f">Case B: most likely type</label>' + seg(p + 'caseB', w.caseB, [['rc', 'RC'], ['masonry', 'Masonry'], ['exclude', 'Exclude']]) : '') +
        '<label class="f">Direction</label>' + seg(p + 'dir', w.dir, [['X', 'X'], ['Y', 'Y']]) +
        '<div class="row"><div class="narrow">' + field('Count', p + 'qty', w.qty, 'number') + '</div><div>' + field('Length', p + 'L', w.L, 'number') + '</div></div>' +
        seg(p + 'Lunit', w.Lunit, UNITS) +
        field('Thickness', p + 't', w.t, 'number') + seg(p + 'tunit', w.tunit, UNITS) + '</div>';
    });
    var wa = H.wallAreas(b, false);
    h += '<button class="btn ghost" data-act="addWall">+ Add wall</button>' +
      '<div class="tot"><span>Effective wall area X</span><b data-live="wx">' + fmt(wa.X.eff, 4) + ' m²</b></div>' +
      '<div class="tot"><span>Effective wall area Y</span><b data-live="wy">' + fmt(wa.Y.eff, 4) + ' m²</b></div></div>';
    return h;
  }

  function stepPhotos(b) {
    var h = '<div class="card"><h2>Photos</h2><p class="muted">Take a clear photo of your measured plan sketch, with X and Y marked. Photos are resized to save data.</p><div class="grid2">' +
      PHOTO_LABELS.map(function (l) { return '<button class="btn light" data-act="photo" data-label="' + esc(l) + '">📷 ' + esc(l) + '</button>'; }).join('') +
      '</div></div><div class="card"><div class="photos">';
    if (!(b.photos || []).length) h += '<div class="muted" style="grid-column:1/-1">No photos yet.</div>';
    (b.photos || []).forEach(function (p, i) {
      h += '<div class="ph"><img data-thumb="' + p.id + '" alt="' + esc(p.label) + '">' + (p.uploaded ? '<span class="up">✓</span>' : '') +
        '<button class="del" data-act="delPhoto" data-i="' + i + '" aria-label="Delete photo">✕</button><span class="lbl">' + esc(p.label) + '</span></div>';
    });
    return h + '</div></div>';
  }

  function stepResults(b) {
    var r = results(b), A = r.A, B = r.B;
    var h = '<div class="card"><h2>Hassan indices (Case A)</h2><div class="big"><div><b>' + fmt(A.CI) + '</b><span>CI %</span></div><div><b>' + fmt(A.WImin) +
      '</b><span>WI<sub>min</sub> %</span></div><div><b>' + fmt(A.PI) + '</b><span>PI %</span></div></div><table class="res">' +
      '<tr><td>WI<sub>X</sub> / WI<sub>Y</sub></td><td>' + fmt(A.WIX) + ' / ' + fmt(A.WIY) + ' %</td></tr>' +
      '<tr><td>Controlling direction</td><td>' + (A.dir || '—') + '</td></tr>' +
      '<tr><td>Column density CD</td><td>' + fmt(A.CD, 2) + ' %</td></tr>' +
      '<tr><td>Wall density WD<sub>X</sub> / WD<sub>Y</sub></td><td>' + fmt(A.WDX, 2) + ' / ' + fmt(A.WDY, 2) + ' %</td></tr>' +
      '<tr><td>A<sub>ft</sub> / A<sub>col</sub></td><td>' + fmt(r.fa.Aft, 1) + ' / ' + fmt(r.ca.Acol, 3) + ' m²</td></tr></table>';
    if (!isNaN(A.PI)) {
      h += '<div class="chips" style="margin-top:10px">' +
        chip(A.PI < H.REF.PI, 'PI below 0.25%', 'PI at/above 0.25%') + chip(A.WImin < H.REF.WI_LOW, 'WI below 0.10%', 'WI at/above 0.10%') +
        chip(A.WImin < H.REF.WI_HIGH, 'WI below 0.20%', 'WI at/above 0.20%') + '</div>';
    }
    if (r.A.walls.uncertain) {
      h += '<p class="muted" style="margin-top:10px">Case B (uncertain walls reclassified): PI ' + fmt(B.PI) + '%, WI<sub>min</sub> ' + fmt(B.WImin) + '%. ' +
        (r.sensitive ? '<b style="color:var(--bad)">Classification-sensitive.</b>' : 'Flags unchanged.') + '</p>';
    }
    h += '<p class="note" style="margin-top:10px">These are screening indices for ranking within the surveyed inventory. They do not say whether a building is safe. Never give a result to owners or occupants.</p></div>';
    h += '<div class="card"><h2>Checks before upload</h2>' + (r.warnings.length ? '<ul class="warns">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '<p class="muted">No problems found.</p>') +
      '<label class="f">Status</label>' + seg('status', b.status, [['draft', 'Draft'], ['complete', 'Complete']]) +
      (b.serverNote ? '<div class="banner info" style="margin-top:10px">' + esc(b.serverNote) + '</div>' : '') +
      '<p class="muted small" style="margin-top:10px">' + (b.dirty ? 'Changes not uploaded yet.' : 'Uploaded ' + esc(new Date(b.uploadedAt).toLocaleString())) + '</p>' +
      '<button class="btn danger block" data-act="delBuilding" style="margin-top:6px">Delete this building from the phone</button></div>';
    return h;
  }
  function chip(bad, a, b) { return '<span class="chip ' + (bad ? 'bad' : 'ok') + '">' + (bad ? a : b) + '</span>'; }

  function settingsView() {
    var s = S.settings;
    return '<div class="top"><button class="icon-btn" data-act="home" aria-label="Back">←</button><h1>Settings</h1></div><div class="wrap">' +
      '<div class="card"><h2>You</h2>' + field('Your name (pre-fills Surveyor)', 's.surveyor', s.surveyor) + '</div>' +
      '<div class="card"><h2>Upload to Google Drive</h2><p class="muted">Your supervisor gives you a setup link that fills these in.</p>' +
      field('Upload link', 's.url', s.url, 'url') + field('Upload key', 's.key', s.key, 'password') +
      '<label class="f">Upload automatically when online</label>' + seg('s.autoUpload', s.autoUpload ? 'yes' : 'no', [['yes', 'Yes'], ['no', 'No']]) +
      '<button class="btn light block" style="margin-top:10px" data-act="testUpload">Test connection</button></div>' +
      '<div class="card"><h2>Defaults</h2>' + field('Plaster allowance per face (mm)', 's.plasterMm', s.plasterMm, 'number') +
      '<label class="f">Default length unit</label>' + seg('s.unit', s.unit, UNITS) +
      '<label class="f">Default area unit</label>' + seg('s.areaUnit', s.areaUnit, [['sft', 'sq ft'], ['m2', 'm²']]) + '</div>' +
      '<div class="card"><h2>Backup</h2><p class="muted">Save all buildings (without photos) as a file, e.g. to send on WhatsApp if upload fails.</p>' +
      '<div class="grid2"><button class="btn light" data-act="backup">Save backup</button><button class="btn light" data-act="restore">Restore</button></div></div>' +
      '<p class="muted small" style="text-align:center">Plinth v' + VERSION + ' · Hassan Index field survey<br>by Md. Farhad Momin</p></div>';
  }

  /* ---------------- live updates (no full re-render while typing) ---------------- */
  function live() {
    var b = S.b; if (!b) return;
    var set = function (k, v) { var e = document.querySelector('[data-live="' + k + '"]'); if (e) e.textContent = v; };
    var fa = H.floorArea(b), ca = H.columnArea(b, S.settings.plasterMm), wa = H.wallAreas(b, false);
    set('aft', fmt(fa.Aft, 1) + ' m²'); set('acol', fmt(ca.Acol, 4) + ' m²');
    set('ccount', ca.count + (b.statedColumns ? ' of ' + b.statedColumns : ''));
    set('wx', fmt(wa.X.eff, 4) + ' m²'); set('wy', fmt(wa.Y.eff, 4) + ' m²');
    var h1 = document.querySelector('.top h1'); if (h1 && S.view === 'edit') h1.textContent = (b.code || 'Building') + ' · ' + b.project;
  }

  /* ---------------- events ---------------- */
  document.addEventListener('input', function (e) {
    var p = e.target.getAttribute('data-f'); if (!p) return;
    var v = e.target.value;
    if (p.indexOf('s.') === 0) { setPath(S.settings, p.slice(2), p === 's.plasterMm' ? (parseFloat(v) || 0) : v); saveSettings(); return; }
    setPath(S.b, p, v); touch(); live();
    if (e.target.tagName === 'SELECT' && e.target.dataset.rerender) keepScroll(render);
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'proj') { S.project = e.target.value; saveSettings(); render(); }
  });
  function keepScroll(fn) { var y = window.scrollY; fn(); window.scrollTo(0, y); }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-seg],[data-act]'); if (!t) return;
    if (t.dataset.seg) {
      var p = t.dataset.seg, v = t.dataset.v;
      if (p.indexOf('s.') === 0) {
        var k = p.slice(2); S.settings[k] = k === 'autoUpload' ? v === 'yes' : v; saveSettings();
      } else {
        var cur = getPath(S.b, p);
        setPath(S.b, p, cur === v && p.indexOf('checks.') === 0 ? '' : v); touch();
        if (p === 'ApUnit') { S.settings.areaUnit = v; saveSettings(); }
        if (/\.unit$|Lunit$|tunit$/.test(p)) { S.settings.unit = v; saveSettings(); }
      }
      return keepScroll(render);
    }
    var a = t.dataset.act, i = +t.dataset.i, b = S.b;
    switch (a) {
      case 'settings': S.view = 'settings'; render(); window.scrollTo(0, 0); break;
      case 'home': saveCurrent().then(function () { S.view = 'home'; S.b = null; render(); window.scrollTo(0, 0); }); break;
      case 'new': S.b = newBuilding(); S.step = 0; S.view = 'edit'; S.editLoc = false; S.gpsError = ''; saveCurrent(); render(); window.scrollTo(0, 0); gps(true); break;
      case 'open': S.b = JSON.parse(JSON.stringify(S.buildings.find(function (x) { return x.id === t.dataset.id; })));
        if (!S.b.checks) S.b.checks = {}; if (!S.b.location) S.b.location = {};
        S.step = 0; S.view = 'edit'; S.editLoc = false; S.gpsError = ''; S.gpsBusy = false; render(); window.scrollTo(0, 0); break;
      case 'step': S.step = i; render(); window.scrollTo(0, 0); break;
      case 'next': S.step = Math.min(4, S.step + 1); saveCurrent(); render(); window.scrollTo(0, 0); break;
      case 'prev': S.step = Math.max(0, S.step - 1); render(); window.scrollTo(0, 0); break;
      case 'addProject': {
        var n = (prompt('New project name (e.g. Jolshiri, Mirpur):') || '').trim();
        if (n) { if (S.projects.indexOf(n) < 0) S.projects.push(n); S.project = n; saveSettings(); render(); }
        break;
      }
      case 'addFloor': b.floorGroups = b.floorGroups || []; b.floorGroups.push({ n: '', area: '', desc: '' }); touch(); keepScroll(render); break;
      case 'delFloor': b.floorGroups.splice(i, 1); touch(); keepScroll(render); break;
      case 'addCol': b.columns.push({ qty: '', b: '', d: '', unit: S.settings.unit, plaster: (b.columns[b.columns.length - 1] || {}).plaster || '', source: 'Measured' }); touch(); keepScroll(render); break;
      case 'delCol': if (confirm('Remove this column size?')) { b.columns.splice(i, 1); touch(); keepScroll(render); } break;
      case 'addWall': b.walls.push({ type: 'rc', dir: '', qty: 1, L: '', Lunit: S.settings.unit === 'in' ? 'ft' : S.settings.unit, t: '', tunit: S.settings.unit, caseB: '' }); touch(); keepScroll(render); break;
      case 'delWall': if (confirm('Remove this wall?')) { b.walls.splice(i, 1); touch(); keepScroll(render); } break;
      case 'photo': takePhoto(t.dataset.label); break;
      case 'delPhoto': if (confirm('Delete this photo?')) { var ph = b.photos.splice(i, 1)[0]; db.del('photos', ph.id); touch(); keepScroll(render); } break;
      case 'gps': gps(); break;
      case 'delBuilding':
        if (confirm('Delete ' + (b.code || 'this building') + ' from this phone? Data already uploaded to Drive stays there.')) {
          (b.photos || []).forEach(function (p) { db.del('photos', p.id); });
          db.del('buildings', b.id).then(function () { S.buildings = S.buildings.filter(function (x) { return x.id !== b.id; }); S.b = null; S.view = 'home'; render(); });
        }
        break;
      case 'uploadOne': saveCurrent().then(function () { return uploadAll([S.b.id]); }); break;
      case 'uploadAll': {
        var pl = projectBuildings(), wt = pl.filter(function (x) { return x.dirty; });
        uploadAll((wt.length ? wt : pl).map(function (x) { return x.id; }));
        break;
      }
      case 'uploadCard': uploadAll([t.dataset.id]); break;
      case 'editLoc': S.editLoc = true; keepScroll(render); break;
      case 'install': doInstall(); break;
      case 'hideInstall': S.hideInstall = true; db.put('kv', true, 'hideInstall'); keepScroll(render); break;
      case 'testUpload': testUpload(); break;
      case 'backup': backup(); break;
      case 'restore': $('#restoreInput').click(); break;
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('bcard')) { e.preventDefault(); e.target.click(); }
  });

  /* ---------------- photos ---------------- */
  var pendingLabel = '';
  function takePhoto(label) { pendingLabel = label; var inp = $('#photoInput'); inp.value = ''; inp.click(); }
  $('#photoInput').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f || !S.b) return;
    toast('Saving photo…');
    shrink(f, 1600, 0.78).then(function (blob) {
      var id = uid(), b = S.b;
      var n = (b.photos || []).filter(function (p) { return p.label === pendingLabel; }).length + 1;
      var name = (b.code || 'B') + '_' + pendingLabel.replace(/[^A-Za-z0-9]+/g, '-') + '_' + n + '.jpg';
      return db.put('photos', { id: id, blob: blob }).then(function () {
        b.photos.push({ id: id, label: pendingLabel, name: name, taken: new Date().toISOString(), uploaded: false });
        touch(); keepScroll(render); toast('Photo saved.');
      });
    }).catch(function () { toast('Could not read that photo.'); });
  });
  function shrink(file, max, q) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (bl) { bl ? res(bl) : rej(); }, 'image/jpeg', q);
      };
      img.onerror = rej; img.src = url;
    });
  }
  function loadThumbs() {
    document.querySelectorAll('[data-thumb]').forEach(function (img) {
      var id = img.dataset.thumb;
      if (S.thumbs[id]) { img.src = S.thumbs[id]; return; }
      db.get('photos', id).then(function (r) { if (r && r.blob) { S.thumbs[id] = URL.createObjectURL(r.blob); img.src = S.thumbs[id]; } });
    });
  }

  function gps(silent) {
    var b = S.b;
    if (!navigator.geolocation) { S.gpsError = 'This phone does not give a location to Chrome.'; if (!silent) keepScroll(render); return; }
    S.gpsBusy = true; S.gpsError = ''; if (S.view === 'edit' && S.step === 0) keepScroll(render);
    navigator.geolocation.getCurrentPosition(function (p) {
      S.gpsBusy = false;
      if (!S.b || S.b.id !== b.id) return;
      S.b.location = S.b.location || {};
      Object.assign(S.b.location, { lat: p.coords.latitude.toFixed(6), lon: p.coords.longitude.toFixed(6),
        acc: Math.round(p.coords.accuracy), time: new Date().toISOString(), source: 'gps', sent: false });
      S.editLoc = false; touch();
      if (S.view === 'edit' && S.step === 0) keepScroll(render);
      toast('Location added (±' + Math.round(p.coords.accuracy) + ' m).');
    }, function (err) {
      S.gpsBusy = false;
      S.gpsError = err && err.code === 1 ? 'Location permission is off. Allow location for Chrome, then tap Get location.' : 'Could not get a GPS fix. Go outside and tap Get location again.';
      if (S.view === 'edit' && S.step === 0) keepScroll(render);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  /* ---------------- upload ---------------- */
  function post(payload) {
    return fetch(S.settings.url, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Unexpected reply from Drive script.'); } if (!j.ok) throw new Error(j.error || 'Upload refused.'); return j; });
  }
  function blobToB64(blob) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.readAsDataURL(blob); });
  }
  function summary(b) {
    var r = results(b), A = r.A, B = r.B;
    return { Ap_m2: r.fa.Ap, Aft_m2: r.fa.Aft, Acol_m2: r.ca.Acol, columnsEntered: r.ca.count,
      rcX: A.walls.X.rc, masX: A.walls.X.mas, effX: A.walls.X.eff, rcY: A.walls.Y.rc, masY: A.walls.Y.mas, effY: A.walls.Y.eff,
      CI: A.CI, WIX: A.WIX, WIY: A.WIY, WImin: A.WImin, dir: A.dir, PI: A.PI, CD: A.CD, WDX: A.WDX, WDY: A.WDY,
      PI_B: B.PI, WImin_B: B.WImin, sensitive: r.sensitive, warnings: r.warnings, plasterMm: S.settings.plasterMm };
  }
  function uploadAll(ids) {
    if (S.uploading) return;
    if (!S.settings.url || !S.settings.key) { toast('Upload is not set up. Ask your supervisor for the setup link.', 3500); return; }
    if (!navigator.onLine) { toast('No signal: everything is saved on the phone and will upload when you are online.', 4000); return; }
    var list = S.buildings.filter(function (b) { return ids ? ids.indexOf(b.id) >= 0 : (b.dirty && b.project === S.project); });
    if (!list.length) { toast('Nothing to upload.'); return; }
    S.uploading = true; render();
    var done = 0, failed = 0, lastErr = '', names = [];
    var chain = Promise.resolve();
    list.forEach(function (b0) {
      chain = chain.then(function () {
        var b = JSON.parse(JSON.stringify(b0));
        var rec = JSON.parse(JSON.stringify(b)); delete rec.location; delete rec.dirty; delete rec.serverNote;
        return post({ action: 'building', key: S.settings.key, app: VERSION, building: rec, results: summary(b), location: b.location })
          .then(function (resp) {
            var photos = (b.photos || []).filter(function (p) { return !p.uploaded; });
            var pc = Promise.resolve();
            photos.forEach(function (p) {
              pc = pc.then(function () { return db.get('photos', p.id); }).then(function (row) {
                if (!row) return;
                return blobToB64(row.blob).then(function (data) {
                  return post({ action: 'photo', key: S.settings.key, project: b.project, id: b.id, code: resp.code || b.code, name: p.name, label: p.label, data: data });
                }).then(function () { p.uploaded = true; });
              });
            });
            return pc.then(function () {
              var cur = (S.b && S.b.id === b.id) ? S.b : S.buildings.find(function (x) { return x.id === b.id; });
              if (!cur) { done++; return; }
              var upIds = (b.photos || []).filter(function (p) { return p.uploaded; }).map(function (p) { return p.id; });
              (cur.photos || []).forEach(function (p) { if (upIds.indexOf(p.id) >= 0) p.uploaded = true; });
              cur.serverNote = resp.note || ''; cur.uploadedAt = new Date().toISOString();
              if (cur.updated === b.updated) cur.dirty = false;
              var L0 = b.location || {}, L1 = cur.location || {};
              if (L0.lat && L1.lat === L0.lat && L1.lon === L0.lon && L1.text === L0.text) {
                cur.location = { text: '', lat: '', lon: '', sent: true, time: L1.time || '' };
              }
              names.push(resp.code || b.code);
              done++;
              return cur === S.b ? saveCurrent() : db.put('buildings', cur);
            });
          }).catch(function (err) { failed++; lastErr = err.message || String(err); });
      });
    });
    chain.then(function () {
      S.uploading = false; keepScroll(render);
      var msg = failed ? ((done ? 'Uploaded ' + names.join(', ') + '. ' : '') + 'Failed ' + failed + ': ' + lastErr + ' Data is still on the phone.')
        : ('✓ Uploaded ' + names.join(', ') + ' to Google Drive.');
      toast(msg, failed ? 6000 : 3000);
    });
  }
  function testUpload() {
    if (!S.settings.url) return toast('Add the upload link first.');
    toast('Testing…', 5000);
    post({ action: 'ping', key: S.settings.key }).then(function (j) { toast('Connected: ' + (j.owner || 'Drive script') + '.', 3500); })
      .catch(function (e) { toast('Not connected: ' + e.message, 4500); });
  }
  window.addEventListener('online', function () { if (S.view === 'home') render(); if (S.settings.autoUpload && S.settings.url) setTimeout(function () { uploadAll(); }, 1500); });
  window.addEventListener('offline', function () { if (S.view !== 'edit') render(); else { var n = document.querySelector('.net'); if (n) n.textContent = 'Offline'; } });

  /* ---------------- backup ---------------- */
  function backup() {
    saveCurrent().then(function () {
      var data = JSON.stringify({ app: 'plinth', version: VERSION, exported: new Date().toISOString(), buildings: S.buildings }, null, 1);
      var file = new File([data], 'plinth-backup-' + today() + '.json', { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'Plinth backup' }).catch(function () {});
      else { var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
    });
  }
  $('#restoreInput').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    f.text().then(function (t) {
      var j = JSON.parse(t), n = 0;
      if (!j || !Array.isArray(j.buildings) || j.app !== 'plinth') throw new Error();
      var ps = j.buildings.map(function (b) {
        if (S.buildings.some(function (x) { return x.id === b.id; })) return null;
        n++; if (S.projects.indexOf(b.project) < 0) S.projects.push(b.project);
        b.photos = []; b.dirty = true;
        S.buildings.push(b); return db.put('buildings', b);
      });
      return Promise.all(ps).then(saveSettings).then(function () { render(); toast('Restored ' + n + ' building(s).'); });
    }).catch(function () { toast('That file is not a Plinth backup.'); });
  });

  /* ---------------- install ---------------- */
  var deferredPrompt = null;
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; if (S.view === 'home') keepScroll(render); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; toast('Plinth installed. Open it from your home screen.', 3500); if (S.view === 'home') keepScroll(render); });
  function installCard() {
    if (standalone() || S.hideInstall) return '';
    if (deferredPrompt) return '<div class="card installcard"><div><b>Install Plinth on this phone</b><div class="muted small">Opens full screen and works without signal.</div></div><button class="btn" data-act="install">Install</button></div>';
    return '<div class="card installcard"><div><b>Install Plinth on this phone</b><div class="muted small">In Chrome: tap ⋮ (top right) → Add to home screen → Install.</div></div><button class="x" data-act="hideInstall" aria-label="Hide">Hide</button></div>';
  }
  function doInstall() {
    if (!deferredPrompt) return toast('In Chrome: tap ⋮ → Add to home screen → Install.', 4000);
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; keepScroll(render); });
  }

  /* ---------------- start ---------------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded || S.view === 'edit') return; reloaded = true; toast('App update ready. It will be used next time you open the app.', 3500);
    });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  loadSettings().then(function () { return db.get('kv', 'hideInstall').then(function (v) { S.hideInstall = !!v; }); }).then(loadBuildings).then(function () {
    render();
    if (navigator.onLine && S.settings.autoUpload && S.settings.url && S.buildings.some(function (b) { return b.dirty; })) setTimeout(uploadAll, 2500);
  }).catch(function (e) { $('#app').innerHTML = '<div class="wrap"><div class="banner">Storage error: ' + esc(e && e.message) + '</div></div>'; });
})();
