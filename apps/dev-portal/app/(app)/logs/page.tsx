import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { ScrollText } from "lucide-react";

export default function Page() {
  return (
    <Empty className="mx-auto max-w-2xl border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ScrollText />
        </EmptyMedia>
        <EmptyTitle>Logs</EmptyTitle>
        <EmptyDescription>
          Recent API requests — method, status, request ID, latency — with a
          request/response detail drawer — lands in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
