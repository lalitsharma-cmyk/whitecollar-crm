"use client";

import { useMemo, useState } from "react";
import AssignToSelect from "@/components/AssignToSelect";
import ProjectSelect from "@/components/ProjectSelect";
import BudgetInput from "@/components/BudgetInput";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { categoryOptionsForTeam } from "@/lib/leadCategory";

// Team-reactive REQUIREMENT block for the New-Lead form. Team is the single
// source of truth, held in React state here, and the dependent fields filter /
// default off it CLIENT-SIDE (the page is a Server Component, so this reactive
// wiring must live in a "use client" island — no function props cross the
// boundary; only serializable arrays come in).
//
// Field order (task 6), exactly:
//   1 Team · 2 Assign To · 3 Interested Properties · 4 Property Type ·
//   5 Configuration · 6 Currency · 7 Budget Min · 8 Budget Max
// (Categorization + Current Status follow as extra optional fields — they bind
// to real columns and were never slated for removal.)
//
// Reactivity:
//   • Assign To   → filters the roster to the selected team (task 7).
//   • Interested Properties → a TRUE searchable combobox (ProjectSelect) showing
//     that team's projects (Dubai vs India), keyboard-navigable, while still
//     accepting + saving a typed custom name (unmatched → sourceDetail server-side).
//   • Currency    → India defaults INR; Dubai defaults AED and may switch to
//     INR (task 10). Budget Min/Max inputs render in the chosen currency.

interface U { id: string; name: string; team: string | null; role: string; isSuperAdmin: boolean; }
interface ProjOption { id: string; name: string; }

interface Props {
  users: U[];
  dubaiProjects: ProjOption[];
  indiaProjects: ProjOption[];
  defaultTeam: string;       // "Dubai" | "India" | ""
  defaultCurrency: string;   // "AED" | "INR"
}

const input = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const label = "text-xs font-semibold text-gray-600";

function currencyForTeam(team: string, fallback: string): string {
  if (team === "India") return "INR";
  if (team === "Dubai") return "AED";
  return fallback;
}

export default function RequirementSection({ users, dubaiProjects, indiaProjects, defaultTeam, defaultCurrency }: Props) {
  const [team, setTeam] = useState(defaultTeam);
  // Currency follows the team but stays user-overridable. We track whether the
  // user has manually picked a currency; until then it auto-derives from team.
  const [currency, setCurrency] = useState(currencyForTeam(defaultTeam, defaultCurrency));
  const [currencyTouched, setCurrencyTouched] = useState(false);

  const effectiveCurrency = currencyTouched ? currency : currencyForTeam(team, defaultCurrency);

  // Currency options: India is INR-only (no AED mixing per market rules); Dubai
  // may pick AED or INR; no team selected yet → offer both.
  const currencyOptions = useMemo(() => {
    if (team === "India") return ["INR"];
    if (team === "Dubai") return ["AED", "INR"];
    return ["AED", "INR"];
  }, [team]);

  // Project suggestions for the selected team. No team → no suggestions yet
  // (the field still accepts free typing).
  const projectOptions = useMemo(() => {
    if (team === "Dubai") return dubaiProjects;
    if (team === "India") return indiaProjects;
    return [] as ProjOption[];
  }, [team, dubaiProjects, indiaProjects]);

  // Buyer-category options are MARKET-SPECIFIC (India must never show UAE-resident
  // categories, and vice-versa). Reactive to team; a stale out-of-market pick is
  // cleared when the market switches (in onTeamChange). (Lalit 2026-06-28)
  const categoryOptions = useMemo(() => categoryOptionsForTeam(team), [team]);
  const [category, setCategory] = useState("");

  function onTeamChange(v: string) {
    setTeam(v);
    // Reset the manual-currency flag so currency re-derives from the new team
    // (e.g. switching India→Dubai flips INR→AED unless they re-pick).
    setCurrencyTouched(false);
    setCurrency(currencyForTeam(v, defaultCurrency));
    // Drop a category that isn't valid for the new market (India ↔ Dubai).
    setCategory((c) => (categoryOptionsForTeam(v).includes(c) ? c : ""));
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
      {/* 1. Team */}
      <div>
        <label className={label}>Team *</label>
        <select
          name="forwardedTeam"
          required
          className={input}
          value={team}
          onChange={(e) => onTeamChange(e.target.value)}
        >
          <option value="">— Select team —</option>
          <option value="Dubai">Dubai</option>
          <option value="India">India</option>
        </select>
      </div>

      {/* 2. Assign To — reactive to team */}
      <div>
        <label className={label}>👤 Assign To *</label>
        <AssignToSelect users={users} initialTeam={team} team={team} />
      </div>

      {/* 3. Interested Properties — TRUE searchable combobox (ProjectSelect):
          team-filtered project list + custom-name typing (saved verbatim). */}
      <div>
        <label className={label}>🏢 Interested Properties</label>
        <ProjectSelect options={projectOptions} team={team} />
        <p className="text-[10px] text-gray-500 mt-0.5">Pick a {team || "team"} property or type a custom name.</p>
      </div>

      {/* 4. Property Type — REQUIRED dropdown (Residential / Commercial / Mixed Use) */}
      <div>
        <label className={label}>Property Type *</label>
        <select name="propertyType" required className={input} defaultValue="">
          <option value="" disabled>— Select property type —</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* 5. Configuration */}
      <div>
        <label className={label}>Configuration</label>
        <input name="configuration" className={input} />
      </div>

      {/* 6. Currency — reactive default, user-overridable */}
      <div>
        <label className={label}>Currency *</label>
        <select
          name="budgetCurrency"
          required
          className={input}
          value={effectiveCurrency}
          onChange={(e) => { setCurrencyTouched(true); setCurrency(e.target.value); }}
        >
          {currencyOptions.map((c) => (
            <option key={c} value={c}>
              {c === "AED" ? "AED (United Arab Emirates)" : "INR (India)"}
            </option>
          ))}
        </select>
      </div>

      {/* 7. Budget Min — in the chosen currency */}
      <div>
        <label className={label}>💰 Budget Min</label>
        <div className="mt-1">
          <BudgetInput name="budgetMin" currency={effectiveCurrency === "INR" ? "INR" : "AED"} />
        </div>
      </div>

      {/* 8. Budget Max — in the chosen currency */}
      <div>
        <label className={label}>💰 Budget Max</label>
        <div className="mt-1">
          <BudgetInput name="budgetMax" currency={effectiveCurrency === "INR" ? "INR" : "AED"} />
        </div>
      </div>

      {/* Extra optional fields (retained — bind to real columns) */}
      <div>
        <label className={label}>Categorization</label>
        <select name="categorization" className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">—</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Current Status</label>
        <input name="currentStatus" className={input} />
      </div>
    </div>
  );
}
