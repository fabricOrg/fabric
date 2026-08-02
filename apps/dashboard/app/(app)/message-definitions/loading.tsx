import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function MessageDefinitionsLoading() {
  return (
    <RouteLoading
      title="Message definitions"
      description="Reusable, versioned message content addressed by a stable key. Author once, publish to sandbox, and send by key from your code."
      variant="table"
      rows={5}
    />
  );
}
