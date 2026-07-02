import { requireUser } from "@/lib/auth";
import StatusModuleView from "@/components/StatusModuleView";
import { SALE_OFF_STATUSES } from "@/lib/lead-statuses";

export const dynamic = "force-dynamic";

export default async function SaleOffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  return (
    <StatusModuleView
      me={me} sp={sp} statusSet={SALE_OFF_STATUSES}
      label="Sale Off" icon="🏷️" moduleKey="sale-off"
      emptyHint="No clients marked to sell yet. Set a lead's status to 'Sell Out' (Dubai) or 'Sell Off' (India) and it appears here."
    />
  );
}
