"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@app/ui/components/ui/sheet";
import { Terminal } from "lucide-react";
import { CopyButton } from "@/components/copy-button";

export const DEFINITION_COMMANDS = [
  {
    label: "Install",
    value:
      "pnpm add @fabric-messaging/sdk && pnpm add -D @fabric-messaging/cli",
  },
  {
    label: "Generate",
    value: "pnpm exec fabric definitions generate",
  },
  {
    label: "Check in CI",
    value: "pnpm exec fabric definitions check",
  },
] as const;

/**
 * The SDK/CLI onboarding commands, behind a drawer rather than pinned across the top of the page.
 *
 * They are read ONCE per project and then never again, while the definitions list is why anyone opens
 * this screen daily — so as a permanent banner they charged every visit to serve the first one. The
 * drawer keeps the page about the business objects and the commands one click away.
 */
export function DefinitionDeveloperSetup({
  applicationName,
}: {
  applicationName: string;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Terminal data-icon="inline-start" />
          Developer setup
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Typed developer setup</SheetTitle>
          <SheetDescription>
            Use a sandbox key for {applicationName} with only definitions:read.
            The key selects this application and environment; it is never
            written to generated code.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          {DEFINITION_COMMANDS.map((command) => (
            <div key={command.label}>
              <p className="mb-1 font-medium text-muted-foreground text-xs">
                {command.label}
              </p>
              <div className="flex items-center gap-1 rounded-lg bg-muted p-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs">
                  {command.value}
                </code>
                <CopyButton
                  value={command.value}
                  ariaLabel={`Copy ${command.label} command`}
                  toastLabel={`${command.label} command copied`}
                />
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
