// §12 — Revival Engine lives at /cold-calls (the existing page).
// This route just redirects so /revival-engine URLs work too.
import { redirect } from "next/navigation";

export default function RevivalEnginePage() {
  redirect("/cold-calls");
}
