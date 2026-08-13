import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function NewCommercialOfferLoading() {
  return (
    <RouteLoading
      title="New prepaid package"
      description="Define package identity, included credits, price, expiry, and availability."
      variant="rows"
      rows={6}
    />
  );
}
