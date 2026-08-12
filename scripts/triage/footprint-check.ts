import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
async function main(){
  const {createServiceClient}=await import("../../src/lib/supabase/server");
  const {getDatabaseFootprint}=await import("../../src/lib/usage/database");
  const f=await getDatabaseFootprint(createServiceClient());
  if(!f){ console.log("returned null"); return; }
  console.log({
    searchIndex: (f.vectorIndexBytes/1e6).toFixed(1)+" MB",
    perPhoto: Math.round(f.indexBytesPerPhoto)+" B",
    tier: `${f.tier.name} (${f.tier.ramGb} GB, $${f.tier.monthly}/mo, $${f.computeMonthlyNet} after credit)`,
    nextTier: f.nextTier? `${f.nextTier.name} $${f.nextTier.monthly}/mo` : null,
    photoHeadroom: f.photoHeadroom?.toLocaleString(),
    database: (f.dbBytes/1e9).toFixed(2)+" GB",
    diskMonthly: "$"+f.diskMonthly.toFixed(2),
    photosIndexed: f.photosIndexed.toLocaleString(),
    last30d: f.photosLast30d.toLocaleString(),
  });
  // Sanity: does the headroom claim survive arithmetic?
  const budget = f.tier.ramGb*1e9*0.6;
  console.log(`check: index ${(f.vectorIndexBytes/1e6).toFixed(0)}MB of ${(budget/1e6).toFixed(0)}MB budget = ${(100*f.vectorIndexBytes/budget).toFixed(1)}% used`);
}
main();
