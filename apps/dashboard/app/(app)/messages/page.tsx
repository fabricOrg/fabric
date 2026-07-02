import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { List } from "lucide-react";

export default function MessagesPage() {
  return (
    <Empty className="mx-auto max-w-2xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <List />
        </EmptyMedia>
        <EmptyTitle>Messages</EmptyTitle>
        <EmptyDescription>
          The filterable message log with the delivery-timeline drawer (full DLR
          history per message) lands in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
