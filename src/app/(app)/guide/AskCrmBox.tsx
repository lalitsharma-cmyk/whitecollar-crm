"use client";

// AskCrmBox — the small client island for the "Ask the CRM" Q&A on /guide.
//
// SANDBOX-ONLY LEARNING AID. Deterministic + OFFLINE — it calls matchQuestion()
// from the pure knowledge base (src/lib/crmGuideKnowledge.ts). No LLM, no fetch,
// no server round-trip: the same typed question always returns the same answers.
// The parent page is a server component; only this box is a client component.

import { useMemo, useState } from "react";
import { matchQuestion, SUGGESTED_QUESTIONS, CRM_KNOWLEDGE } from "@/lib/crmGuideKnowledge";

export default function AskCrmBox() {
  const [query, setQuery] = useState("");

  // Deterministic keyword match over the pure KB. Empty query → no results
  // (we show the suggestion chips instead). Recomputed only when `query` changes.
  const results = useMemo(() => (query.trim() ? matchQuestion(query, 4) : []), [query]);
  const asked = query.trim().length > 0;

  return (
    <div className="grad-card rounded-2xl p-5 sm:p-6">
      <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest bg-white/15 text-white px-2.5 py-1 rounded-full">
        🤖 Ask the CRM
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-white mt-3">Have a question? Type it below.</h2>
      <p className="text-sm text-white/80 mt-1">
        Ask in plain English — &ldquo;What is Revival Engine?&rdquo;, &ldquo;When should I convert a lead?&rdquo;.
        This is an offline helper: it matches your words to a built-in answer book. No internet, no AI, always the same answer.
      </p>

      {/* Search input */}
      <div className="mt-4">
        <label htmlFor="ask-crm" className="sr-only">Ask a question about the CRM</label>
        <input
          id="ask-crm"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type your question…"
          autoComplete="off"
          className="w-full rounded-xl px-4 py-3 text-sm text-[#0b1a33] bg-white border border-white/20 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-[#c9a24b]"
        />
      </div>

      {/* Suggested-question chips (shown until the user types) */}
      {!asked && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-widest text-white/50 mb-2">Popular questions</div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuery(q)}
                className="text-[13px] bg-white/10 hover:bg-white/20 text-white rounded-full px-3 py-1.5 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Answers */}
      {asked && (
        <div className="mt-4 space-y-3">
          {results.length === 0 ? (
            <div className="rounded-xl bg-white/10 p-4 text-sm text-white/90">
              <p className="font-semibold">No match found for that one. 🤔</p>
              <p className="mt-1 text-white/70">
                Try different words, or tap a popular question above. You can also scroll down to the module
                cards for the full explanations. Still stuck? Ask Lalit.
              </p>
            </div>
          ) : (
            results.map((qa) => (
              <div key={qa.id} className="rounded-xl bg-white p-4 text-[#0b1a33] shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-bold">{qa.question}</h3>
                  {qa.topic && (
                    <span className="flex-none text-[10px] font-semibold uppercase tracking-wide bg-[#fdfaf2] text-[#856404] border border-[#e9d8a6] rounded-full px-2 py-0.5">
                      {qa.topic}
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-gray-700 mt-2 leading-relaxed">{qa.answer}</p>
              </div>
            ))
          )}
        </div>
      )}

      <p className="text-[11px] text-white/50 mt-4">
        {CRM_KNOWLEDGE.length} answers in the book · offline · rule-based (no AI)
      </p>
    </div>
  );
}
