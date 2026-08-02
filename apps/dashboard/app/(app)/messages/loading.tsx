import { RouteLoading } from "@app/ui/components/ui/route-loading";

export default function MessagesLoading() {
  return (
    <RouteLoading
      title="Messages"
      description="Every send, its delivery status, and the analytics behind them."
      variant="table"
      rows={6}
    />
  );
}
