// Paste into the DevTools console on https://galleries.pixieset.com/collections while signed in.
// Switches bulk download ON for the 20 Jan-2015 pet sittings (photo_download 1, collection_download true),
// then reads every one back and prints the result. Originals (0/false) are in
// ~/pixieset-staging/pixieset-download-settings-backup.json; restore = the same PATCH with those values.
(async () => {
  const ids = ["861258","861303","861307","861327","861335","861344","861354","861359","861361","861367",
               "861380","861384","866308","866368","866448","866473","869256","869342","869380","869441"];
  const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [, ""])[1]);
  if (!xsrf) return console.error("no XSRF-TOKEN cookie — are you signed in?");
  const h = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", "X-XSRF-TOKEN": xsrf };
  let ok = 0; const failed = [];
  for (const id of ids) {
    const r = await fetch(`/api/v1/collections/${id}/update_download_settings`, {
      method: "PATCH", credentials: "include", headers: h,
      body: JSON.stringify({ id: Number(id), photo_download: 1, collection_download: true }),
    });
    r.ok ? ok++ : failed.push(`${id}:${r.status}`);
    await new Promise((s) => setTimeout(s, 150));
  }
  const after = {};
  for (const id of ids) {
    const g = await fetch(`/api/v1/collections/${id}`, { headers: { "X-Requested-With": "XMLHttpRequest" }, credentials: "include" });
    const j = await g.json().catch(() => null); const c = (j?.data ?? j) || {};
    after[c.url_key || id] = `${c.photo_download}/${c.collection_download}`;
    await new Promise((s) => setTimeout(s, 100));
  }
  console.log(`patched ${ok}/${ids.length}`, failed.length ? `FAILED: ${failed.join(" ")}` : "", "\nread back (photo_download/collection_download):", after);
})();
