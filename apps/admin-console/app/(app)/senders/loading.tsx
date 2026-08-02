import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function SendersLoading() {
  return (
    <RouteLoading
      title="Sender IDs"
      description="Carrier/NCA review of customer sender-id registrations. Activation is the delivery gate for live traffic."
      variant="table"
      rows={6}
    />
  );
}
