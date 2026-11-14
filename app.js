var input = document.getElementById("file");
var info = document.getElementById("status");
var link = document.getElementById("download");
var objectUrl = null;

input.addEventListener("change", async function () {
  var file = input.files[0];
  link.hidden = true;
  info.className = "";
  if (!file) return;

  var ext = (file.name.match(/\.([^.]*)$/) || [, ""])[1].toLowerCase();
  if (ext !== "lqd" && ext !== "slc") {
    info.className = "error";
    info.textContent = "Please choose a .lqd or .slc file.";
    input.value = "";
    return;
  }

  info.textContent = "Converting...";
  try {
    var bytes = new Uint8Array(await file.arrayBuffer());
    var toSlc = ext === "lqd";
    var result = toSlc ? await lqdToSlc(bytes) : await slcToLqd(bytes);
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
  } catch (err) {
    info.className = "error";
    info.textContent = err.message;
  }
  input.value = "";
});
