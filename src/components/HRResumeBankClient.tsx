"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, FileText, Image as ImageIcon, Download, Eye, ExternalLink,
  ChevronDown, ChevronRight, History, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronsLeft, ChevronsRight, X, CheckCircle2, CopyCheck,
} from "lucide-react";

// ── Types (mirror the server-page projection) ────────────────────────────────
export interface ResumeVersion {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  contentHash: string | null;
  isActive: boolean;
  createdAt: string; // ISO
  uploadedByName: string | null;
}
export interface CandidateResumes {
  candidateId: string;
  candidateName: string;
  currentProfile: string | null;
  versions: ResumeVersion[]; // newest first; active first
}

interface Props {
  groups: CandidateResumes[];
  /** contentHash values that appear across 2+ distinct candidates. */
  duplicateHashes?: string[];
}

/** Small amber badge flagging a resume whose identical file lives on another candidate. */
function DuplicateBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      title="Identical file exists on another candidate"
      className={
        small
          ? "inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold"
          : "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold"
      }
    >
      <CopyCheck className={small ? "w-2.5 h-2.5" : "w-3 h-3"} /> Duplicate
    </span>
  );
}

type SortKey = "recent" | "name" | "position" | "filename";

const PAGE_SIZE = 15;

function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** Pluralize a noun for a count: 1 → "candidate", 0/2+ → "candidates". */
function plural(n: number, noun: string) {
  return n === 1 ? noun : `${noun}s`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function isImage(mime: string) {
  return mime.startsWith("image/");
}
function isPdf(mime: string) {
  return mime === "application/pdf" || /\.pdf$/i.test(mime);
}
function streamUrl(candidateId: string, resumeId: string, download = false) {
  return `/api/hr/candidates/${candidateId}/resume?resumeId=${resumeId}${download ? "&download=1" : ""}`;
}

export default function HRResumeBankClient({ groups, duplicateHashes = [] }: Props) {
  const dupSet = useMemo(() => new Set(duplicateHashes), [duplicateHashes]);
  const isDup = useCallback(
    (v: ResumeVersion) => !!v.contentHash && dupSet.has(v.contentHash),
    [dupSet],
  );
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ candidateId: string; v: ResumeVersion } | null>(null);

  const totalResumes = useMemo(
    () => groups.reduce((n, g) => n + g.versions.length, 0),
    [groups],
  );

  // Active (latest) resume per candidate — the row we render in the list.
  const rows = useMemo(() => {
    return groups
      .map((g) => {
        const active = g.versions.find((v) => v.isActive) ?? g.versions[0];
        return { group: g, active };
      })
      .filter((r) => r.active);
  }, [groups]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = rows;
    if (term) {
      list = rows.filter((r) => {
        const g = r.group;
        return (
          g.candidateName.toLowerCase().includes(term) ||
          (g.currentProfile ?? "").toLowerCase().includes(term) ||
          g.versions.some((v) => v.filename.toLowerCase().includes(term))
        );
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.group.candidateName.localeCompare(b.group.candidateName);
        case "position":
          return (a.group.currentProfile ?? "").localeCompare(b.group.currentProfile ?? "");
        case "filename":
          return a.active.filename.localeCompare(b.active.filename);
        case "recent":
        default:
          return new Date(b.active.createdAt).getTime() - new Date(a.active.createdAt).getTime();
      }
    });
    return sorted;
  }, [rows, q, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggle(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  const sortLabels: Record<SortKey, string> = {
    recent: "Most recent",
    name: "Candidate name",
    position: "Position",
    filename: "Filename",
  };

  return (
    <div className="space-y-4">
      {/* Toolbar: search + sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search by candidate, position, or filename…"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          {q && (
            <button
              type="button"
              onClick={() => { setQ(""); setPage(0); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as SortKey); setPage(0); }}
            className="py-2 pl-2 pr-7 rounded-xl border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            {(Object.keys(sortLabels) as SortKey[]).map((k) => (
              <option key={k} value={k}>{sortLabels[k]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        Showing {filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1}
        –{Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)} of{" "}
        {filtered.length} {plural(filtered.length, "candidate")}
        {q && ` · matched in ${totalResumes} stored ${plural(totalResumes, "resume")}`}
      </div>

      {/* List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        {pageRows.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-slate-500">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm">{q ? "No resumes match your search." : "No resumes uploaded yet."}</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {pageRows.map(({ group: g, active }) => {
              const open = !!expanded[g.candidateId];
              const hasHistory = g.versions.length > 1;
              return (
                <div key={g.candidateId}>
                  {/* Primary (active) row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-300">
                      {isImage(active.mimeType) ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/hr/candidates/${g.candidateId}`} className="text-sm font-semibold text-gray-900 dark:text-white hover:underline">
                          {g.candidateName}
                        </Link>
                        {g.currentProfile && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                            {g.currentProfile}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                        {isDup(active) && <DuplicateBadge />}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 flex flex-wrap gap-2 items-center">
                        <span className="truncate max-w-[260px]">{active.filename}</span>
                        {active.sizeBytes ? <span>· {fmtSize(active.sizeBytes)}</span> : null}
                        {active.uploadedByName && <span>· by {active.uploadedByName.split(" ")[0]}</span>}
                        <span>· {fmtDate(active.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(isImage(active.mimeType) || isPdf(active.mimeType)) && (
                        <button
                          type="button"
                          onClick={() => setPreview({ candidateId: g.candidateId, v: active })}
                          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-blue-300 text-blue-700 bg-white dark:bg-slate-800 dark:border-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </button>
                      )}
                      <a
                        href={streamUrl(g.candidateId, active.id, true)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </a>
                      <Link
                        href={`/hr/candidates/${g.candidateId}`}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Profile
                      </Link>
                    </div>
                  </div>

                  {/* Version history toggle */}
                  {hasHistory && (
                    <div className="px-4 pb-2 -mt-1">
                      <button
                        type="button"
                        onClick={() => toggle(g.candidateId)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                      >
                        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <History className="w-3.5 h-3.5" />
                        {open ? "Hide" : "Show"} version history ({g.versions.length - 1} older)
                      </button>

                      {open && (
                        <div className="mt-2 ml-5 border-l border-gray-200 dark:border-slate-700 pl-3 space-y-1.5">
                          {g.versions.map((v, idx) => (
                            <div key={v.id} className="flex items-center gap-2 py-1">
                              <div className="w-6 h-6 rounded bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-gray-500 dark:text-slate-400">
                                {isImage(v.mimeType) ? <ImageIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[12px] text-gray-700 dark:text-slate-200 truncate max-w-[220px]">{v.filename}</span>
                                  <span className="text-[10px] text-gray-400">v{g.versions.length - idx}</span>
                                  {v.isActive && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold">current</span>
                                  )}
                                  {isDup(v) && <DuplicateBadge small />}
                                </div>
                                <div className="text-[10px] text-gray-400 dark:text-slate-500 flex flex-wrap gap-1.5">
                                  {v.sizeBytes ? <span>{fmtSize(v.sizeBytes)}</span> : null}
                                  {v.uploadedByName && <span>· {v.uploadedByName.split(" ")[0]}</span>}
                                  <span>· {fmtDate(v.createdAt)}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {(isImage(v.mimeType) || isPdf(v.mimeType)) && (
                                  <button
                                    type="button"
                                    onClick={() => setPreview({ candidateId: g.candidateId, v })}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                                  >
                                    <Eye className="w-3 h-3" /> View
                                  </button>
                                )}
                                <a
                                  href={streamUrl(g.candidateId, v.id, true)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                                >
                                  <Download className="w-3 h-3" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-1">
          <button
            type="button" disabled={safePage === 0} onClick={() => setPage(0)}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-30 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
          ><ChevronsLeft className="w-4 h-4" /></button>
          <button
            type="button" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-30 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
          ><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-xs text-gray-600 dark:text-slate-300 px-2">Page {safePage + 1} of {pageCount}</span>
          <button
            type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-30 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
          ><ChevronRight className="w-4 h-4" /></button>
          <button
            type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-30 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
          ><ChevronsRight className="w-4 h-4" /></button>
        </div>
      )}

      {/* Inline preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                {isImage(preview.v.mimeType) ? <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" /> : <FileText className="w-4 h-4 text-blue-600 shrink-0" />}
                <span className="text-sm font-semibold text-gray-800 dark:text-slate-100 truncate">{preview.v.filename}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={streamUrl(preview.candidateId, preview.v.id, true)}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button
                  type="button" onClick={() => setPreview(null)}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                  aria-label="Close preview"
                ><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-50 dark:bg-slate-950 min-h-[60vh]">
              {isImage(preview.v.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={streamUrl(preview.candidateId, preview.v.id)}
                  alt={preview.v.filename}
                  className="max-w-full mx-auto"
                />
              ) : (
                <iframe
                  src={streamUrl(preview.candidateId, preview.v.id)}
                  title={preview.v.filename}
                  className="w-full h-[75vh]"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
