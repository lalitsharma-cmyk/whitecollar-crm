"use server";

import { requireUser } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";

// Set the default owner for candidates that arrive from the website HR forms
// (real-time intake). ADMIN only. Empty value = leave incoming candidates
// unassigned.
export async function setHrWebsiteOwner(formData: FormData) {
  const me = await requireUser();
  if (me.role !== "ADMIN") throw new Error("Admins only");
  const userId = String(formData.get("ownerId") ?? "").trim();
  await setSetting("hr.websiteDefaultOwnerId", userId);
  revalidatePath("/hr/settings");
}
