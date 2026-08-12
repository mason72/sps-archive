(async () => {
  const { personNameFromParts } = await import("../../src/lib/gallery/stacks");
  for (const f of [
    "Paras Sharma_26-08-07_Island_621.jpg",
    "Paras Sharma_26-08-07_Island_619.jpg",
    "Sam Vinson_26-08-07_Island_1147.jpg",
    "Brandon Huff_26-08-07_Island_233.jpg",
  ]) {
    console.log(`${f}\n   parsed_name=null  ->  displays "${personNameFromParts(null, f)}"`);
  }
})();
