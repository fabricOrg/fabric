import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function StaffLoading() {
  return (
    <RouteLoading
      title="Staff"
      description="Platform operators. Access is by email allowlist — they sign in with a matching WorkOS identity."
      variant="table"
      rows={4}
    />
  );
}
