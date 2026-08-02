import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function MessageDeliveriesLoading() {
  return (
    <RouteLoading
      title="Managed deliveries"
      description="Every send by stable key: one durable delivery per Idempotency-Key, with its status, exact cost, and reference."
      variant="table"
      rows={6}
    />
  );
}
