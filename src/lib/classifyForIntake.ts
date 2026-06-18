import { prisma } from "@/lib/prisma";
import { classifyLead, type ClassifySignals, type Classification } from "@/lib/leadClassifier";

// Loads the ACTIVE Project Master and classifies a NEW inbound lead. Routing
// reads ONLY from the Project table (the master) — no hardcoded project names.
// Add/activate a project there and routing picks it up automatically.
export async function classifyForIntake(signals: ClassifySignals): Promise<Classification> {
  const projects = await prisma.project.findMany({
    where: { active: true },
    select: { name: true, city: true, country: true },
  });
  return classifyLead(signals, projects);
}
