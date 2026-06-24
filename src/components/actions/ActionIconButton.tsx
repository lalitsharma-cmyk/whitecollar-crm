"use client";

// ActionIconButton — the ICON-ONLY action control of the CRM Action Design
// System, for dense surfaces: table Action columns, the Smart Timeline, mobile
// quick rows. Icon + colour + tooltip come from the central tokens in
// src/lib/actionDesign.ts so the same `action` is recognisable everywhere.
//
// Two looks, both token-driven:
//   variant="ghost" (default) — tinted icon + soft hover wash, no fill. Matches
//     the existing light table-row icons (e.g. Leads table Actions column).
//   variant="solid" — filled coloured chip (e.g. the 32px Call / WhatsApp chips
//     in Action List / Revival rows).
//
// VISUAL ONLY. Caller supplies behaviour via `onClick` (button) or `href` (link).
// The tooltip is the token's tooltip unless `title` overrides it, and it is also
// the aria-label so the icon-only control stays accessible.
//
//   <ActionIconButton action="call"     href={telLink(phone)} size="sm" />
//   <ActionIconButton action="whatsapp" href={waLink} variant="solid" external />
//   <ActionIconButton action="reject"   onClick={openReject} />

import type { MouseEventHandler, CSSProperties } from "react";
import {
  ACTION_TOKENS,
  ACTION_SIZES,
  ACTION_ICON_BASE,
  type ActionKey,
  type ActionSize,
} from "@/lib/actionDesign";
import WhatsAppGlyph from "./WhatsAppGlyph";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "ghost" | "solid";

interface BaseProps {
  action: ActionKey;
  size?: ActionSize;
  variant?: Variant;
  /** Override the token tooltip (also used as aria-label). */
  title?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

interface ButtonProps extends BaseProps {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  href?: undefined;
  type?: "button" | "submit";
}

interface LinkProps extends BaseProps {
  href: string;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export type ActionIconButtonProps = ButtonProps | LinkProps;

export function ActionIconButton(props: ActionIconButtonProps) {
  const {
    action,
    size = "sm",
    variant = "ghost",
    title,
    disabled = false,
    className,
    style,
  } = props;

  const token = ACTION_TOKENS[action];
  const sz = ACTION_SIZES[size];
  const Icon = token.icon;
  const resolvedTitle = title ?? token.tooltip;

  // Ghost = tinted icon + soft hover. Solid = filled chip + white-ish icon.
  const colour = variant === "solid" ? cx(token.solid, "shadow-sm") : token.ghost;
  const classes = cx(ACTION_ICON_BASE, sz.iconBox, colour, className);

  const iconNode =
    action === "whatsapp" ? (
      <WhatsAppGlyph className={sz.iconClass} />
    ) : (
      <Icon className={sz.iconClass} />
    );

  if ("href" in props && props.href !== undefined) {
    const { href, external, onClick } = props;
    return (
      <a
        href={href}
        onClick={onClick}
        title={resolvedTitle}
        aria-label={resolvedTitle}
        className={classes}
        style={style}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {iconNode}
      </a>
    );
  }

  const { onClick, type = "button" } = props as ButtonProps;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={resolvedTitle}
      aria-label={resolvedTitle}
      className={classes}
      style={style}
    >
      {iconNode}
    </button>
  );
}

export default ActionIconButton;
