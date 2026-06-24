// Activity-type → emoji + color hint for the Smart-Timeline dot.
//
// The dot COLOURS are aligned with the CRM Action Design System
// (src/lib/actionDesign.ts) so the timeline speaks the same colour language as
// the action buttons: a CALL activity uses the same emerald as the Call button,
// WHATSAPP the brand green, EMAIL the same blue, MEETING purple, SITE_VISIT
// indigo, a completed TASK the success green, etc. The compact emoji glyph is
// kept here (it reads better than an icon at dot size in a dense timeline), but
// when an activity maps to a catalogued action its colour comes from that
// action's palette. New activity types: pick the colour of the action they
// relate to so the timeline stays consistent — do not invent new hues.

export interface ActivityVisual { icon: string; dot: string; label: string; }

const MAP: Record<string, ActivityVisual> = {
  CALL:               { icon: "📞", dot: "bg-emerald-600", label: "Call" },           // call token
  WHATSAPP:           { icon: "💬", dot: "bg-[#25D366]",   label: "WhatsApp" },        // whatsapp token
  EMAIL:              { icon: "✉",  dot: "bg-blue-600",    label: "Email" },           // email token
  SITE_VISIT:         { icon: "🚗", dot: "bg-indigo-600",  label: "Site Visit" },      // siteVisit token
  OFFICE_MEETING:     { icon: "🏢", dot: "bg-purple-600",  label: "Office Meeting" },  // meeting token
  VIRTUAL_MEETING:    { icon: "💻", dot: "bg-purple-600",  label: "Virtual Meeting" }, // meeting token
  MEETING:            { icon: "🤝", dot: "bg-purple-600",  label: "Meeting" },         // meeting token
  TASK:               { icon: "✅", dot: "bg-green-600",   label: "Task" },            // complete token
  NOTE:               { icon: "📝", dot: "bg-[#c9a24b]",   label: "Note" },            // logCall/gold accent
  STATUS_CHANGE:      { icon: "🔄", dot: "bg-slate-500",   label: "Stage change" },
  ASSIGNMENT:         { icon: "👤", dot: "bg-teal-600",    label: "Assigned" },        // assign token
  LEAD_CREATED:       { icon: "✨", dot: "bg-[#c9a24b]",   label: "Lead created" },
  BROCHURE_SENT:      { icon: "📎", dot: "bg-slate-700",   label: "Brochure sent" },   // resource token
  PROJECT_DISCUSSED:  { icon: "🏗",  dot: "bg-amber-500",   label: "Project discussed" },
  REMINDER_FIRED:     { icon: "⏰", dot: "bg-orange-500",  label: "Reminder" },        // followUp token
};

export function activityVisual(type: string): ActivityVisual {
  return MAP[type] ?? { icon: "📌", dot: "bg-gray-400", label: type };
}
