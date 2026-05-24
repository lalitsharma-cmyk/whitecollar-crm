// Activity-type → emoji + color hint for the timeline dot
export interface ActivityVisual { icon: string; dot: string; label: string; }

const MAP: Record<string, ActivityVisual> = {
  CALL:               { icon: "📞", dot: "bg-blue-500",    label: "Call" },
  WHATSAPP:           { icon: "💬", dot: "bg-emerald-500", label: "WhatsApp" },
  EMAIL:              { icon: "✉",  dot: "bg-sky-500",     label: "Email" },
  SITE_VISIT:         { icon: "🚗", dot: "bg-amber-500",   label: "Site Visit" },
  OFFICE_MEETING:     { icon: "🏢", dot: "bg-indigo-500",  label: "Office Meeting" },
  VIRTUAL_MEETING:    { icon: "💻", dot: "bg-violet-500",  label: "Virtual Meeting" },
  MEETING:            { icon: "🤝", dot: "bg-indigo-500",  label: "Meeting" },
  TASK:               { icon: "✅", dot: "bg-emerald-500", label: "Task" },
  NOTE:               { icon: "📝", dot: "bg-gray-500",    label: "Note" },
  STATUS_CHANGE:      { icon: "🔄", dot: "bg-purple-500",  label: "Stage change" },
  ASSIGNMENT:         { icon: "👤", dot: "bg-cyan-500",    label: "Assigned" },
  LEAD_CREATED:       { icon: "✨", dot: "bg-[#c9a24b]",   label: "Lead created" },
  BROCHURE_SENT:      { icon: "📎", dot: "bg-blue-400",    label: "Brochure sent" },
  PROJECT_DISCUSSED:  { icon: "🏗",  dot: "bg-amber-400",   label: "Project discussed" },
  REMINDER_FIRED:     { icon: "⏰", dot: "bg-orange-500",  label: "Reminder" },
};

export function activityVisual(type: string): ActivityVisual {
  return MAP[type] ?? { icon: "📌", dot: "bg-gray-400", label: type };
}
