import { GoLiveCard } from "@/components/go-live/go-live-card";
import { requireDashboardSession } from "@/lib/server/auth";

/**
 * Go-live (ADR-0002 F4): the compliance gate lives HERE, not at sign-up. A sandbox workspace
 * submits business info; staff review in the admin console (maker-checker queue); approval flips
 * the plan — live keys + real provider routing unlock.
 */
export default async function GoLivePage() {
  const session = await requireDashboardSession();
  const canRequest = session.role === "owner" || session.role === "admin";
  const isSandbox = session.plan === "sandbox";
  return (
    <div className="w-full">
      <h1 className="text-2xl font-semibold tracking-tight">Go live</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sandbox workspaces route every message to the test provider. Going live
        unlocks live API keys and real delivery after a compliance review.
      </p>
      <div className="mt-6">
        <GoLiveCard canRequest={canRequest} isSandbox={isSandbox} />
      </div>
    </div>
  );
}
