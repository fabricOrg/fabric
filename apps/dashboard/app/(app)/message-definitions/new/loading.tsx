import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function NewMessageDefinitionLoading() {
  return (
    <RouteLoading title="New message definition" variant="rows" rows={5} />
  );
}
