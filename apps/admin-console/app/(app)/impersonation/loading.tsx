import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function ImpersonationLoading() {
  return (
    <RouteLoading
      title="Impersonation"
      description="View the product as a tenant for support and debugging. Time-boxed, never silent, always audited."
      variant="rows"
      rows={3}
    />
  );
}
