import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function StaffProfileLoading() {
  return (
    <RouteLoading
      title="Profile"
      description="Your staff identity and access level."
      variant="rows"
      rows={3}
    />
  );
}
