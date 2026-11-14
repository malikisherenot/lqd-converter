(function (root) {
  var HEADER = [0x53, 0x4C, 0x43, 0x33, 0x52, 0x50, 0x4C, 0x59];
  var FOOTER = 0xCC;

  function parseLqd(bytes) {
    if (bytes.length < 2 || bytes[0] !== 0x4C) {
      throw new Error("Not a .lqd file (missing 'L' magic byte).");
    }
    var flags = bytes[1];
    var version = flags >> 1;
    if (version !== 1) throw new Error("Unsupported .lqd version " + version + " (only version 1).");

    var pos = 2;
    function varint() {
      var result = 0, mul = 1, b;
      do {
        if (pos >= bytes.length) return null;
        b = bytes[pos++];
        result += (b & 0x7F) * mul;
        mul *= 128;
      } while (b & 0x80);
      return result;
    }

    var tps = 240;
    if (flags & 1) {
      var t = varint();
      if (!t) throw new Error("Invalid TPS in .lqd header.");
      tps = t;
    }

    var actions = [];
    var held = [false, false];
    var frame = 0;

    function add(button, holding, p2) {
      actions.push({ frame: frame, button: button, holding: holding, p2: p2 });
    }
    function flip(p) {
      held[p] = !held[p];
      add(1, held[p], p === 1);
    }

    while (pos < bytes.length) {
      var v = varint();
      if (v === null) break;
      frame += Math.floor(v / 4);
      var code = v % 4;
      if (code === 0) flip(0);
      else if (code === 1) flip(1);
      else if (code === 2) { flip(0); flip(1); }
      else {
        if (pos >= bytes.length) break;
        var e = bytes[pos++];
        var press = (e & 1) === 1;
        var p2 = ((e >> 1) & 1) === 1;
        var button = (e >> 2) & 3;
        if (button === 0) continue;
        if (button === 1) held[p2 ? 1 : 0] = press;
        add(button, press, p2);
      }
    }
    return { tps: tps, actions: actions };
  }

  function pushLE(arr, value, n) {
    for (var i = 0; i < n; i++) {
      arr.push(value % 256);
      value = Math.floor(value / 256);
    }
  }

  function deltaSizeFor(delta) {
    if (delta < 16) return 0;
    if (delta < 4096) return 1;
    if (delta < 268435456) return 2;
    return 3;
  }

  function buildActionAtomData(actions) {
    var out = [];
    pushLE(out, actions.length, 8);

    var n = actions.length, prev = 0;
    var deltas = new Array(n), sizes = new Array(n);
    for (var i = 0; i < n; i++) {
      deltas[i] = actions[i].frame - prev;
      prev = actions[i].frame;
      sizes[i] = deltaSizeFor(deltas[i]);
    }

    i = 0;
    while (i < n) {
      var run = 1;
      while (i + run < n && sizes[i + run] === sizes[i] && run < 32768) run++;
      var count = 1, exp = 0;
      while (count * 2 <= run) { count *= 2; exp++; }

      pushLE(out, (exp << 8) | (sizes[i] << 12), 2);
      var byteSize = 1 << sizes[i];
      for (var j = i; j < i + count; j++) {
        var a = actions[j];
        var state = deltas[j] * 16 + a.button * 4 + (a.p2 ? 2 : 0) + (a.holding ? 1 : 0);
        pushLE(out, state, byteSize);
      }
      i += count;
    }
    return out;
  }

  function buildSlc(tps, actions) {
    var out = HEADER.slice();
    pushLE(out, 64, 2);

    var dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, tps, true);
    for (var k = 0; k < 8; k++) out.push(dv.getUint8(k));
    pushLE(out, 0, 8);
    pushLE(out, 2, 4);
    pushLE(out, 0, 4);
    pushLE(out, 0, 4);
    for (k = 0; k < 36; k++) out.push(0);

    var data = buildActionAtomData(actions);
    pushLE(out, 1, 4);
    pushLE(out, data.length, 8);
    for (k = 0; k < data.length; k++) out.push(data[k]);

    out.push(FOOTER);
    return new Uint8Array(out);
  }

  function lqdToSlc(bytes) {
    var lqd = parseLqd(bytes);
    return { slc: buildSlc(lqd.tps, lqd.actions), tps: lqd.tps, count: lqd.actions.length };
  }


  function readActionAtom(bytes, p, stop) {
    function u(pos, n) {
      var v = 0, mul = 1;
      for (var i = 0; i < n; i++) { v += bytes[pos + i] * mul; mul *= 256; }
      return v;
    }
    function need(n) {
      if (p + n > stop) throw new Error("Action atom is truncated or corrupted.");
    }

    need(8);
    var count = u(p, 8);
    p += 8;

    var acts = [], last = 0;
    function add(button, holding, p2) {
      acts.push({ frame: last, button: button, holding: holding, p2: p2 });
    }
    function emit(st) {
      var low = st % 16;
      last += Math.floor(st / 16);
      var button = (low >> 2) & 3, p2 = ((low >> 1) & 1) === 1;
      if (button === 0) { add(1, true, p2); add(1, false, p2); }
      else add(button, (low & 1) === 1, p2);
    }

    while (acts.length < count && p < stop) {
      need(2);
      var h = u(p, 2);
      p += 2;
      var id = h >> 14;

      if (id === 0 || id === 1) {
        var bs = 1 << ((h >> 12) & 3);
        var len = 1 << ((h >> 8) & 15);
        need(len * bs);
        if (id === 0) {
          for (var i = 0; i < len; i++) { emit(u(p, bs)); p += bs; }
        } else {
          var reps = 1 << ((h >> 3) & 31);
          var states = [];
          for (i = 0; i < len; i++) { states.push(u(p, bs)); p += bs; }
          for (var r = 0; r < reps; r++) {
            for (i = 0; i < states.length; i++) emit(states[i]);
          }
        }
      } else if (id === 2) {
        var type = (h >> 10) & 15;
        var sbs = 1 << ((h >> 8) & 3);
        need(sbs);
        last += u(p, sbs);
        p += sbs;
        if (type <= 3) { need(8); p += 8; }
        add(0, false, false);
      } else {
        throw new Error("Unknown section type in .slc file.");
      }
    }
    return acts;
  }

  function parseSlc(bytes) {
    if (bytes.length < 11) throw new Error("File is too small to be an .slc file.");
    for (var i = 0; i < 8; i++) {
      if (bytes[i] !== HEADER[i]) throw new Error("Not an slc v3 file (missing SLC3RPLY header).");
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint16(8, true) !== 64) throw new Error("Unsupported slc metadata size.");
    var tps = dv.getFloat64(10, true);
    var end = bytes.length - 1;
    if (bytes[end] !== FOOTER) throw new Error("Invalid slc footer (file may be truncated).");

    var p = 74, actions = null;
    while (p + 12 <= end) {
      var id = dv.getUint32(p, true);
      var lo = dv.getUint32(p + 4, true);
      var hi = dv.getUint32(p + 8, true) & 0xFFFFFF;
      p += 12;
      var size = hi * 4294967296 + lo;
      if (p + size > end) throw new Error("Atom size exceeds file size.");
      if (id === 1 && !actions) actions = readActionAtom(bytes, p, p + size);
      p += size;
    }
    if (!actions) throw new Error("No action atom found in .slc file.");
    return { tps: tps, actions: actions };
  }

  function pushVarint(arr, v) {
    while (v >= 128) {
      arr.push((v % 128) + 128);
      v = Math.floor(v / 128);
    }
    arr.push(v);
  }

  function buildLqd(tps, all) {
    var actions = all.filter(function (a) { return a.button > 0; });
    var skipped = all.length - actions.length;

    var tpsInt = Math.round(tps);
    var custom = tpsInt !== 240 && tpsInt > 0;
    var out = [0x4C, (1 << 1) | (custom ? 1 : 0)];
    if (custom) pushVarint(out, tpsInt);

    var held = [false, false], prev = 0, i = 0, n = actions.length;
    function ev(frame, code) {
      pushVarint(out, Math.max(0, frame - prev) * 4 + code);
      prev = Math.max(prev, frame);
    }

    while (i < n) {
      var a = actions[i], p = a.p2 ? 1 : 0;
      if (a.button === 1 && a.holding !== held[p]) {
        var b = actions[i + 1];
        if (p === 0 && b && b.button === 1 && b.p2 && b.frame === a.frame && b.holding !== held[1]) {
          ev(a.frame, 2);
          held[0] = a.holding;
          held[1] = b.holding;
          i += 2;
          continue;
        }
        ev(a.frame, p);
        held[p] = a.holding;
        i++;
        continue;
      }
      ev(a.frame, 3);
      out.push((a.button << 2) | (a.p2 ? 2 : 0) | (a.holding ? 1 : 0));
      if (a.button === 1) held[p] = a.holding;
      i++;
    }
    return { lqd: new Uint8Array(out), skipped: skipped, count: n };
  }

  function slcToLqd(bytes) {
    var slc = parseSlc(bytes);
    var r = buildLqd(slc.tps, slc.actions);
    return { lqd: r.lqd, tps: Math.round(slc.tps), count: r.count, skipped: r.skipped };
  }

  root.lqdToSlc = lqdToSlc;
  root.slcToLqd = slcToLqd;
  if (typeof module !== "undefined") {
    module.exports = { lqdToSlc: lqdToSlc, slcToLqd: slcToLqd, parseSlc: parseSlc, parseLqd: parseLqd };
  }
})(typeof window !== "undefined" ? window : globalThis);
