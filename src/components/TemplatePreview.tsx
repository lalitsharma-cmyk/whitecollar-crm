"use client";

// Inline live-preview panel rendered under each template card on /admin/templates.
// Admin pastes/searches a lead, picks one, sees the rendered message, and can
// optionally fire off a WA test to their own number to see how the substituted
// text actually looks on a phone.

import { useEffect, useRef, useState } from "react";

interface Props {
  templateId: string;
  templateBody: string;
  templatePlaceholders: string[];
}

interface LeadHit {
  id: string;
  name: string;
  phone: string | null;
  budgetMin: number | null;
  budgetCurrency: string | null;
}

interface PreviewResp {
  ok: boolean;
  rendered?: { body: string; subject: string | null };
  missingFields?: string[];
  error?: string;
}

export default function TemplatePreview({ templateId, templateBody, templatePlaceholders }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadHit | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [myWa, setMyWa] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced lead search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/quick-search?q=${encodeURIComponent(q.trim())}`);
        const j = await r.json();
        setHits(((j.leads ?? []) as LeadHit[]).slice(0, 5));
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // When a lead is picked, fetch the rendered preview from the server.
  useEffect(() => {
    if (!selectedLead) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      try {
        const r = await fetch(
          `/api/admin/templates/preview?templateId=${encodeURIComponent(templateId)}&leadId=${encodeURIComponent(selectedLead.id)}`
        );
        const j: PreviewResp = await r.json();
        if (!cancelled) setPreview(j);
      } catch (e) {
        if (!cancelled) setPreview({ ok: false, error: String(e) });
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLead, templateId]);

  function pick(l: LeadHit) {
    setSelectedLead(l);
    setQ(l.name);
    setHits([]);
  }

  function clear() {
    setSelectedLead(null);
    setPreview(null);
    setQ("");
  }

  // Build the wa.me link for the "send test" button.
  const waNumber = myWa.replace(/[^\d]/g, "");
  const renderedBody = preview?.rendered?.body ?? "";
  const waHref = waNumber && renderedBody
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(renderedBody)}`
    : null;

  return (
    <div className="mt-3 border-t pt-3 bg-indigo-50/40 -mx-4 -mb-4 px-4 pb-4 rounded-b">
      <div className="text-[11px] font-semibold text-indigo-700 mb-2">🔍 Live preview</div>

      {/* Lead picker */}
      <div className="relative mb-2">
        <input
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); if (selectedLead) setSelectedLead(null); }}
          placeholder="Search a lead by name, phone, or email…"
          className="w-full text-xs border rounded px-2 py-1.5 bg-white"
        />
        {hits.length > 0 && !selectedLead && (
          <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow text-xs max-h-48 overflow-y-auto">
            {hits.map(l => (
              <button
                key={l.id}
                type="button"
                onClick={() => pick(l)}
                className="block w-full text-left px-2 py-1.5 hover:bg-indigo-50 border-b last:border-b-0"
              >
                <div className="font-medium">{l.name}</div>
                <div className="text-[10px] text-gray-500">
                  {l.phone ?? "no phone"}
                  {l.budgetMin ? ` · ${l.budgetCurrency ?? ""} ${l.budgetMin.toLocaleString()}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
        {searching && q.trim().length >= 2 && hits.length === 0 && !selectedLead && (
          <div className="text-[10px] text-gray-400 mt-1">Searching…</div>
        )}
      </div>

      {selectedLead && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-gray-600">
            Previewing for <b>{selectedLead.name}</b>
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-[10px] text-indigo-600 hover:underline"
          >
            change lead
          </button>
        </div>
      )}

      {/* Preview pane */}
      {!selectedLead && (
        <div className="text-[11px] text-gray-500 italic">
          Pick a lead to see how this template renders. Available placeholders:{" "}
          {templatePlaceholders.length > 0
            ? templatePlaceholders.map(p => <code key={p} className="mx-0.5 px-1 bg-white border rounded">{`{{${p}}}`}</code>)
            : <span>(none detected in body)</span>}
        </div>
      )}

      {selectedLead && loadingPreview && (
        <div className="text-[11px] text-gray-400">Rendering…</div>
      )}

      {selectedLead && !loadingPreview && preview && !preview.ok && (
        <div className="text-[11px] text-red-600">Error: {preview.error ?? "failed"}</div>
      )}

      {selectedLead && !loadingPreview && preview?.ok && preview.rendered && (
        <>
          {preview.rendered.subject && (
            <div className="text-[11px] mb-1">
              <span className="text-gray-500">Subject:</span>{" "}
              <span className="font-medium">{preview.rendered.subject}</span>
            </div>
          )}
          <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono bg-white border rounded p-2">
            {preview.rendered.body}
          </pre>

          {preview.missingFields && preview.missingFields.length > 0 && (
            <div className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              ⚠ Empty for this lead: {preview.missingFields.map(f => `{{${f}}}`).join(", ")}
            </div>
          )}

          {/* WA test sender */}
          <div className="mt-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="tel"
              value={myWa}
              onChange={e => setMyWa(e.target.value)}
              placeholder="Your WhatsApp number e.g. 971501234567"
              className="flex-1 text-xs border rounded px-2 py-1.5 bg-white"
            />
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded text-center hover:bg-emerald-700"
              >
                💬 Send test to my WhatsApp
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="text-xs px-3 py-1.5 bg-gray-200 text-gray-400 rounded cursor-not-allowed"
                title="Enter your WA number above first"
              >
                💬 Send test to my WhatsApp
              </button>
            )}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">
            Opens wa.me — message is pre-filled, you tap Send. Nothing is sent server-side.
          </div>
        </>
      )}

      {/* Surface unused source body for transparency */}
      {!selectedLead && templateBody.length === 0 && (
        <div className="text-[10px] text-gray-400 mt-2">Template body is empty.</div>
      )}
    </div>
  );
}
