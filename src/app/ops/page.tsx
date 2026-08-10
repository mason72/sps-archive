import { assertAdminPage } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/server";
import { PLATFORM_OVERHEAD_MONTHLY } from "@/lib/usage/costs";
import { getUsageOverview, type UserUsageSummary } from "@/lib/usage/summary";
import type { UsageKind } from "@/lib/usage/record";
import { InvitePanel, type InviteRow } from "./InvitePanel";
import { ActAsButton } from "./ActAsButton";

export const dynamic = "force-dynamic";

/* ── formatting ─────────────────────────────────────────────── */

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;

function dollars(n: number): string {
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.005) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const KIND_LABEL: Record<UsageKind, string> = {
  ai_index: "AI indexing",
  ai_embed_text: "search",
  ai_embed_selfie: "selfie search",
  video_process: "video",
  zip_build: "ZIP",
  cover_raster: "cover",
  email_send: "email",
};

function describeActivity(kind: UsageKind, quantity: number, unit: string): string {
  if (unit === "seconds") return `${KIND_LABEL[kind]} · ${quantity.toFixed(1)}s`;
  if (unit === "bytes") return `${KIND_LABEL[kind]} · ${gb(quantity)}`;
  if (unit === "emails")
    return `${KIND_LABEL[kind]} · ${quantity} recipient${quantity === 1 ? "" : "s"}`;
  return `${KIND_LABEL[kind]} · ${quantity}`;
}

/* ── page ───────────────────────────────────────────────────── */

export default async function OpsPage() {
  // Gate INSIDE the page, before any fetch — the layout's gate does not stop
  // this component's output reaching the stream (see assertAdminPage).
  await assertAdminPage();

  const supabase = createServiceClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [overview, invitesRes, errorsRes, activityRes] = await Promise.all([
    getUsageOverview(supabase, monthStart),
    supabase
      .from("allowed_signups")
      .select("email, invited_at, joined_at, note")
      .order("invited_at", { ascending: false }),
    supabase
      .from("system_errors")
      .select("id, context, message, user_id, event_id, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("usage_events")
      .select("user_id, kind, quantity, unit, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const emailById = new Map(overview.users.map((u) => [u.userId, u.email]));

  // Projection: MTD flows extrapolated to the full month + storage + overhead.
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
  const dayOfMonth = now.getUTCDate();
  const projectedFlows = (overview.totalFlowCost / dayOfMonth) * daysInMonth;
  const overheadTotal = PLATFORM_OVERHEAD_MONTHLY.reduce((s, o) => s + o.monthly, 0);
  const projectedMonth =
    projectedFlows + overview.totalStorageCostMonthly + overheadTotal;

  const maxDaily = Math.max(...overview.dailyFlowCosts.map((d) => d.cost), 0.000001);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-400">
          Operations
        </p>
        <h1 className="font-editorial mt-1 text-4xl text-stone-900">
          Cost &amp; usage
        </h1>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Accounts" value={String(overview.users.length)} />
        <StatCard label="Storage" value={gb(overview.totalStorageBytes)} sub={`${dollars(overview.totalStorageCostMonthly)}/mo in R2`} />
        <StatCard label="Metered cost · MTD" value={dollars(overview.totalFlowCost)} sub="Modal + email flows" />
        <StatCard
          label="Projected month"
          value={dollars(projectedMonth)}
          sub={`incl. ${dollars(overheadTotal)} overhead`}
          accent
        />
      </div>

      {/* 30-day sparkline */}
      <section className="rounded-xl border border-stone-200/80 bg-white p-6">
        <SectionHead title="Metered cost, trailing 30 days" />
        <div className="mt-4 flex h-24 items-end gap-[3px]">
          {overview.dailyFlowCosts.map((d, i) => (
            <div
              key={d.date}
              title={`${d.date}: ${dollars(d.cost)}`}
              className={`flex-1 rounded-sm ${i === overview.dailyFlowCosts.length - 1 ? "bg-emerald-600" : "bg-stone-200"}`}
              style={{ height: `${Math.max((d.cost / maxDaily) * 100, 2)}%` }}
            />
          ))}
        </div>
      </section>

      {/* Per-user table */}
      <section className="rounded-xl border border-stone-200/80 bg-white p-6">
        <SectionHead title="Cost by account · month to date" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wider text-stone-400">
                <th className="pb-2 pr-4 font-medium">Account</th>
                <th className="pb-2 pr-4 font-medium">Storage</th>
                <th className="pb-2 pr-4 font-medium">AI compute</th>
                <th className="pb-2 pr-4 font-medium">Activity</th>
                <th className="pb-2 pr-4 font-medium text-right">Storage $/mo</th>
                <th className="pb-2 font-medium text-right">Flows $ MTD</th>
              </tr>
            </thead>
            <tbody>
              {overview.users.map((u) => (
                <UserRow key={u.userId} u={u} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Invites */}
        <section className="rounded-xl border border-stone-200/80 bg-white p-6">
          <SectionHead title="Alpha invites" />
          <InvitePanel initialInvites={(invitesRes.data ?? []) as InviteRow[]} />
        </section>

        {/* Overhead */}
        <section className="rounded-xl border border-stone-200/80 bg-white p-6">
          <SectionHead title="Fixed overhead (configured estimates)" />
          <ul className="mt-4 space-y-2 text-sm">
            {PLATFORM_OVERHEAD_MONTHLY.map((o) => (
              <li key={o.label} className="flex justify-between">
                <span className="text-stone-600">{o.label}</span>
                <span className={o.monthly < 0 ? "text-emerald-700" : "text-stone-900"}>
                  {o.monthly < 0 ? `−$${Math.abs(o.monthly)}` : `$${o.monthly}`}/mo
                </span>
              </li>
            ))}
            <li className="flex justify-between border-t border-stone-100 pt-2 font-medium">
              <span className="text-stone-900">Total</span>
              <span>{dollars(overheadTotal)}/mo</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-stone-400">
            Edit in src/lib/usage/costs.ts — these are estimates until real
            invoices say otherwise.
          </p>
        </section>
      </div>

      {/* Activity feed */}
      <section className="rounded-xl border border-stone-200/80 bg-white p-6">
        <SectionHead title="Recent metered activity" />
        {activityRes.data?.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {activityRes.data.map((a, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4">
                <span className="truncate text-stone-700">
                  <span className="font-medium text-stone-900">
                    {emailById.get(a.user_id) ?? "unknown"}
                  </span>{" "}
                  · {describeActivity(a.kind as UsageKind, Number(a.quantity), a.unit)}
                </span>
                <span className="shrink-0 text-xs text-stone-400">{timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>No metered activity yet.</EmptyNote>
        )}
      </section>

      {/* Errors */}
      <section className="rounded-xl border border-stone-200/80 bg-white p-6">
        <SectionHead title="Recent system errors" />
        {errorsRes.data?.length ? (
          <ul className="mt-4 space-y-3 text-sm">
            {errorsRes.data.map((e) => (
              <li key={e.id} className="border-l-2 border-red-200 pl-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono text-xs text-red-700">{e.context}</span>
                  <span className="shrink-0 text-xs text-stone-400">{timeAgo(e.created_at)}</span>
                </div>
                <p className="mt-0.5 truncate text-stone-700">{e.message}</p>
                {e.user_id && (
                  <p className="text-xs text-stone-400">
                    {emailById.get(e.user_id) ?? e.user_id}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>No errors on record. Suspiciously well-behaved.</EmptyNote>
        )}
      </section>
    </div>
  );
}

/* ── local pieces ───────────────────────────────────────────── */

function SectionHead({ title }: { title: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-400">
      {title}
    </p>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-sm text-stone-400">{children}</p>;
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-stone-200/80 bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-400">
        {label}
      </p>
      <p
        className={`font-editorial mt-2 text-3xl leading-none ${accent ? "text-emerald-700" : "text-stone-900"}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

function UserRow({ u }: { u: UserUsageSummary }) {
  const aiSeconds =
    (u.flows.ai_index?.quantity ?? 0) +
    (u.flows.ai_embed_text?.quantity ?? 0) +
    (u.flows.ai_embed_selfie?.quantity ?? 0) +
    (u.flows.video_process?.quantity ?? 0);
  const activityBits = [
    u.flows.ai_index && `${u.flows.ai_index.count} index runs`,
    u.flows.ai_embed_text && `${u.flows.ai_embed_text.count} searches`,
    u.flows.zip_build && `${u.flows.zip_build.count} ZIPs`,
    u.flows.email_send && `${u.flows.email_send.quantity} emails`,
  ].filter(Boolean);

  return (
    <tr className="border-b border-stone-100 last:border-0">
      <td className="py-3 pr-4">
        <div className="font-medium text-stone-900">
          {u.displayName ?? u.email.split("@")[0]}
          {u.isAdmin && (
            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              admin
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 text-xs text-stone-400">
          <span>
            {u.email}
            {u.lastActiveAt ? ` · active ${timeAgo(u.lastActiveAt)}` : " · no metered activity"}
          </span>
          {!u.isAdmin && <ActAsButton userId={u.userId} email={u.email} />}
        </div>
      </td>
      <td className="py-3 pr-4 text-stone-700">{gb(u.storage.totalBytes)}</td>
      <td className="py-3 pr-4 text-stone-700">
        {aiSeconds > 0 ? `${aiSeconds.toFixed(0)}s` : "—"}
      </td>
      <td className="py-3 pr-4 text-xs text-stone-500">
        {activityBits.length ? activityBits.join(" · ") : "—"}
      </td>
      <td className="py-3 pr-4 text-right text-stone-700">
        {dollars(u.storageCostMonthly)}
      </td>
      <td className="py-3 text-right font-medium text-stone-900">
        {dollars(u.flowCost)}
      </td>
    </tr>
  );
}
