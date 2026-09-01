const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg });

function ago(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

async function refresh() {
  const s = await send({ type: "status" });
  if (!s) return;
  $("state").textContent = s.running ? "running" : "stopped";
  $("state").className = "state" + (s.running ? " on" : "");
  $("done").textContent = `${s.done} / ${s.total}`;
  $("remaining").textContent = s.remaining;
  $("gated").textContent = s.gated;
  $("gone").textContent = s.gone ?? 0;
  $("pw").textContent = s.passwords || "none";
  $("last").textContent = ago(s.lastTickAt);
  $("fill").style.width = s.total ? `${(100 * s.done) / s.total}%` : "0";
  $("log").textContent = (s.log || []).join("\n") || "no activity yet";
  // Say WHY it stopped — a silent stop is the failure this whole thing exists to fix.
  $("why").textContent = !s.running && s.stoppedReason ? `Stopped: ${s.stoppedReason}` :
    s.running ? `One collection every ${s.gapMinutes} min.` : "";
}

$("start").onclick = async () => { await send({ type: "start" }); refresh(); };
$("stop").onclick = async () => { await send({ type: "stop" }); refresh(); };
$("arm").onclick = async () => {
  $("arm").textContent = "Arming…"; $("arm").disabled = true;
  const r = await send({ type: "arm" });
  $("arm").textContent = r?.ok ? `Armed ${r.count}` : "Arm failed";
  setTimeout(() => { $("arm").textContent = "Arm passwords"; $("arm").disabled = false; refresh(); }, 2200);
};

refresh();
setInterval(refresh, 3000);
