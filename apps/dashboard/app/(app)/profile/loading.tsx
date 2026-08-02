import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function ProfileLoading() {
  return (
    <RouteLoading
      title="Profile"
      description="Your identity and workspace access."
      variant="rows"
      rows={3}
    />
  );
}
