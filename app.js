var input = document.getElementById("file");
var info = document.getElementById("status");
var link = document.getElementById("download");
var logBox = document.getElementById("log");
var objectUrl = null;

function log(message) {
  var line = document.createElement("div");
  line.textContent = new Date().toLocaleTimeString() + "  " + message;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

window.addEventListener("error", function (e) {
  log("ERROR: " + e.message);
});
window.addEventListener("unhandledrejection", function (e) {
  log("ERROR: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

log("Ready (build 4)");

input.addEventListener("change", async function () {
  var file = input.files[0];
  link.hidden = true;
  info.className = "";
  if (!file) return;

  log("Selected " + file.name + " (" + file.size + " bytes)");
  var ext = (file.name.match(/\.([^.]*)$/) || [, ""])[1].toLowerCase();
  if (ext !== "lqd" && ext !== "slc") {
    info.className = "error";
    info.textContent = "Please choose a .lqd or .slc file.";
    log("ERROR: unsupported extension");
    input.value = "";
    return;
  }

  info.textContent = "Converting...";
  var started = Date.now();
  try {
    log("Reading file");
    var bytes = new Uint8Array(await file.arrayBuffer());
    var toSlc = ext === "lqd";
    log("Converting ." + ext + " to ." + (toSlc ? "slc" : "lqd"));
    var result = toSlc ? await lqdToSlc(bytes, log) : await slcToLqd(bytes, log);
    var out = toSlc ? result.slc : result.lqd;
    var outExt = toSlc ? "slc" : "lqd";

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(new Blob([out], { type: "application/octet-stream" }));
    link.href = objectUrl;
    link.download = file.name.replace(/\.[^.]*$/, "") + "." + outExt;
    link.textContent = "Download ." + outExt;
    link.hidden = false;

    var msg = "Converted " + result.count + " inputs (" + result.tps + " TPS).";
    if (result.skipped) msg += " Skipped " + result.skipped + " non-input actions.";
    info.textContent = msg;
    log("Done in " + (Date.now() - started) + " ms");
  } catch (err) {
    info.className = "error";
    info.textContent = err.message;
    log("ERROR: " + err.message);
  }
  input.value = "";
});
