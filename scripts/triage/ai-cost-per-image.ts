/**
 * Measured AI indexing cost per image, from usage_events — no new spend.
 * Answers the Pixieset plan's open question #2 ("AI indexing cost at 1.88M
 * images — unmeasured, dominant one-time cost") with the archive's own history.
 *
 * Prices come from costs.ts, which CLAUDE.md makes the single home for $/unit.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
async function main(){
  const {createClient}=await import("@supabase/supabase-js");
  const {KIND_UNIT_COST}=await import("../../src/lib/usage/costs");
  const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const rows:any[]=[];
  for(let off=0; ; off+=1000){
    const {data,error}=await s.from("usage_events").select("kind, quantity, created_at").range(off,off+999);
    if(error) throw error;
    rows.push(...(data??[])); if(!data||data.length<1000) break;
  }
  const byKind=new Map<string,{units:number,events:number}>();
  for(const r of rows){
    const c=byKind.get(r.kind)??{units:0,events:0};
    c.units+=Number(r.quantity)||0; c.events++;
    byKind.set(r.kind,c);
  }
  console.log("usage_events by kind:");
  let aiCost=0, aiSeconds=0;
  for(const [kind,c] of [...byKind.entries()].sort()){
    const unit=(KIND_UNIT_COST as any)[kind] ?? 0;
    const cost=c.units*unit;
    if(kind==="ai_index"){ aiCost=cost; aiSeconds=c.units; }
    console.log(`  ${kind.padEnd(18)} ${String(c.events).padStart(6)} events  ${c.units.toFixed(1).padStart(12)} units  $${cost.toFixed(2)}`);
  }

  const {count:indexed}=await s.from("images").select("id",{count:"exact",head:true}).not("ai_indexed_at","is",null);
  console.log(`\nimages carrying an AI index: ${indexed}`);
  if(indexed && aiSeconds){
    const perImage=aiCost/indexed;
    console.log(`ai_index: ${aiSeconds.toFixed(0)}s billed = $${aiCost.toFixed(2)} over ${indexed} images`);
    console.log(`  => $${perImage.toFixed(6)}/image  (${(aiSeconds/indexed).toFixed(3)}s each)`);
    for(const n of [949_000, 1_880_000]){
      console.log(`  => ${n.toLocaleString()} images: $${(perImage*n).toFixed(0)}  (${((aiSeconds/indexed)*n/3600).toFixed(0)} GPU-hours)`);
    }
  }
}
main().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
