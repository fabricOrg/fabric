import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function MakerCheckerLoading() {
  return (
    <RouteLoading
      title="Maker-checker"
      description="Sensitive changes need a second operator to approve."
      variant="rows"
      rows={3}
    />
  );
}
