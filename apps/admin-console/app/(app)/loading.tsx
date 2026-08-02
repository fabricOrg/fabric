import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function TenantsLoading() {
  return (
    <RouteLoading
      title="Tenants"
      description="Every customer organisation on Fabric. Accounts soft-close — never hard-delete."
      variant="table"
      rows={6}
    />
  );
}
