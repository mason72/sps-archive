/**
 * Prove the new all_rows count equals the count the dashboard used to show,
 * for EVERY event — the old embedded aggregate vs the new one, computed from
 * two independent code paths. Two readers of one table are two bases; if they
 * disagree, the card's number changed meaning and that must not ship silently.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
async function main(){
  const {createClient}=await import("@supabase/supabase-js");
  const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const t0=Date.now();
  const {data:oldWay,error:oldErr}=await s
    .from("events")
    .select("id, name, images!images_event_id_fkey(count)",{count:"exact"})
    .eq("user_id","d5b2e276-d33d-49b3-ba09-59164c622b21")
    .limit(200);
  const oldMs=Date.now()-t0;
  if(oldErr) throw oldErr;

  const ids=(oldWay??[]).map(e=>e.id);
  const t1=Date.now();
  const {data:rpc,error:rpcErr}=await s.rpc("event_readiness",{p_event_ids:ids});
  const newMs=Date.now()-t1;
  if(rpcErr) throw rpcErr;

  const byId=new Map<string,number>();
  for(const r of (rpc??[]) as any[]) byId.set(r.event_id, Number(r.all_rows));

  let mismatches=0;
  for(const e of (oldWay??[]) as any[]){
    const before=e.images?.[0]?.count ?? 0;
    const after=byId.get(e.id) ?? 0;
    if(before!==after){
      mismatches++;
      console.log(`MISMATCH ${e.name}: embedded=${before} all_rows=${after}`);
    }
  }
  console.log(`\n${ids.length} events checked, ${mismatches} mismatch(es).`);
  console.log(`embedded aggregate: ${oldMs}ms   readiness RPC: ${newMs}ms`);
}
main().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
