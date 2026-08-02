import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function NewPriceBookLoading() {
  return (
    <RouteLoading
      title="New price book"
      description="A named set of per-channel, per-currency unit prices. Accounts resolve to their assigned book, or the mode default."
      variant="rows"
      rows={4}
    />
  );
}
