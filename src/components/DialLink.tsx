"use client";

// DialLink — a `tel:` anchor that fires the dial beacon, for use INSIDE SERVER
// COMPONENTS.
//
// A Server Component cannot attach an onClick, so it cannot use useDialBeacon()
// directly. Rather than converting a whole server component (and its prisma
// queries) into a client one, drop this tiny client island in place of the raw
// <a href={telLink(...)}> — the surrounding component stays a Server Component.
//
//   <DialLink href={telLink(altPhone)} leadId={leadId} className="btn btn-sm">
//     📞 Call
//   </DialLink>
//
// Behaviour is identical to useDialBeacon: the tap writes a CallLog at
// outcome=INITIATED and NEVER blocks the `tel:` navigation. See
// src/components/useDialBeacon.ts for the full contract.

import type { ReactNode } from "react";
import { useDialBeacon, type DialTarget } from "@/components/useDialBeacon";

interface Props extends DialTarget {
  href: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
}

export default function DialLink({
  href,
  leadId,
  buyerId,
  phone,
  className,
  title,
  children,
  ...rest
}: Props) {
  const dial = useDialBeacon();
  return (
    <a
      href={href}
      onClick={dial({ leadId, buyerId, phone })}
      className={className}
      title={title}
      aria-label={rest["aria-label"]}
    >
      {children}
    </a>
  );
}
