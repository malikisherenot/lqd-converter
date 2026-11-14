var input = document.getElementById("file");
var status = document.getElementById("status");
var link = document.getElementById("download");
var url = null;

input.addEventListener("change", function () {
  var file = input.files[0];
  link.hidden = true;
  status.className = "";
  if (!file) return;

  file.arrayBuffer().then(function (buf) {
    try {
      var result = lqdToSlc(new Uint8Array(buf));
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(new Blob([result.slc], { type: "application/octet-stream" }));
      link.href = url;
      link.download = file.name.replace(/\.[^.]*$/, "") + ".slc";
      link.hidden = false;
      status.textContent = "Converted " + result.count + " inputs (" + result.tps + " TPS).";
    } catch (err) {
      status.className = "error";
      status.textContent = err.message;
    }
  });
});
