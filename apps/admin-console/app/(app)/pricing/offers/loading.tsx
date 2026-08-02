import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function OffersLoading() {
  return (
    <RouteLoading
      title="Prepaid packages"
      description="Fixed quantities for a fixed total price. A published version can never be edited — clone it to change terms."
      variant="cards"
      rows={3}
    />
  );
}
