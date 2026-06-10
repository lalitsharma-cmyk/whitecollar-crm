# White Collar Realty — CRM Branding Consistency Report & Design System
**Date:** 2026-06-10

> Process followed (per the brief): 1) audit website branding → 2) audit CRM
> branding → 3) consistency report → 4) propose design system → 5) implement.
> The public website (whitecollarrealty.com) is behind bot protection (HTTP 403),
> so brand colours are grounded in the **official logo asset**, the **CRM's own
> brand tokens**, and the brief. All three agree on navy + champagne gold.

---

## 1. Website / brand identity (reference)

- **Logo:** a charcoal-black skyline rising from a white-collar suit lapel;
  wordmark **WHITE COLLAR REALTY** (boxed), tagline *"A Tradition of Trust"*.
  Delivered **black on transparent** (designed for light backgrounds).
- **Positioning:** authorised **luxury** real-estate advisory, India + UAE.
  Adjectives: premium, elegant, trustworthy, corporate, high-end.
- **Palette (brand):** deep navy/charcoal base + **champagne gold** accent + ivory.

## 2. Current CRM branding (audit)

| Surface | Current | Verdict |
|---|---|---|
| Brand tokens (`globals.css`) | `--navy #0b1a33`, `--gold #c9a24b / #e7c97a`, ivory | ✅ On-brand bones already exist |
| Main sidebar | navy gradient `#0b1a33→#0f2347`, **gold** left-border active | ✅ Premium |
| Primary button | navy `#0b1a33` | ✅ On-brand |
| Gold button / AI tags / focus rings | gold `#c9a24b` | ✅ On-brand |
| **Login page** | navy gradient + logo forced white via `filter:invert(1)`, plain card | ❌ Logo muddy/unreadable, weak hierarchy |
| **HR sidebar** (`HRShell`) | different navy `#1a2e4a`, white-tint active (no gold) | ⚠ Inconsistent with main CRM |
| Interactive accents in components | many `blue-500/600` (links, "Read More", active filters) | ⚠ Reads "SaaS blue", off-brand |
| Semantic blue (cold-lead chips) | `blue` by design | ✅ Keep (status colour, not brand) |

**Finding:** the CRM is **not** a generic template at its core — it already uses
navy + gold. The "generic SaaS" feeling comes from three concentrated places:
(1) the **login page** (muddy inverted logo, plain card), (2) the **HR sidebar**
using an off-palette navy with no gold, and (3) **bright-blue interactive accents**
leaking into otherwise navy/gold screens.

## 3. Proposed design system (brand-locked)

**Colour roles**
| Role | Token | Hex |
|---|---|---|
| Base / brand ink | navy | `#0b1a33` |
| Base elevated | navy-2 | `#0f2347` |
| **Accent (champagne gold)** | gold | `#c9a24b` |
| Accent light | gold-2 | `#e7c97a` |
| Surface (light) | ivory/white | `#fffdf7` / `#ffffff` |
| Hairline | line | `#e5e7eb` (light) · `#29354f` (dark) |
| Status only | good/warn/hot/cold | green/amber/red/**blue** (semantic, not brand) |

**Rules**
1. **Action = navy**, **accent = gold.** Primary buttons navy; gold for emphasis,
   active states, focus rings, dividers. Gold is a *seasoning*, not a flood.
2. **Replace decorative bright-blue** (links, "Read More", active chips) with
   navy + gold. Keep blue **only** where it encodes a status (cold lead).
3. **One navy.** Everything dark uses `#0b1a33→#0f2347` (retire HR's `#1a2e4a`).
4. **Logo on light, never inverted.** The black logo renders crisp on ivory/white;
   never `filter:invert`. On dark surfaces, frame it inside a light card.
5. **Typography:** uppercase, wide letter-spacing (`0.3em`) gold labels for the
   "luxury real estate" register; clear hierarchy; generous whitespace.

## 4. Implementation status

**Shipped now (this change):**
- ✅ **Login page redesigned** — cinematic navy backdrop with a soft gold glow,
  a gold top-accent bar, an **ivory card holding the real (non-inverted) logo at
  ~2× size** so the brand name is crisp and readable, gold-letterspaced "Client
  Management" divider, refined inputs with gold focus rings, navy CTA with a gold
  arrow, "A Tradition of Trust" treatment. Retina-crisp (vector-like PNG on light),
  mobile-friendly. Forced to the light brand treatment even if the viewer's saved
  theme is dark.
- ✅ **HR sidebar unified** to the brand navy gradient with the **gold active-state**
  (left-border + gold tint), matching the main CRM exactly.

**Proposed next (phased, low-risk, awaiting your go-ahead — not done blindly):**
- ◻ Swap decorative `blue-500/600` → navy/gold across components (links, "Read
  More", active filter chips, inline-edit hints). ~20 components; purely cosmetic.
- ◻ Optional: a serif display face (e.g. Playfair/Cormorant) for headings on the
  login + dashboard hero only, for a stronger "luxury real estate" voice.

Nothing in the "proposed next" list is changed until you approve the direction —
per "do not randomly change colours."
