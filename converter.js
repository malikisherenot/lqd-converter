// the literal converter (⁠o⁠´⁠･⁠_⁠･⁠)⁠っ
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

    // this wasnt annoying 
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

  root.lqdToSlc = lqdToSlc;
  if (typeof module !== "undefined") module.exports = { lqdToSlc: lqdToSlc };
})(typeof window !== "undefined" ? window : globalThis);
