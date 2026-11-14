(function (root) {
  var HEADER = [0x53, 0x4C, 0x43, 0x33, 0x52, 0x50, 0x4C, 0x59];
  var FOOTER = 0xCC;
  var STEP = 20000;

  function yieldUI() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function pushLE(arr, value, n) {
    for (var i = 0; i < n; i++) {
      arr.push(value % 256);
      value = Math.floor(value / 256);
    }
  }

  function pushVarint(arr, v) {
    while (v >= 128) {
      arr.push((v % 128) + 128);
      v = Math.floor(v / 128);
    }
    arr.push(v);
  }

  async function parseLqd(bytes, log) {
    log("Reading .lqd header");
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
    log("Format version 1, " + tps + " TPS");

    var actions = [];
    var held = [false, false];
    var frame = 0;
    var events = 0;

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
      if (++events % STEP === 0) {
        log("Parsed " + actions.length + " inputs (" + Math.round(pos / bytes.length * 100) + "%)");
        await yieldUI();
      }
    }
    log("Parsed " + actions.length + " inputs, last frame " + frame);
    return { tps: tps, actions: actions };
  }

  function deltaSizeFor(delta) {
    if (delta < 16) return 0;
    if (delta < 4096) return 1;
    if (delta < 268435456) return 2;
    return 3;
  }

  async function buildActionAtomData(actions, log) {
    var out = [];
    pushLE(out, actions.length, 8);

    var n = actions.length, prev = 0;
    var deltas = new Array(n), sizes = new Array(n);
    for (var i = 0; i < n; i++) {
      deltas[i] = actions[i].frame - prev;
      prev = actions[i].frame;
      sizes[i] = deltaSizeFor(deltas[i]);
    }

    var sections = 0, ticks = 0;
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
      sections++;
      ticks += count;
      if (ticks >= STEP) {
        ticks = 0;
        log("Writing inputs (" + Math.round(i / n * 100) + "%)");
        await yieldUI();
      }
    }
    log("Wrote " + sections + " sections");
    return out;
  }

  async function buildSlc(tps, actions, log) {
    log("Writing .slc v3 header");
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

    var data = await buildActionAtomData(actions, log);
    pushLE(out, 1, 4);
    pushLE(out, data.length, 8);
    for (k = 0; k < data.length; k++) out.push(data[k]);

    out.push(FOOTER);
    log("Finished, " + out.length + " bytes");
    return new Uint8Array(out);
  }

  async function lqdToSlc(bytes, log) {
    log = log || function () {};
    var lqd = await parseLqd(bytes, log);
    var slc = await buildSlc(lqd.tps, lqd.actions, log);
    return { slc: slc, tps: lqd.tps, count: lqd.actions.length };
  }

  async function readActionAtom(bytes, p, stop, log) {
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
    var start = p;
    log("Action atom declares " + count + " inputs");

    var acts = [], last = 0, ticks = 0;
    var kinds = { input: 0, repeat: 0, special: 0 };
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
    async function progress() {
      if (++ticks % STEP === 0) {
        log("Decoded " + acts.length + " / " + count + " inputs (" + Math.round((p - start) / Math.max(1, stop - start) * 100) + "%)");
        await yieldUI();
      }
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
          kinds.input++;
          for (var i = 0; i < len; i++) { emit(u(p, bs)); p += bs; await progress(); }
        } else {
          kinds.repeat++;
          var reps = Math.pow(2, (h >> 3) & 31);
          var states = [];
          for (i = 0; i < len; i++) { states.push(u(p, bs)); p += bs; }
          for (var r = 0; r < reps && acts.length < count; r++) {
            for (i = 0; i < states.length && acts.length < count; i++) { emit(states[i]); await progress(); }
          }
        }
      } else if (id === 2) {
        kinds.special++;
        var type = (h >> 10) & 15;
        var sbs = 1 << ((h >> 8) & 3);
        need(sbs);
        last += u(p, sbs);
        p += sbs;
        if (type <= 3) { need(8); p += 8; }
        add(0, false, false);
        await progress();
      } else {
        throw new Error("Unknown section type in .slc file.");
      }
    }
    log("Sections: " + kinds.input + " input, " + kinds.repeat + " repeat, " + kinds.special + " special");
    if (acts.length < count) log("Warning: file ended with " + acts.length + " of " + count + " inputs");
    return acts;
  }

  async function parseSlcV3(bytes, log) {
    log("Detected slc v3");
    if (bytes.length < 11) throw new Error("File is too small to be an .slc file.");
    for (var i = 0; i < 8; i++) {
      if (bytes[i] !== HEADER[i]) throw new Error("Not a valid .slc file (unknown header).");
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint16(8, true) !== 64) throw new Error("Unsupported slc metadata size.");
    var tps = dv.getFloat64(10, true);
    log("Metadata read, " + tps + " TPS");
    var end = bytes.length - 1;
    if (bytes[end] !== FOOTER) throw new Error("Invalid slc footer (file may be truncated).");

    var p = 74, actions = null;
    while (p + 12 <= end) {
      var id = dv.getUint32(p, true);
      var lo = dv.getUint32(p + 4, true);
      var hi = dv.getUint32(p + 8, true) & 0xFFFFFF;
      p += 12;
      var size = hi * 4294967296 + lo;
      log("Atom id " + id + ", " + size + " bytes");
      if (p + size > end) throw new Error("Atom size exceeds file size.");
      if (id === 1 && !actions) actions = await readActionAtom(bytes, p, p + size, log);
      p += size;
    }
    if (!actions) throw new Error("No action atom found in .slc file.");
    return { tps: tps, actions: actions };
  }

  async function parseSlcV2(bytes, log) {
    log("Detected slc v2");
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var n = bytes.length, p = 4;
    function u(pos, len) {
      if (pos + len > n) throw new Error("slc v2 file is truncated or corrupted.");
      var v = 0, mul = 1;
      for (var i = 0; i < len; i++) { v += bytes[pos + i] * mul; mul *= 256; }
      return v;
    }
    if (n < 35) throw new Error("File is too small to be an .slc file.");
    var tps = dv.getFloat64(p, true);
    p += 8;
    var metaSize = u(p, 8);
    p += 8 + metaSize;
    var length = u(p, 8);
    p += 8;
    var blobCount = u(p, 8);
    p += 8;
    log("Metadata read, " + tps + " TPS, " + length + " inputs, " + blobCount + " blobs");
    var blobs = [];
    for (var i = 0; i < blobCount; i++) {
      blobs.push({ size: u(p, 8), len: u(p + 16, 8) });
      p += 24;
    }
    var acts = [], frame = 0, ticks = 0;
    for (i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      if (b.size < 1 || b.size > 8) throw new Error("Invalid blob size in .slc v2 file.");
      for (var j = 0; j < b.len; j++) {
        var st = u(p, b.size);
        p += b.size;
        var low = st % 32;
        frame += Math.floor(st / 32);
        var button = (low >> 2) & 7;
        if (button === 7) {
          if (p + 8 > n) throw new Error("slc v2 file is truncated or corrupted.");
          p += 8;
        }
        if (button >= 1 && button <= 3) {
          acts.push({ frame: frame, button: button, holding: (low & 1) === 1, p2: ((low >> 1) & 1) === 1 });
        } else if (button !== 0) {
          acts.push({ frame: frame, button: 0, holding: false, p2: false });
        }
        if (++ticks % STEP === 0) {
          log("Decoded " + acts.length + " inputs (" + Math.round(p / n * 100) + "%)");
          await yieldUI();
        }
      }
    }
    return { tps: tps, actions: acts };
  }

  async function parseSlc(bytes, log) {
    if (bytes.length >= 4 && bytes[0] === 0x53 && bytes[1] === 0x49 && bytes[2] === 0x4C && bytes[3] === 0x4C) {
      return parseSlcV2(bytes, log);
    }
    return parseSlcV3(bytes, log);
  }

  async function buildLqd(tps, all, log) {
    var actions = all.filter(function (a) { return a.button > 0; });
    var skipped = all.length - actions.length;
    log("Decoded " + all.length + " actions, " + skipped + " are not player inputs");

    var tpsInt = Math.round(tps);
    var custom = tpsInt !== 240 && tpsInt > 0;
    var out = [0x4C, (1 << 1) | (custom ? 1 : 0)];
    if (custom) pushVarint(out, tpsInt);
    log("Writing .lqd header, " + (custom ? tpsInt : 240) + " TPS");

    var held = [false, false], prev = 0, i = 0, n = actions.length, ticks = 0;
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
        } else {
          ev(a.frame, p);
          held[p] = a.holding;
          i++;
        }
      } else {
        ev(a.frame, 3);
        out.push((a.button << 2) | (a.p2 ? 2 : 0) | (a.holding ? 1 : 0));
        if (a.button === 1) held[p] = a.holding;
        i++;
      }
      if (++ticks % STEP === 0) {
        log("Writing events (" + Math.round(i / n * 100) + "%)");
        await yieldUI();
      }
    }
    log("Finished, " + out.length + " bytes");
    return { lqd: new Uint8Array(out), skipped: skipped, count: n };
  }

  async function slcToLqd(bytes, log) {
    log = log || function () {};
    var slc = await parseSlc(bytes, log);
    var r = await buildLqd(slc.tps, slc.actions, log);
    return { lqd: r.lqd, tps: Math.round(slc.tps), count: r.count, skipped: r.skipped };
  }

  root.lqdToSlc = lqdToSlc;
  root.slcToLqd = slcToLqd;
  if (typeof module !== "undefined") {
    module.exports = { lqdToSlc: lqdToSlc, slcToLqd: slcToLqd, parseSlc: parseSlc, parseLqd: parseLqd };
  }
})(typeof window !== "undefined" ? window : globalThis);
