/* Plinth — Hassan Index calculations. Author: Md. Farhad Momin.
   Hassan Index calculations — shared by the app (browser) and tests (Node).
   Definitions: Hassan & Sozen (1997); Pujol et al. (2024).
   All internal lengths in metres, areas in m². Indices in percent. */
(function (root) {
  'use strict';

  var LEN = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
  var AREA = { m2: 1, sft: 0.09290304 };

  var REF = { PI: 0.25, WI_LOW: 0.10, WI_HIGH: 0.20, MASONRY: 0.1 };

  function num(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }
  function len(v, unit) { var n = num(v); return isNaN(n) ? NaN : n * (LEN[unit] || 1); }
  function area(v, unit) { var n = num(v); return isNaN(n) ? NaN : n * (AREA[unit] || 1); }
  function ok(n) { return typeof n === 'number' && isFinite(n) && n > 0; }

  function floorArea(b) {
    var Ap = area(b.Ap, b.ApUnit);
    var extra = area(b.extraArea, b.ApUnit);
    if (!ok(extra)) extra = 0;
    var Aft = NaN, floors = NaN;
    if (b.floorMode === 'groups') {
      var s = 0, f = 0, any = false;
      (b.floorGroups || []).forEach(function (g) {
        var n = num(g.n), a = area(g.area, b.ApUnit);
        if (ok(n) && ok(a)) { s += n * a; f += n; any = true; }
      });
      if (any) { Aft = s + extra; floors = f; }
    } else {
      var N = num(b.N);
      if (ok(N) && ok(Ap)) { Aft = N * Ap + extra; floors = N; }
    }
    return { Ap: Ap, Aft: Aft, floors: floors, extra: extra };
  }

  function columnArea(b, plasterMm) {
    var ded = (num(plasterMm) || 0) / 1000;
    var total = 0, count = 0, bad = 0;
    (b.columns || []).forEach(function (c) {
      var q = num(c.qty), w = len(c.b, c.unit), d = len(c.d, c.unit);
      if (!(ok(q) && ok(w) && ok(d))) { bad++; return; }
      if (c.plaster === 'yes') { w = Math.max(0, w - 2 * ded); d = Math.max(0, d - 2 * ded); }
      total += q * w * d; count += q;
    });
    return { Acol: total, count: count, incomplete: bad };
  }

  // Wall areas by direction. caseB: uncertain walls take their caseB class.
  function wallAreas(b, caseB) {
    var r = { X: { rc: 0, mas: 0 }, Y: { rc: 0, mas: 0 }, incomplete: 0, uncertain: 0, noDir: 0 };
    (b.walls || []).forEach(function (w) {
      var q = num(w.qty), L = len(w.L, w.Lunit), t = len(w.t, w.tunit);
      if (!(ok(q) && ok(L) && ok(t))) { r.incomplete++; return; }
      var a = q * L * t, type = w.type;
      if (type === 'uncertain') { r.uncertain++; type = caseB ? (w.caseB || 'exclude') : 'exclude'; }
      if (w.dir !== 'X' && w.dir !== 'Y') { r.noDir++; return; }
      if (type === 'rc') r[w.dir].rc += a;
      else if (type === 'masonry') r[w.dir].mas += a;
    });
    r.X.eff = r.X.rc + REF.MASONRY * r.X.mas;
    r.Y.eff = r.Y.rc + REF.MASONRY * r.Y.mas;
    return r;
  }

  function indices(b, opts) {
    opts = opts || {};
    var fa = floorArea(b), ca = columnArea(b, opts.plasterMm), out = { fa: fa, ca: ca };
    function pct(x, d) { return ok(d) ? x / d * 100 : NaN; }
    [['A', false], ['B', true]].forEach(function (cs) {
      var w = wallAreas(b, cs[1]);
      var CI = ok(fa.Aft) && ca.Acol > 0 ? 0.5 * ca.Acol / fa.Aft * 100 : NaN;
      var WIX = pct(w.X.eff, fa.Aft), WIY = pct(w.Y.eff, fa.Aft);
      var WImin = (isNaN(WIX) || isNaN(WIY)) ? NaN : Math.min(WIX, WIY);
      out[cs[0]] = {
        walls: w, CI: CI, WIX: WIX, WIY: WIY, WImin: WImin,
        dir: isNaN(WImin) ? '' : (WIX < WIY ? 'X' : (WIY < WIX ? 'Y' : 'Equal')),
        PI: (isNaN(CI) || isNaN(WImin)) ? NaN : CI + WImin,
        CD: pct(ca.Acol, fa.Ap), WDX: pct(w.X.eff, fa.Ap), WDY: pct(w.Y.eff, fa.Ap)
      };
    });
    var A = out.A, B = out.B;
    function flags(r) { return [r.PI < REF.PI, r.WImin < REF.WI_LOW, r.WImin < REF.WI_HIGH].join(); }
    out.sensitive = !isNaN(A.PI) && !isNaN(B.PI) && flags(A) !== flags(B);
    out.warnings = warnings(b, out);
    return out;
  }

  function warnings(b, r) {
    var w = [], fa = r.fa, ca = r.ca, A = r.A;
    if (!String(b.code || '').trim()) w.push('Building code is missing.');
    if (!ok(fa.Ap)) w.push('Typical floor area is missing.');
    if (b.floorMode !== 'groups' && !ok(num(b.N))) w.push('Number of elevated slabs (N) is missing.');
    if (b.floorMode === 'groups' && ok(num(b.N)) && ok(fa.floors) && num(b.N) !== fa.floors)
      w.push('N = ' + num(b.N) + ' but floor groups add up to ' + fa.floors + ' floors.');
    if (ca.count === 0) w.push('No columns entered.');
    if (ca.incomplete) w.push(ca.incomplete + ' column row(s) are incomplete.');
    var stated = num(b.statedColumns);
    if (ok(stated) && ca.count !== stated)
      w.push(stated + ' columns stated, but ' + ca.count + ' entered.');
    if ((b.columns || []).some(function (c) { return !c.plaster; }))
      w.push('Say for every column row whether the size was taken over plaster.');
    var wa = A.walls;
    if (wa.incomplete) w.push(wa.incomplete + ' wall row(s) are incomplete.');
    if (wa.noDir) w.push(wa.noDir + ' wall row(s) have no X/Y direction; they are not counted.');
    if ((b.walls || []).some(function (x) { return x.type === 'uncertain' && !x.caseB; }))
      w.push('Give a Case B classification for each uncertain wall.');
    if (!(b.walls || []).length) w.push('No walls entered. If there are none, say so in Notes.');
    else if (wa.X.eff === 0 || wa.Y.eff === 0) w.push('No wall area in the ' + (wa.X.eff === 0 ? 'X' : 'Y') + ' direction. Check directions.');
    var ck = b.checks || {};
    if (ck.transfer === 'yes') w.push('Transfer floor or floating columns above: refer to supervisor.');
    if (ck.weaker === 'yes') w.push('A weaker storey above ground is likely: outside valid scope.');
    if (ck.permission !== 'yes') w.push('Permission not confirmed.');
    if (!(b.photos || []).some(function (p) { return p.label === 'Plan sketch'; }))
      w.push('No plan sketch photo.');
    return w;
  }

  var api = { LEN: LEN, AREA: AREA, REF: REF, len: len, area: area, num: num, floorArea: floorArea,
    columnArea: columnArea, wallAreas: wallAreas, indices: indices };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HCalc = api;
})(this);
