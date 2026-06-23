"use client";

import { useId, useMemo, useState } from "react";
import { COUNTRY_NAMES, statesForCountry, citiesForState } from "@/lib/locationData";

// Cascading Country -> State/Province -> City picker with FREE typing everywhere.
//
// Each field is a plain <input> bound to a <datalist>, so:
//   • the dropdown SUGGESTS curated options (full India coverage + key feeders),
//   • the user can ALSO type any value not in the list (manual entry),
//   • selecting/typing a Country narrows the State suggestions, and a State
//     narrows the City suggestions (the cascade), while never blocking a custom
//     state/city for an unknown country.
//
// Pure client component — the dataset (locationData.ts) is static and bundled,
// so no Prisma / server-only import crosses the boundary. Renders three (or four
// incl. address) hidden-free <input> fields the server action reads by name.
//
// Re-usable: the New-Lead form mounts it twice (customer address + WCR-Event
// location) with different `names`. useId() keeps the two datalists unique.

export interface LocationNames {
  country: string;
  state: string;
  city: string;
  /** Optional — when set, an Address line renders after City. */
  address?: string;
}

interface Props {
  names: LocationNames;
  /** Pre-fill (edit/restore). */
  defaults?: Partial<Record<"country" | "state" | "city" | "address", string>>;
  /** Field label prefix, e.g. "Event " → "Event Country". Default "". */
  labelPrefix?: string;
  /** Tailwind class for each <input>. */
  inputClassName?: string;
  /** Tailwind class for each <label>. */
  labelClassName?: string;
  /** When true, lay the fields out in a responsive grid wrapper. Default true. */
  grid?: boolean;
}

const DEFAULT_INPUT = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const DEFAULT_LABEL = "text-xs font-semibold text-gray-600";

export default function LocationSelect({
  names,
  defaults,
  labelPrefix = "",
  inputClassName = DEFAULT_INPUT,
  labelClassName = DEFAULT_LABEL,
  grid = true,
}: Props) {
  const uid = useId().replace(/[:]/g, "");
  const [country, setCountry] = useState(defaults?.country ?? "");
  const [state, setState] = useState(defaults?.state ?? "");
  const [city, setCity] = useState(defaults?.city ?? "");

  const stateOptions = useMemo(() => statesForCountry(country), [country]);
  const cityOptions = useMemo(() => citiesForState(country, state), [country, state]);

  const countryListId = `loc-country-${uid}`;
  const stateListId = `loc-state-${uid}`;
  const cityListId = `loc-city-${uid}`;

  const fields = (
    <>
      <div>
        <label className={labelClassName}>{labelPrefix}Country</label>
        <input
          name={names.country}
          className={inputClassName}
          list={countryListId}
          value={country}
          autoComplete="off"
          onChange={(e) => {
            const v = e.target.value;
            setCountry(v);
            // Clearing/changing the country drops a now-irrelevant state/city
            // ONLY when they no longer belong to the new country's curated set.
            // We keep whatever the user typed if it still matches (or if the
            // country is custom / unknown, we leave their entries untouched).
            if (statesForCountry(v).length && state && !statesForCountry(v).some((s) => s.toLowerCase() === state.toLowerCase())) {
              setState("");
              setCity("");
            }
          }}
          placeholder=""
        />
        <datalist id={countryListId}>
          {COUNTRY_NAMES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div>
        <label className={labelClassName}>{labelPrefix}State / Province</label>
        <input
          name={names.state}
          className={inputClassName}
          list={stateListId}
          value={state}
          autoComplete="off"
          onChange={(e) => {
            const v = e.target.value;
            setState(v);
            if (citiesForState(country, v).length && city && !citiesForState(country, v).some((ct) => ct.toLowerCase() === city.toLowerCase())) {
              setCity("");
            }
          }}
          placeholder=""
        />
        <datalist id={stateListId}>
          {stateOptions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      <div>
        <label className={labelClassName}>{labelPrefix}City</label>
        <input
          name={names.city}
          className={inputClassName}
          list={cityListId}
          value={city}
          autoComplete="off"
          onChange={(e) => setCity(e.target.value)}
          placeholder=""
        />
        <datalist id={cityListId}>
          {cityOptions.map((ct) => (
            <option key={ct} value={ct} />
          ))}
        </datalist>
      </div>

      {names.address && (
        <div className={grid ? "md:col-span-3" : undefined}>
          <label className={labelClassName}>{labelPrefix}Address</label>
          <input
            name={names.address}
            className={inputClassName}
            defaultValue={defaults?.address ?? ""}
            autoComplete="off"
            placeholder=""
          />
        </div>
      )}
    </>
  );

  if (!grid) return fields;

  return (
    <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
      {fields}
    </div>
  );
}
