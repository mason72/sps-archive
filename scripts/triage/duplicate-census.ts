/**
 * What would a dedupe of the EXISTING archive actually remove?
 *
 * Identity matches the ingest guard exactly — (event, original_filename,
 * file_size) — so this counts precisely what today's uploader would have
 * skipped, and nothing it would have allowed. Same-name/DIFFERENT-size rows are
 * counted separately: those are genuine re-edits and must survive.
 *
 * Read-only.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
async function main(){
  const {createClient}=await import("@supabase/supabase-js");
  const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const {data:events}=await s.from("events").select("id,name").limit(100);
  let grandExtra=0, grandRows=0, grandReedits=0;
  const report:Array<[string,number,number,number]>=[];
  for(const e of (events??[]) as any[]){
    const rows:any[]=[];
    for(let off=0; ; off+=1000){
      const {data}=await s.from("images").select("id, original_filename, file_size, created_at")
        .eq("event_id",e.id).order("id",{ascending:true}).range(off,off+999);
      rows.push(...(data??[])); if(!data||data.length<1000) break;
    }
    if(rows.length===0) continue;
    const byKey=new Map<string,number>(), byName=new Map<string,Set<string>>();
    for(const r of rows){
      if(r.file_size==null) continue;
      const k=`${r.original_filename}|${r.file_size}`;
      byKey.set(k,(byKey.get(k)??0)+1);
      if(!byName.has(r.original_filename)) byName.set(r.original_filename,new Set());
      byName.get(r.original_filename)!.add(String(r.file_size));
    }
    let extra=0; for(const n of byKey.values()) extra += n-1;
    let reedits=0; for(const sizes of byName.values()) if(sizes.size>1) reedits += sizes.size-1;
    grandExtra+=extra; grandRows+=rows.length; grandReedits+=reedits;
    if(extra>0) report.push([e.name,rows.length,extra,reedits]);
  }
  report.sort((a,b)=>b[2]-a[2]);
  for(const [name,total,extra,reedits] of report)
    console.log(`${name.slice(0,34).padEnd(34)} ${String(total).padStart(5)} rows  ${String(extra).padStart(5)} exact dupes (${(100*extra/total).toFixed(1)}%)  ${reedits} re-edits kept`);
  console.log(`\nTOTAL: ${grandExtra} removable of ${grandRows} rows (${(100*grandExtra/grandRows).toFixed(1)}%); ${grandReedits} same-name re-edits preserved.`);
}
main().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
