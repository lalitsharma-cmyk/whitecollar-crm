"use client";

// ActionButton — the SOLID / labeled action button of the CRM Action Design
// System. Icon + label + colour + hover + disabled + loading ALL come from the
// central tokens in src/lib/actionDesign.ts, so the same `action` looks identical
// on every page (Lead view, Buyer Data, Action List, Reports, future modules).
//
// VISUAL ONLY — this component owns no business logic. The caller supplies the
// behaviour: pass `onClick` for a <button>, or `href` for an <a> link (tel:,
// wa.me, mailto:, etc.). Endpoints, permissions and conditional rendering stay
// entirely with the caller.
//
//   <ActionButton action="call"     href={telLink(phone)} size="md" />
//   <ActionButton action="logCall"  onClick={() => setShowLog(true)} />
//   <ActionButton action="complete" onClick={doComplete} loading={busy} disabled={busy} />
//   <ActionButton action="whatsapp" href={waLink} label="WA" size="sm" external />
//
// To change how an action looks everywhere, edit the token — never restyle here.

import type { ReactNode, MouseEventHandler, CSSProperties } from "react";
import {
  ACTION_TOKENS,
  ACTION_SIZES,
  ACTION_SOLID_BASE,
  type ActionKey,
  type ActionSize,
} from "@/lib/actionDesign";
import WhatsAppGlyph from "./WhatsAppGlyph";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

interface BaseProps {
  action: ActionKey;
  size?: ActionSize;
  /** Override the token's default label (e.g. "WA" in a tight row). */
  label?: ReactNode;
  /** Hide the label entirely (icon-only, but still using the solid button look). */
  iconOnly?: boolean;
  /** Show a spinner + swap the label for `loadingLabel` while a request runs. */
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  /** Extra classes (layout only — e.g. grow/basis for a flex row). */
  className?: string;
  style?: CSSProperties;
  title?: string;
}

interface ButtonProps extends BaseProps {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  href?: undefined;
  type?: "button" | "submit";
}

interface LinkProps extends BaseProps {
  href: string;
  /** Open in a new tab (adds target=_blank + rel=noopener). */
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export type ActionButtonProps = ButtonProps | LinkProps;

function Spinner({ sizeClass }: { sizeClass: string }) {
  return (
    <svg
      className={cx(sizeClass, "animate-spin")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function ActionButton(props: ActionButtonProps) {
  const {
    action,
    size = "md",
    label,
    iconOnly = false,
    loading = false,
    loadingLabel,
    disabled = false,
    className,
    style,
    title,
  } = props;

  const token = ACTION_TOKENS[action];
  const sz = ACTION_SIZES[size];
  const Icon = token.icon;

  const classes = cx(ACTION_SOLID_BASE, sz.solidSize, token.solid, className);

  const iconNode =
    action === "whatsapp" ? (
      <WhatsAppGlyph className={sz.iconClass} />
    ) : loading ? (
      <Spinner sizeClass={sz.iconClass} />
    ) : (
      <Icon className={sz.iconClass} />
    );

  // When loading on the WhatsApp glyph we still want the spinner; handle that.
  const leading =
    loading && action === "whatsapp" ? <Spinner sizeClass={sz.iconClass} /> : iconNode;

  const text = loading ? loadingLabel ?? "Saving…" : label ?? token.label;
  const resolvedTitle = title ?? token.tooltip;

  const inner = (
    <>
      {leading}
      {!iconOnly && <span>{text}</span>}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    const { href, external, onClick } = props;
    return (
      <a
        href={href}
        onClick={onClick}
        title={resolvedTitle}
        aria-label={iconOnly ? resolvedTitle : undefined}
        className={classes}
        style={style}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {inner}
      </a>
    );
  }

  const { onClick, type = "button" } = props as ButtonProps;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={resolvedTitle}
      aria-label={iconOnly ? resolvedTitle : undefined}
      className={classes}
      style={style}
    >
      {inner}
    </button>
  );
}

export default ActionButton;
