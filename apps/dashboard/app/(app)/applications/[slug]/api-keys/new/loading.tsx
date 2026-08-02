import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function NewApiKeyLoading() {
  return <RouteLoading title="Create key" variant="rows" rows={3} />;
}
