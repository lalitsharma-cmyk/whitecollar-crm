import { requireUser } from "@/lib/auth";
import StatusModuleView from "@/components/StatusModuleView";
import { LEASE_OFF_STATUSES } from "@/lib/lead-statuses";

export const dynamic = "force-dynamic";

export default async function LeaseOffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  return (
    <StatusModuleView
      me={me} sp={sp} statusSet={LEASE_OFF_STATUSES}
      label="Lease Off" icon="🔑" moduleKey="lease-off"
      emptyHint="No lease/rent-out clients yet. Set a lead's status to 'Leasing' or 'Rent Out' and it appears here."
    />
  );
}
