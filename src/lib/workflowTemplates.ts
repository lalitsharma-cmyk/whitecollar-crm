// Starter workflow templates — proven IF/THEN patterns for the sales team.
//
// Each template is a one-click clone source for the visual WorkflowBuilder
// (rendered at the top of the builder panel). The shape mirrors the form
// state of <Builder>, so applying a template just sets local state and the
// admin can tweak/save normally.
//
// IMPORTANT: trigger + action.type must be valid Prisma enum values from
// schema.prisma — see WorkflowTrigger and WorkflowActionType. The condition
// key vocabulary (filterQuery) is restricted to what leadMatchesQuery() in
// src/lib/workflowEngine.ts understands today: `team`, `ai`, `status`.
// Any template that needs a richer condition expresses that via the trigger
// itself (e.g. NO_CONTACT_DAYS) so we never emit fictional enum values.

export type StarterTrigger =
  | "LEAD_CREATED"
  | "STATUS_CHANGED"
  | "BANT_CHANGED"
  | "STAGE_TIME"
  | "NO_CONTACT_DAYS"
  | "NOT_PICKED_STREAK"
  | "COLD_PROMOTED";

export type StarterActionType =
  | "SEND_WA"
  | "SEND_EMAIL"
  | "CREATE_TASK"
  | "NOTIFY_ADMIN"
  | "NOTIFY_OWNER"
  | "SET_FIELD"
  | "ADD_TAG";

export interface StarterAction {
  type: StarterActionType;
  delayMinutes: number;
  config: Record<string, unknown>;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger: StarterTrigger;
  /** Optional trigger-specific config (e.g. { to: "SITE_VISIT" } for STATUS_CHANGED). */
  triggerConfig?: Record<string, unknown>;
  /** URLSearchParams-style condition (e.g. "status=NEW" or "ai=HOT"). */
  filterQuery?: string;
  actions: StarterAction[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "speed-to-lead-sla",
    name: "Speed-to-lead: SLA escalation",
    description:
      "Alert the manager 15 minutes after a new lead arrives so a stalled first-call gets escalated immediately.",
    trigger: "LEAD_CREATED",
    actions: [
      {
        type: "NOTIFY_ADMIN",
        delayMinutes: 15,
        config: {
          message:
            "Speed-to-lead breach: this lead is 15 minutes old — confirm the owner has called.",
        },
      },
    ],
  },
  {
    id: "cold-lead-revival",
    name: "Cold lead revival nudge",
    description:
      "Re-engage NEW leads that have gone quiet with a first-query WhatsApp follow-up template.",
    trigger: "NO_CONTACT_DAYS",
    triggerConfig: { threshold: 3 },
    filterQuery: "status=NEW",
    actions: [
      {
        type: "SEND_WA",
        delayMinutes: 0,
        config: { templateId: "first_query_followup" },
      },
    ],
  },
  {
    id: "post-site-visit-thanks",
    name: "Post-site-visit thank you",
    description:
      "Send a thank-you WhatsApp message right after a lead moves into the SITE_VISIT stage.",
    trigger: "STATUS_CHANGED",
    triggerConfig: { to: "SITE_VISIT" },
    actions: [
      {
        type: "SEND_WA",
        delayMinutes: 0,
        config: { templateId: "post_visit_thanks" },
      },
    ],
  },
  {
    id: "hot-lead-alert",
    name: "Hot lead alert to manager",
    description:
      "Ping the manager the moment the AI scorer marks a lead HOT — these need an immediate call.",
    trigger: "STATUS_CHANGED",
    filterQuery: "ai=HOT",
    actions: [
      {
        type: "NOTIFY_ADMIN",
        delayMinutes: 0,
        config: { message: "Hot lead detected — assign your best closer." },
      },
    ],
  },
  {
    id: "booking-done-celebration",
    name: "Booking-done internal celebration",
    description:
      "When a deal hits BOOKING_DONE, queue a task to send the commission tracking sheet to finance.",
    trigger: "STATUS_CHANGED",
    triggerConfig: { to: "BOOKING_DONE" },
    actions: [
      {
        type: "CREATE_TASK",
        delayMinutes: 0,
        config: {
          title: "Send commission tracking sheet",
          dueInMinutes: 60,
        },
      },
    ],
  },
  {
    id: "weekly-followup-quiet",
    name: "Weekly follow-up if quiet",
    description:
      "If a lead has had no contact for 7 days, create a task for the owner to re-engage the client.",
    trigger: "NO_CONTACT_DAYS",
    triggerConfig: { threshold: 7 },
    actions: [
      {
        type: "CREATE_TASK",
        delayMinutes: 0,
        config: {
          title: "Re-engage this client",
          dueInMinutes: 60,
        },
      },
    ],
  },
  {
    id: "not-picked-streak-escalation",
    name: "Not-picked streak escalation",
    description:
      "After 3 consecutive not-picked attempts, notify the manager so they can step in or reassign.",
    trigger: "NOT_PICKED_STREAK",
    triggerConfig: { threshold: 3 },
    actions: [
      {
        type: "NOTIFY_ADMIN",
        delayMinutes: 0,
        config: {
          message: "3 consecutive not-picked attempts — consider reassigning.",
        },
      },
    ],
  },
  {
    id: "negotiation-stall-warning",
    name: "Negotiation stall warning",
    description:
      "If a lead sits in NEGOTIATION too long, flag it for manager review automatically.",
    trigger: "STAGE_TIME",
    triggerConfig: { threshold: 4320 },
    filterQuery: "status=NEGOTIATION",
    actions: [
      {
        type: "SET_FIELD",
        delayMinutes: 0,
        config: { field: "needsManagerReview", value: "true" },
      },
    ],
  },
  {
    id: "cold-promoted-welcome",
    name: "Cold-data promoted welcome",
    description:
      "When a cold-data row is promoted to a real lead, send the first-query WhatsApp and notify the owner.",
    trigger: "COLD_PROMOTED",
    actions: [
      {
        type: "SEND_WA",
        delayMinutes: 0,
        config: { templateId: "first_query_followup" },
      },
      {
        type: "NOTIFY_OWNER",
        delayMinutes: 0,
        config: { message: "A cold-data prospect was just promoted to you — call within 15 min." },
      },
    ],
  },
];
