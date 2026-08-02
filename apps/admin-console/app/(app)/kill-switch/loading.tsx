import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function KillSwitchLoading() {
  return (
    <RouteLoading
      title="Kill-switch"
      description="Operational switches over live traffic. Every change needs a reason and is audited."
      variant="cards"
      rows={3}
    />
  );
}
