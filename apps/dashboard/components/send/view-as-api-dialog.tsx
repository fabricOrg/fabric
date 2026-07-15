"use client";

import type { MessageClass } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import { Check, Code2, Copy } from "lucide-react";
import { useState } from "react";
import { apiSnippets } from "@/lib/send/preflight";

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <Button size="sm" variant="ghost" onClick={copy}>
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Renders the current composition as the equivalent API request — the manual→programmatic funnel. */
export function ViewAsApiDialog({
  to,
  from,
  body,
  messageClass,
}: {
  to: readonly string[];
  from: string;
  body: string;
  messageClass: MessageClass;
}) {
  const { curl, node } = apiSnippets({ to, from, body, messageClass });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Code2 data-icon="inline-start" />
          View as API call
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send this from your code</DialogTitle>
          <DialogDescription>
            The same message as an API request. Do it once by hand here, then
            automate it — one endpoint for SMS, WhatsApp, and Voice.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Snippet label="cURL" code={curl} />
          <Snippet label="Node.js" code={node} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
