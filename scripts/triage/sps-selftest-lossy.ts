/**
 * Does SPS re-encode on ingest? Compare what SPS RECORDED at upload
 * (images.file_size) against what SPS actually SERVES (original_url
 * Content-Length). Both sides are SPS's own — no dependence on what the
 * photographer exported to any other destination.
 */
const ROWS: {name: string; size: number; url: string}[] = JSON.parse(process.argv[2]);
(async () => {
  let same = 0, smaller = 0, bigger = 0, err = 0;
  for (const r of ROWS) {
    try {
      const res = await fetch(r.url, { method: "HEAD" });
      const served = Number(res.headers.get("content-length"));
      const tag = served === r.size ? "same" : served < r.size ? "SMALLER" : "bigger";
      if (tag === "same") same++; else if (tag === "SMALLER") smaller++; else bigger++;
      console.log(`${tag.padEnd(8)} recorded ${String(r.size).padStart(9)}  served ${String(served).padStart(9)}  ${r.name}`);
    } catch { err++; }
  }
  console.log(`\nidentical: ${same}   served smaller: ${smaller}   served bigger: ${bigger}   errors: ${err}`);
})();
