import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function PricingLoading() {
  return (
    <RouteLoading
      title="Pricing"
      description="Rate plans priced per channel and currency. Accounts resolve to their assigned book, or the mode default."
      variant="cards"
      rows={3}
    />
  );
}
