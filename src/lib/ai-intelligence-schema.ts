// ─────────────────────────────────────────────────────────────────────────────
// White Collar Realty — Unified AI Intelligence Schema
// ALL three models (Claude, GPT, Gemini) receive the SAME prompt and return
// the SAME JSON structure. The only difference is the provider API used.
// Purpose: fair head-to-head comparison to select the permanent AI brain.
// ─────────────────────────────────────────────────────────────────────────────

export interface IntelligenceSummary {
  whoIsClient: string;
  whatTheyWant: string;
  whatHappenedSoFar: string;
  buyingJourneyStage: "Awareness" | "Consideration" | "Evaluation" | "DecisionPending" | "ReadyToBook" | "Stalled" | "Dormant";
  oneLinerVerdict: string;
}

export interface ClientUnderstanding {
  clientType: "Investor" | "EndUser" | "NRI" | "HNI" | "FamilyBuyer" | "CommercialBuyer" | "Broker" | "ChannelPartner" | "Unknown";
  profession: string | null;
  businessProfile: string | null;
  investmentMaturity: "FirstTimer" | "Experienced" | "Seasoned" | "Portfolio" | "Unknown";
  existingPortfolio: string | null;
  familyInvolvement: string | null;
  decisionMakers: string[];
  authorityStructure: string;
  keyPersonalityTrait: string | null;
}

export interface RequirementAnalysis {
  budget: { value: string | null; confidence: number; source: string | null };
  configuration: { value: string | null; confidence: number; source: string | null };
  propertyType: string | null;
  preferredLocation: string | null;
  purpose: "Investment" | "EndUse" | "HolidayHome" | "RentalIncome" | "CapitalAppreciation" | "Mixed" | "Unknown";
  readyOrOffPlan: "Ready" | "OffPlan" | "Both" | "NoPreference" | "Unknown";
  timeline: { value: string | null; confidence: number; source: string | null };
  unstatedPreferences: string[];
}

export interface BANTIntelligence {
  budget: { score: "Strong" | "Moderate" | "Weak" | "Unknown"; confidence: number; amount: string | null; source: string | null };
  authority: { score: "Strong" | "Moderate" | "Weak" | "Unknown"; confidence: number; whoDecides: string | null; source: string | null };
  need: { score: "Strong" | "Moderate" | "Weak" | "Unknown"; confidence: number; description: string | null; source: string | null };
  timeline: { score: "Strong" | "Moderate" | "Weak" | "Unknown"; confidence: number; when: string | null; source: string | null };
  overallBANT: "Qualifies" | "UnderReview" | "NotQualified";
  bantVerdict: string;
}

export interface WhyNotClosed {
  biggestBlocker: string;
  hiddenObjection: string | null;
  missingInformation: string[];
  buyingTrigger: string | null;
  delayReason: string | null;
}

export interface ClosingProbability {
  classification: "VeryHigh" | "High" | "Medium" | "Low" | "Dead";
  percentage: number;
  reasoning: string;
  positiveSignals: string[];
  negativeSignals: string[];
}

export interface HumanPsychology {
  buyingSignals: string[];
  trustSignals: string[];
  delaySignals: string[];
  fearSignals: string[];
  familyInfluence: string | null;
  decisionMakingBehavior: "Fast" | "Methodical" | "Emotional" | "Analytical" | "Collaborative" | "Unknown";
  emotionalTriggers: string[];
  overallPsychProfile: string;
  howToInfluence: string;
}

export interface EffortRecommendation {
  level: "HighEffort" | "MediumEffort" | "LowEffort" | "LongTermNurture" | "NoEffort";
  reasoning: string;
  followUpFrequency: string;
  recommendedOwnership: "Agent" | "Manager" | "SalesDirector" | "TeamLead";
  escalationNeeded: boolean;
  escalationReason: string | null;
}

export interface NextBestAction {
  action: "Call" | "WhatsApp" | "Email" | "OfficeMeeting" | "VirtualMeeting" | "SiteVisit" | "LongTermFollowUp" | "Revival";
  reasoning: string;
  urgency: "Immediate" | "Today" | "ThisWeek" | "NextWeek" | "NextMonth";
  specificInstructions: string;
  openingLine: string;
}

export interface CallStrategy {
  objective: string;
  openingLine: string;
  talkingPoints: string[];
  questionsToAsk: string[];
  objectionsToHandle: string[];
  closingLine: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  cta: string;
}

export interface ProjectRecommendation {
  projectName: string;
  matchReason: string;
  angle: "BestBudget" | "BestConfig" | "BestROI" | "BestLocation" | "BestTimeline" | "GoldenVisa" | "RentalYield" | "CapitalAppreciation" | "Upgrade";
  pitch: string;
}

export interface OpportunityDiscovery {
  upsellOpportunity: string | null;
  crossSellOpportunity: string | null;
  referralOpportunity: string | null;
  revivalOpportunity: string | null;
  commercialOpportunity: string | null;
  bestOpportunityToAct: string | null;
}

export interface RevivalIntelligence {
  isWorthAttempting: boolean;
  confidence: number;
  reason: string;
  angle: string | null;
  suggestedMessage: string | null;
  bestRevivalTiming: string | null;
}

export interface SalesDirectorTest {
  whatWouldIDoNext: string;
  why: string;
  whatToAbsolutelyAvoid: string;
  fastestPathToResponse: string;
  fastestPathToMeeting: string;
  fastestPathToSiteVisit: string;
  fastestPathToClosure: string;
  shouldLalitPersonallyIntervene: boolean;
  lalitInterventionReason: string | null;
}

export interface WCRIntelligenceScore {
  total: number;
  breakdown: {
    realEstateUnderstanding: number;
    dubaiUnderstanding: number;
    indiaUnderstanding: number;
    investorUnderstanding: number;
    psychologyUnderstanding: number;
    followUpQuality: number;
    closingIntelligence: number;
  };
  explanation: string;
  strongestArea: string;
  weakestArea: string;
}

export interface AutomationItem {
  status: "Possible" | "PartiallyPossible" | "NotRecommended";
  explanation: string;
}

export interface AutomationAssessment {
  whatsAppReading: AutomationItem;
  whatsAppDrafting: AutomationItem;
  whatsAppReplySuggestions: AutomationItem;
  emailAutomation: AutomationItem;
  aiCalling: AutomationItem;
  hindiCalling: AutomationItem;
  englishCalling: AutomationItem;
  hinglishCalling: AutomationItem;
  meetingBooking: AutomationItem;
  siteVisitBooking: AutomationItem;
}

export interface CapabilityDiscovery {
  additionalCapabilities: Array<{
    capability: string;
    businessValue: string;
    feasibility: "High" | "Medium" | "Low";
    implementationComplexity: "Simple" | "Moderate" | "Complex";
  }>;
  biggestOpportunity: string;
}

export interface ManagementInsights {
  deservesSeniorAttention: boolean;
  seniorAttentionReason: string | null;
  isLowPriority: boolean;
  lowPriorityReason: string | null;
  conversionRank: "Top" | "High" | "Average" | "Low";
  needsEscalation: boolean;
  escalationReason: string | null;
  estimatedDaysToClose: number | null;
}

export interface IntelligenceResult {
  summary: IntelligenceSummary;
  clientUnderstanding: ClientUnderstanding;
  requirementAnalysis: RequirementAnalysis;
  bantIntelligence: BANTIntelligence;
  whyNotClosed: WhyNotClosed;
  closingProbability: ClosingProbability;
  humanPsychology: HumanPsychology;
  effortRecommendation: EffortRecommendation;
  nextBestAction: NextBestAction;
  callStrategy: CallStrategy;
  whatsAppDraft: string;
  emailDraft: EmailDraft;
  projectRecommendations: ProjectRecommendation[];
  opportunityDiscovery: OpportunityDiscovery;
  revivalIntelligence: RevivalIntelligence;
  salesDirectorTest: SalesDirectorTest;
  wcrIntelligenceScore: WCRIntelligenceScore;
  capabilityDiscovery: CapabilityDiscovery;
  automationAssessment: AutomationAssessment;
  managementInsights: ManagementInsights;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abbreviation dictionary shared across all model prompts
// ─────────────────────────────────────────────────────────────────────────────

const ABBREVIATIONS = `
SV = Site Visit | VM = Virtual Meeting | OM = Office Meeting | F2F = Face to Face
RTM = Ready To Move | EOI = Expression Of Interest | CP = Channel Partner
Inv = Investor | Enduse = End User | NRP = Not Responding | DSH = Details Shared
WA = WhatsApp | BHK = Bedroom Hall Kitchen | Cr = Crore (10M INR) | L = Lakh (100K INR)
M = Million | AED = UAE Dirham | INR = Indian Rupee | HNI = High Net Worth Individual
NRI = Non-Resident Indian | BANT = Budget Authority Need Timeline
`;

// ─────────────────────────────────────────────────────────────────────────────
// Universal system prompt — identical for Claude, GPT, and Gemini
// ─────────────────────────────────────────────────────────────────────────────

export const INTELLIGENCE_SYSTEM_PROMPT = `You are being evaluated as a candidate to become the permanent AI brain of White Collar Realty CRM — a Dubai + India luxury property investment firm targeting HNI Indian investors.

You will analyze a complete lead profile and produce strategic sales intelligence.

## Your Role
You are simultaneously acting as:
- Dubai Luxury Real Estate Sales Director
- India Luxury Real Estate Sales Director
- Investor Advisor & Psychologist
- Sales Coach & Closing Specialist
- Lead Qualification Expert

## Context
- White Collar Realty sells Dubai and Gurgaon/NCR luxury properties
- Clients: HNI Indians, NRIs, Investors seeking Dubai Golden Visa, rental yield, capital appreciation
- Average ticket size: AED 1M–10M (Dubai), ₹3Cr–50Cr (India)
- The sales team uses this CRM daily. Your output must be immediately actionable.

## Abbreviation Dictionary
${ABBREVIATIONS}

## Critical Rules
1. Be SPECIFIC — reference actual quotes, dates, and facts from the conversation data
2. Never give generic advice — everything must be tailored to THIS exact client
3. If data is insufficient for a section, say so explicitly rather than inventing
4. WhatsApp/email drafts must use the client's real name and actual situation discussed
5. Drafts must sound human and natural, not template-like
6. For the WCR Intelligence Score — rate your OWN performance on this analysis honestly
7. For Automation Assessment — evaluate YOUR OWN capabilities as an AI system
8. Return ONLY valid JSON. No markdown. No text outside JSON.

## Output JSON Schema
Return exactly this structure (all fields required):

{
  "summary": {
    "whoIsClient": "string",
    "whatTheyWant": "string",
    "whatHappenedSoFar": "string",
    "buyingJourneyStage": "Awareness|Consideration|Evaluation|DecisionPending|ReadyToBook|Stalled|Dormant",
    "oneLinerVerdict": "string — one sentence summary of this lead's situation"
  },
  "clientUnderstanding": {
    "clientType": "Investor|EndUser|NRI|HNI|FamilyBuyer|CommercialBuyer|Broker|ChannelPartner|Unknown",
    "profession": "string|null",
    "businessProfile": "string|null",
    "investmentMaturity": "FirstTimer|Experienced|Seasoned|Portfolio|Unknown",
    "existingPortfolio": "string|null",
    "familyInvolvement": "string|null",
    "decisionMakers": ["string"],
    "authorityStructure": "string",
    "keyPersonalityTrait": "string|null"
  },
  "requirementAnalysis": {
    "budget": { "value": "string|null", "confidence": 0, "source": "string|null" },
    "configuration": { "value": "string|null", "confidence": 0, "source": "string|null" },
    "propertyType": "string|null",
    "preferredLocation": "string|null",
    "purpose": "Investment|EndUse|HolidayHome|RentalIncome|CapitalAppreciation|Mixed|Unknown",
    "readyOrOffPlan": "Ready|OffPlan|Both|NoPreference|Unknown",
    "timeline": { "value": "string|null", "confidence": 0, "source": "string|null" },
    "unstatedPreferences": ["string"]
  },
  "bantIntelligence": {
    "budget": { "score": "Strong|Moderate|Weak|Unknown", "confidence": 0, "amount": "string|null", "source": "string|null" },
    "authority": { "score": "Strong|Moderate|Weak|Unknown", "confidence": 0, "whoDecides": "string|null", "source": "string|null" },
    "need": { "score": "Strong|Moderate|Weak|Unknown", "confidence": 0, "description": "string|null", "source": "string|null" },
    "timeline": { "score": "Strong|Moderate|Weak|Unknown", "confidence": 0, "when": "string|null", "source": "string|null" },
    "overallBANT": "Qualifies|UnderReview|NotQualified",
    "bantVerdict": "string"
  },
  "whyNotClosed": {
    "biggestBlocker": "string",
    "hiddenObjection": "string|null",
    "missingInformation": ["string"],
    "buyingTrigger": "string|null",
    "delayReason": "string|null"
  },
  "closingProbability": {
    "classification": "VeryHigh|High|Medium|Low|Dead",
    "percentage": 0,
    "reasoning": "string",
    "positiveSignals": ["string"],
    "negativeSignals": ["string"]
  },
  "humanPsychology": {
    "buyingSignals": ["string"],
    "trustSignals": ["string"],
    "delaySignals": ["string"],
    "fearSignals": ["string"],
    "familyInfluence": "string|null",
    "decisionMakingBehavior": "Fast|Methodical|Emotional|Analytical|Collaborative|Unknown",
    "emotionalTriggers": ["string"],
    "overallPsychProfile": "string",
    "howToInfluence": "string"
  },
  "effortRecommendation": {
    "level": "HighEffort|MediumEffort|LowEffort|LongTermNurture|NoEffort",
    "reasoning": "string",
    "followUpFrequency": "string",
    "recommendedOwnership": "Agent|Manager|SalesDirector|TeamLead",
    "escalationNeeded": false,
    "escalationReason": "string|null"
  },
  "nextBestAction": {
    "action": "Call|WhatsApp|Email|OfficeMeeting|VirtualMeeting|SiteVisit|LongTermFollowUp|Revival",
    "reasoning": "string",
    "urgency": "Immediate|Today|ThisWeek|NextWeek|NextMonth",
    "specificInstructions": "string",
    "openingLine": "string — exact first sentence to say/send"
  },
  "callStrategy": {
    "objective": "string — the ONE goal for next call",
    "openingLine": "string — exact opening",
    "talkingPoints": ["string"],
    "questionsToAsk": ["string"],
    "objectionsToHandle": ["string"],
    "closingLine": "string"
  },
  "whatsAppDraft": "string — personalized, uses client name and actual situation, max 3 sentences",
  "emailDraft": {
    "subject": "string",
    "body": "string",
    "cta": "string"
  },
  "projectRecommendations": [
    {
      "projectName": "string",
      "matchReason": "string",
      "angle": "BestBudget|BestConfig|BestROI|BestLocation|BestTimeline|GoldenVisa|RentalYield|CapitalAppreciation|Upgrade",
      "pitch": "string — how to present this project to THIS client"
    }
  ],
  "opportunityDiscovery": {
    "upsellOpportunity": "string|null",
    "crossSellOpportunity": "string|null",
    "referralOpportunity": "string|null",
    "revivalOpportunity": "string|null",
    "commercialOpportunity": "string|null",
    "bestOpportunityToAct": "string|null"
  },
  "revivalIntelligence": {
    "isWorthAttempting": true,
    "confidence": 0,
    "reason": "string",
    "angle": "string|null",
    "suggestedMessage": "string|null",
    "bestRevivalTiming": "string|null"
  },
  "salesDirectorTest": {
    "whatWouldIDoNext": "string — if you were the Sales Director, exactly what would you do",
    "why": "string",
    "whatToAbsolutelyAvoid": "string",
    "fastestPathToResponse": "string — exact tactic to get this client to respond",
    "fastestPathToMeeting": "string",
    "fastestPathToSiteVisit": "string",
    "fastestPathToClosure": "string",
    "shouldLalitPersonallyIntervene": false,
    "lalitInterventionReason": "string|null"
  },
  "wcrIntelligenceScore": {
    "total": 0,
    "breakdown": {
      "realEstateUnderstanding": 0,
      "dubaiUnderstanding": 0,
      "indiaUnderstanding": 0,
      "investorUnderstanding": 0,
      "psychologyUnderstanding": 0,
      "followUpQuality": 0,
      "closingIntelligence": 0
    },
    "explanation": "string — honest self-assessment of the quality of THIS analysis",
    "strongestArea": "string",
    "weakestArea": "string"
  },
  "capabilityDiscovery": {
    "additionalCapabilities": [
      {
        "capability": "string — e.g. AI Calling, WhatsApp Automation, Deal Forecasting",
        "businessValue": "string — specific value for White Collar Realty",
        "feasibility": "High|Medium|Low",
        "implementationComplexity": "Simple|Moderate|Complex"
      }
    ],
    "biggestOpportunity": "string — the single most valuable AI automation opportunity for WCR"
  },
  "automationAssessment": {
    "whatsAppReading": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "whatsAppDrafting": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "whatsAppReplySuggestions": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "emailAutomation": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "aiCalling": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "hindiCalling": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "englishCalling": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "hinglishCalling": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "meetingBooking": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" },
    "siteVisitBooking": { "status": "Possible|PartiallyPossible|NotRecommended", "explanation": "string" }
  },
  "managementInsights": {
    "deservesSeniorAttention": false,
    "seniorAttentionReason": "string|null",
    "isLowPriority": false,
    "lowPriorityReason": "string|null",
    "conversionRank": "Top|High|Average|Low",
    "needsEscalation": false,
    "escalationReason": "string|null",
    "estimatedDaysToClose": null
  }
}`;
