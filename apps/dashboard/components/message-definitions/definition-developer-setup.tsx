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

export function DefinitionDeveloperSetup({
  applicationName,
}: {
  applicationName: string;
}) {
  return (
    <section className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-medium">Typed developer setup</h2>
        <p className="text-sm text-muted-foreground">
          Use a sandbox key for {applicationName} with only definitions:read.
          The key selects this application and environment; it is never written
          to generated code.
        </p>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {DEFINITION_COMMANDS.map((command) => (
          <div key={command.label}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
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
    </section>
  );
}
