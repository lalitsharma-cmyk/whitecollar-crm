import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { fmtIST12, fmtISTDate } from "@/lib/datetime";
import { displayBudget } from "@/lib/budgetParse";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const outcomeLabel: Record<string, string> = {
  CONNECTED: "Connected",
  NOT_PICKED: "Not Picked",
  CALLBACK: "Callback",
  WRONG_NUMBER: "Wrong Number",
  BUSY: "Busy",
  SWITCHED_OFF: "Switched Off",
  INTERESTED: "Interested",
  NOT_INTERESTED: "Not Interested",
};

const statusLabel: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  SITE_VISIT: "Site Visit",
  NEGOTIATION: "Negotiation",
  EOI: "EOI",
  BOOKING_DONE: "Booking Done",
  WON: "Closed Won",
  LOST: "Closed Lost",
};

const potentialLabel: Record<string, string> = {
  HIGH: "🔥 Hot",
  MEDIUM: "🌤 Warm",
  LOW: "❄ Cold",
  UNKNOWN: "—",
};

const fundReadinessLabel: Record<string, string> = {
  CASH_READY: "💵 Cash Ready",
  BANK_APPROVED: "🏦 Bank Approved",
  FINANCING_NEEDED: "📋 Financing Needed",
  NOT_DISCUSSED: "Not Discussed",
  IMMEDIATE_BUYER: "Immediate Buyer",
  SHORT_TERM_BUYER: "Short-Term Buyer",
  CONDITIONAL_BUYER: "Conditional Buyer",
  FINANCED_BUYER: "Financed Buyer",
  FUTURE_BUYER: "Future Buyer",
};

const timelineLabel: Record<string, string> = {
  IMMEDIATE: "⚡ On Spot / Immediate",
  THIRTY_DAYS: "📅 Within 1 Month",
  THREE_MONTHS: "✈ Will Visit Dubai First",
  SIX_PLUS_MONTHS: "⏳ Not in 6 Months",
  WINDOW_SHOPPING: "👀 Just Browsing",
  UNKNOWN: "❓ Not Sure",
};

const authorityLabel: Record<string, string> = {
  DECISION_MAKER: "✅ Decision Maker",
  INFLUENCER: "🤝 Influencer",
  GATEKEEPER: "🚧 Gatekeeper",
  UNKNOWN: "❓ Unknown",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: "12px", marginBottom: "6px" }}>
      <span style={{ fontWeight: 600, color: "#6b7280", minWidth: "140px", fontSize: "12px" }}>
        {label}
      </span>
      <span style={{ fontSize: "13px", color: "#111827", flex: 1 }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "24px", pageBreakInside: "avoid" }}>
      <div style={{
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#6b7280",
        borderBottom: "1px solid #e5e7eb",
        paddingBottom: "4px",
        marginBottom: "12px",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default async function LeadPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Auth — agents cannot access the print page
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/leads");

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true } },
      callLogs: {
        orderBy: { startedAt: "desc" },
        take: 20,
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!lead) notFound();

  // Scope guard — a MANAGER may only print leads in their own forwardedTeam,
  // an AGENT only their own. Treat out-of-scope as not-found (no PII leak by URL).
  if (!(await canTouchLead(me, { ownerId: lead.ownerId, forwardedTeam: lead.forwardedTeam }))) notFound();

  const printedAt = fmtIST12(new Date());

  return (
    <>
      {/* Hide nav/sidebar/header on print */}
      <style>{`
        @media print {
          nav, aside, header, footer,
          [class*="sidebar"], [class*="nav"],
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="p-8 max-w-3xl mx-auto">
        {/* Print button — hidden on actual print */}
        <div className="no-print mb-4 flex items-center gap-3">
          <PrintButton />
          <span className="text-xs text-gray-500">Opens system print dialog. Choose &quot;Save as PDF&quot; to export.</span>
        </div>

        {/* ── Header ── */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0b1a33", margin: 0 }}>
              {lead.name}
              {lead.altName && (
                <span style={{ fontSize: "16px", fontWeight: 500, color: "#6b7280" }}> &amp; {lead.altName}</span>
              )}
            </h1>
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>Printed: {printedAt} IST</span>
          </div>

          {/* Chips row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
            <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "#dbeafe", color: "#1e40af", fontWeight: 600 }}>
              {statusLabel[lead.status] ?? lead.status}
            </span>
            {lead.potential && (
              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                {potentialLabel[lead.potential] ?? lead.potential}
              </span>
            )}
            {lead.forwardedTeam && (
              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "#d1fae5", color: "#065f46", fontWeight: 600 }}>
                {lead.forwardedTeam} Team
              </span>
            )}
            {lead.aiScore && lead.aiScoreValue != null && (
              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "#f3f4f6", color: "#374151", fontWeight: 600 }}>
                AI Score: {lead.aiScore} · {lead.aiScoreValue}
              </span>
            )}
            {lead.categorization && (
              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "#f3f4f6", color: "#374151" }}>
                {lead.categorization}
              </span>
            )}
          </div>
        </div>

        {/* ── Contact Info ── */}
        <Section title="Contact Information">
          <Row label="Phone" value={lead.phone} />
          <Row label="Alt Phone" value={lead.altPhone} />
          <Row label="Email" value={lead.email} />
          <Row label="Company" value={lead.company} />
          <Row label="Location" value={[lead.city, lead.country].filter(Boolean).join(", ") || null} />
          <Row label="Source" value={lead.source?.replace(/_/g, " ")} />
          <Row label="Assigned To" value={lead.owner?.name ?? "—"} />
        </Section>

        {/* ── BANT Qualification ── */}
        <Section title="BANT Qualification">
          <Row
            label="BANT Status"
            value={
              lead.bantStatus === "QUALIFIES" ? "✅ Qualifies" :
              lead.bantStatus === "NOT_QUALIFIED" ? "❌ Not Qualified" :
              "🤔 Under Review"
            }
          />
          <Row
            label="Budget"
            value={(() => { const d = displayBudget(lead); return d === "—" ? null : d; })()}
          />
          <Row
            label="Fund Readiness"
            value={lead.fundReadiness ? (fundReadinessLabel[lead.fundReadiness] ?? lead.fundReadiness) : null}
          />
          <Row
            label="Authority"
            value={lead.authorityLevel ? (authorityLabel[lead.authorityLevel] ?? lead.authorityLevel) : null}
          />
          <Row label="Need / Requirement" value={lead.needSummary} />
          <Row
            label="Timeline"
            value={lead.whenCanInvest ? (timelineLabel[lead.whenCanInvest] ?? lead.whenCanInvest) : null}
          />
          <Row label="Configuration" value={lead.configuration} />
          <Row label="Client Type" value={lead.clientType?.replace(/_/g, " ")} />
          <Row label="Profession" value={lead.profession?.replace(/_/g, " ")} />
        </Section>

        {/* ── Follow-up & Scheduling ── */}
        <Section title="Follow-up &amp; Scheduling">
          <Row
            label="Follow-up Date"
            value={lead.followupDate ? fmtISTDate(lead.followupDate) : null}
          />
          <Row
            label="Meeting Date"
            value={lead.meetingDate ? fmtISTDate(lead.meetingDate) : null}
          />
          <Row
            label="Site Visit Date"
            value={lead.siteVisitDate ? fmtISTDate(lead.siteVisitDate) : null}
          />
          <Row
            label="Last Touched"
            value={lead.lastTouchedAt ? fmtIST12(lead.lastTouchedAt) : null}
          />
          <Row label="Next Action" value={lead.todoNext} />
        </Section>

        {/* ── Full Remarks ── */}
        {lead.remarks && lead.remarks.trim() && (
          <Section title="Remarks / History">
            <div style={{
              fontSize: "12px",
              color: "#374151",
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              padding: "12px",
            }}>
              {lead.remarks}
            </div>
          </Section>
        )}

        {/* ── Call Log ── */}
        {lead.callLogs.length > 0 && (
          <Section title={`Call Log (last ${Math.min(lead.callLogs.length, 10)} entries)`}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Date &amp; Time</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Outcome</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Duration</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>By Agent</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {lead.callLogs.slice(0, 10).map((log, idx) => (
                  <tr key={log.id} style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", color: "#374151" }}>
                      {fmtIST12(log.startedAt)}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                      <span style={{
                        fontSize: "11px",
                        padding: "1px 6px",
                        borderRadius: "999px",
                        background: log.outcome === "CONNECTED" || log.outcome === "INTERESTED" ? "#d1fae5" :
                          log.outcome === "NOT_PICKED" || log.outcome === "NOT_INTERESTED" ? "#fee2e2" : "#fef3c7",
                        color: log.outcome === "CONNECTED" || log.outcome === "INTERESTED" ? "#065f46" :
                          log.outcome === "NOT_PICKED" || log.outcome === "NOT_INTERESTED" ? "#991b1b" : "#92400e",
                        fontWeight: 600,
                      }}>
                        {outcomeLabel[log.outcome] ?? log.outcome}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#6b7280", whiteSpace: "nowrap" }}>
                      {log.durationSec != null ? `${Math.floor(log.durationSec / 60)}m ${log.durationSec % 60}s` : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#374151", whiteSpace: "nowrap" }}>
                      {log.attributedAgentName ?? log.user?.name ?? "—"}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#374151" }}>
                      {log.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Footer */}
        <div style={{ marginTop: "32px", borderTop: "1px solid #e5e7eb", paddingTop: "12px", fontSize: "11px", color: "#9ca3af", display: "flex", justifyContent: "space-between" }}>
          <span>White Collar Realty CRM</span>
          <span>Lead ID: {lead.id}</span>
        </div>
      </div>
    </>
  );
}
