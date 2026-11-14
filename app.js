var input = document.getElementById("file");
var info = document.getElementById("info");
var link = document.getElementById("download");
var url = null;

input.addEventListener("change", function () {
  var file = input.files[0];
  link.hidden = true;
  info.className = "";
  if (!file) return;

  var ext = (file.name.match(/\.([^.]*)$/) || [, ""])[1].toLowerCase();
  if (ext !== "lqd" && ext !== "slc") {
    info.className = "error";
    info.textContent = "Please choose a .lqd or .slc file.";
    return;
  }

  file.arrayBuffer().then(function (buf) {
    try {
      var bytes = new Uint8Array(buf);
      var toSlc = ext === "lqd";
      var result = toSlc ? lqdToSlc(bytes) : slcToLqd(bytes);
      var out = toSlc ? result.slc : result.lqd;
      var outExt = toSlc ? "slc" : "lqd";

      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(new Blob([out], { type: "application/octet-stream" }));
      link.href = url;
      link.download = file.name.replace(/\.[^.]*$/, "") + "." + outExt;
      link.textContent = "Download ." + outExt;
      link.hidden = false;

      var msg = "Converted " + result.count + " inputs (" + result.tps + " TPS).";
      if (result.skipped) msg += " Skipped " + result.skipped + " non-input actions (restart/death/TPS/bugpoint).";
      info.textContent = msg;
    } catch (err) {
      info.className = "error";
      info.textContent = err.message;
    }
  });
});
