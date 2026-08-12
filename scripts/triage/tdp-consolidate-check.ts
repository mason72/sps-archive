/**
 * Could the TDP Website duplicates be consolidated to one row with two links?
 *
 * The blocker to look for is FOCAL POINT divergence. A photo used as a hero and
 * again in a BTS grid may be cropped differently for each, and focal_x/focal_y
 * live on the IMAGE ROW, not on the section link. Two rows can hold two crops;
 * one row cannot. If the pairs disagree, consolidating silently re-crops the
 * live site.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
async function main(){
  const {createClient}=await import("@supabase/supabase-js");
  const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const {data:ev}=await s.from("events").select("id").eq("name","TDP Website").single();
  const rows:any[]=[];
  for(let off=0;;off+=1000){
    const {data}=await s.from("images")
      .select("id, original_filename, file_size, focal_x, focal_y, site_published_at, created_at")
      .eq("event_id",(ev as any).id).order("id",{ascending:true}).range(off,off+999);
    rows.push(...(data??[])); if(!data||data.length<1000) break;
  }
  const groups=new Map<string,any[]>();
  for(const r of rows){ if(r.file_size==null) continue;
    const k=`${r.original_filename}|${r.file_size}`; groups.set(k,[...(groups.get(k)??[]),r]); }
  let sameFocal=0, diffFocal=0, oneHasFocal=0, noneHaveFocal=0;
  const examples:string[]=[];
  for(const [k,rs] of groups){ if(rs.length<2) continue;
    const focals=rs.map(r=>r.focal_x==null?null:`${r.focal_x},${r.focal_y}`);
    const set=new Set(focals.map(f=>f??"null"));
    if(set.size===1){ if(focals[0]===null) noneHaveFocal++; else sameFocal++; }
    else if(focals.filter(f=>f!==null).length===1) oneHasFocal++;
    else { diffFocal++; if(examples.length<5) examples.push(`${k.split("|")[0]} → ${focals.join(" vs ")}`); }
  }
  console.log({dupeGroups:[...groups.values()].filter(g=>g.length>1).length,
    identicalFocal:sameFocal, noFocalAtAll:noneHaveFocal, onlyOneHasFocal:oneHasFocal, CONFLICTING:diffFocal});
  for(const e of examples) console.log("  conflict:", e);
}
main();
