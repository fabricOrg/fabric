import { EraseSubjectPanel } from "@/components/privacy/erase-subject-panel";
import { requireAdminSession } from "@/lib/server/auth";

/**
 * DSR console (COMPLIANCE §6). Where a "delete my data" request actually gets actioned — without
 * this, crypto-shred erasure is a capability nobody can invoke.
 */
export default async function PrivacyPage() {
  const session = await requireAdminSession();
  const canErase = session.permissions.includes("staff:write");

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Data-subject requests
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Look up what personal data a workspace holds on a phone number, and
          action a right-to-erasure request. Erasure destroys that person&apos;s
          encryption key: their number and message bodies become permanently
          unreadable, while the wallet ledger and delivery history stay intact.
        </p>
      </div>
      <EraseSubjectPanel canErase={canErase} />
    </div>
  );
}
