import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { BookText } from "lucide-react";

export default function Page() {
  return (
    <Empty className="mx-auto max-w-2xl border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookText />
        </EmptyMedia>
        <EmptyTitle>API reference</EmptyTitle>
        <EmptyDescription>
          Endpoint reference with request/response, code samples + language
          switcher, and your test key inlined — lands in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
