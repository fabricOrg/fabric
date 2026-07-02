import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Wallet } from "lucide-react";

export default function WalletPage() {
  return (
    <Empty className="mx-auto max-w-2xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Wallet />
        </EmptyMedia>
        <EmptyTitle>Wallet &amp; Billing</EmptyTitle>
        <EmptyDescription>
          A product-neutral account section (not nested under SMS): balances per
          currency, top-up, the double-entry transaction ledger, and low-balance
          alerts. Lands in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
