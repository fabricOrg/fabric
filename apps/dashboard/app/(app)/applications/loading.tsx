import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function ApplicationsLoading() {
  return (
    <RouteLoading
      title="Applications"
      description="Each application groups your API keys, webhooks, and logs, and carries a sandbox and a live environment."
      variant="cards"
      rows={3}
    />
  );
}
