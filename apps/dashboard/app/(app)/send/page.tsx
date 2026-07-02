import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Send } from "lucide-react";

export default function SendPage() {
  return (
    <Empty className="mx-auto max-w-2xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Send />
        </EmptyMedia>
        <EmptyTitle>Send SMS</EmptyTitle>
        <EmptyDescription>
          The compose flow — recipient, sender ID, and a live segment + cost
          meter with the insufficient-balance guard — lands in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
