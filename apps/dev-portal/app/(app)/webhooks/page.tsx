import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Webhook } from "lucide-react";

export default function Page() {
  return (
    <Empty className="mx-auto max-w-2xl border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Webhook />
        </EmptyMedia>
        <EmptyTitle>Webhooks</EmptyTitle>
        <EmptyDescription>
          Register delivery-report endpoints, view the signing secret, and send
          a test event to a registered URL — lands in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
