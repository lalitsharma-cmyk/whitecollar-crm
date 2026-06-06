// Pipeline (stage-based kanban) has been removed.
// The CRM now uses Status-only workflow. Redirect to /leads.
import { redirect } from "next/navigation";

export default function PipelinePage() {
  redirect("/leads");
}
