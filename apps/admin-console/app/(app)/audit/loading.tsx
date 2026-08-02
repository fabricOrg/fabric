import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function AuditLoading() {
  return (
    <RouteLoading
      title="Audit log"
      description="Immutable record of every staff action — actor, action, and reason."
      variant="table"
      rows={6}
    />
  );
}
