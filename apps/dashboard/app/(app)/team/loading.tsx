import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function TeamLoading() {
  return (
    <RouteLoading
      title="Team"
      description="Members and their roles in this organisation."
      variant="table"
      rows={4}
    />
  );
}
