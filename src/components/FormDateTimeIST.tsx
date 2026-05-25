"use client";
import { useState } from "react";
import DateTimeIST from "./DateTimeIST";

interface Props {
  name: string;
  defaultValue?: string;
  futureOnly?: boolean;
  className?: string;
}

/**
 * Self-contained wrapper around DateTimeIST for use inside server-action forms
 * (like leads/new). Holds its own state and emits a hidden input under `name`
 * so the form submits a single combined "YYYY-MM-DDTHH:mm" IST wall-clock
 * value — server then parses with fromISTLocalInput.
 */
export default function FormDateTimeIST({ name, defaultValue = "", futureOnly = true, className }: Props) {
  const [value, setValue] = useState(defaultValue);
  return (
    <DateTimeIST
      value={value}
      onChange={setValue}
      futureOnly={futureOnly}
      name={name}
      className={className}
    />
  );
}
