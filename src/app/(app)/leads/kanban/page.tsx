// Kanban view has been removed — stage system no longer exists.
// Redirect to /leads (table view).
import { redirect } from "next/navigation";

export default function KanbanPage() {
  redirect("/leads");
}
