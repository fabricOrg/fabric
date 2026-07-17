import type { ReactNode } from "react";
import { DefinitionPermissionsProvider } from "@/components/message-definitions/definition-permissions";
import { requireDashboardSession } from "@/lib/server/auth";

export default async function TemplatesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireDashboardSession();
  return (
    <DefinitionPermissionsProvider
      canWrite={session.permissions.includes("definitions:write")}
    >
      {children}
    </DefinitionPermissionsProvider>
  );
}
