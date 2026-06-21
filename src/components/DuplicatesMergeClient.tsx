"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatLeadName } from "@/lib/leadName";

interface Lead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  source: string;
  ownerName: string | null;
  createdAtLabel: string;
  lastTouchedLabel: string;
}

interface Props {
  groupKey: string;
  leads: Lead[];
}

/**
 * One card per duplicate group. The admin picks ONE row as the "master"
 * (radio) and any number of rows to merge into it (checkboxes — but never
 * the master row itself). The merge button POSTs to /api/admin/leads/merge.
 */
export default function DuplicatesMergeClient({ groupKey, leads }: Props) {
  const router = useRouter();
  const [masterId, setMasterId] = useState<string>(leads[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickMaster(id: string) {
    setMasterId(id);
    // The master can never also be merged — uncheck if it was ticked.
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function onMerge() {
    setErr(null);
    if (!masterId) {
      setErr("Pick a master row first.");
      return;
    }
    const mergeIds = Array.from(selected).filter((id) => id !== masterId);
    if (mergeIds.length === 0) {
      setErr("Tick at least one row to merge into the master.");
      return;
    }
    const masterName = leads.find((l) => l.id === masterId)?.name ?? "selected lead";
    if (!confirm(
      `Merge ${mergeIds.length} lead(s) into "${masterName}"?\n\n` +
      `All activities, calls, notes, assignments, and project/unit interest from ` +
      `the merged leads will move to the master. The merged leads will be DELETED. ` +
      `This cannot be undone.`,
    )) return;

    setBusy(true);
    try {
      const r = await fetch("/api/admin/leads/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterId, mergeIds }),
      });
      const j: { ok?: boolean; error?: string; mergedCount?: number } = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setErr(j.error ?? `Merge failed (HTTP ${r.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-group-key={groupKey}>
      <div className="overflow-x-auto">
        <table className="tbl text-xs min-w-[640px]">
          <thead>
            <tr>
              <th className="w-10">Master</th>
              <th className="w-10">Merge</th>
              <th>Name</th>
              <th>Phone / Email</th>
              <th>Status</th>
              <th>Source</th>
              <th>Owner</th>
              <th>Created</th>
              <th>Last touched</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const isMaster = masterId === l.id;
              return (
                <tr key={l.id} className={isMaster ? "bg-amber-50" : ""}>
                  <td className="text-center">
                    <input
                      type="radio"
                      name={`master-${groupKey}`}
                      checked={isMaster}
                      onChange={() => pickMaster(l.id)}
                      disabled={busy}
                      aria-label={`Set ${l.name} as master`}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id) && !isMaster}
                      onChange={() => toggle(l.id)}
                      disabled={busy || isMaster}
                      aria-label={`Mark ${l.name} to be merged`}
                    />
                  </td>
                  <td className="font-medium">{formatLeadName(l.name)}</td>
                  <td className="text-[11px] text-gray-600">
                    <div>{l.phone ?? "—"}</div>
                    <div className="text-gray-400">{l.email ?? "—"}</div>
                  </td>
                  <td><span className="chip text-[10px]">{l.status}</span></td>
                  <td className="text-[11px]">{l.source}</td>
                  <td className="text-[11px]">{l.ownerName ?? <span className="text-gray-400">unassigned</span>}</td>
                  <td className="text-[10px] whitespace-nowrap">{l.createdAtLabel}</td>
                  <td className="text-[10px] whitespace-nowrap">{l.lastTouchedLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onMerge}
          disabled={busy || !masterId || selected.size === 0}
          className="btn btn-gold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Merging…" : `Merge ${selected.size} into selected master`}
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
