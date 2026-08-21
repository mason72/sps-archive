import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) {
  const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m && process.env[m[1]]===undefined) process.env[m[1]]=m[2];
}
async function main(){
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const t=await sb.from("images").select("*",{count:"exact",head:true});
  const nt=await sb.from("images").select("*",{count:"exact",head:true}).eq("thumbnail_generated",false);
  const pend=await sb.from("images").select("*",{count:"exact",head:true}).eq("processing_status","pending");
  const ev=await sb.from("events").select("*",{count:"exact",head:true});
  console.log("images:",t.count,"| events:",ev.count,"| no thumbnail:",nt.count,"| pending:",pend.count);
}
main().catch(e=>{console.error(String(e).slice(0,200));process.exit(1)});
