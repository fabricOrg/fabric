import type { MessageDefinitionState } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Card } from "@app/ui/components/ui/card";
import Link from "next/link";
import { DefinitionActions } from "./definition-actions";

const STATUS_STYLE: Record<string, string> = {
  active: "border-transparent bg-success/12 text-success",
  draft: "border-transparent bg-muted text-muted-foreground",
  archived: "border-transparent bg-muted text-muted-foreground",
};

interface SmsContent {
  body: string;
  class: string;
}
interface EmailContent {
  subject: string;
  from?: string;
}

/**
 * One definition in the list: identity, lifecycle, a glance at the content, and its quick actions.
 *
 * Deliberately NOT the whole object. This card previously carried the code snippet, an interactive
 * live-preview with variable inputs, segmentation/cost badges, a recipient-eligibility checker and
 * three buttons — so a list of five definitions rendered five copies of a working tool and nothing
 * could be compared at a glance. The tools moved to the definition's own page; scanning and drilling
 * in are different jobs.
 *
 * The body keeps its `{{tokens}}` unrendered on purpose: that IS the definition. Filling sample values
 * is an interactive act, and doing it here would depict a message nobody sent.
 *
 * The WHOLE card is clickable, via a stretched link rather than by wrapping the card in an `<a>`. The
 * anchor covers the card with `after:absolute after:inset-0`, so the hit area is the card while the
 * markup stays valid — an action menu nested inside an anchor is not, and the browser resolves that
 * ambiguity by navigating on the way to the button, which made the menu items unreachable. The menu
 * then sits above the overlay on its own stacking context.
 */
export function DefinitionSummaryCard({
  state,
  applicationSlug,
  canWrite,
  canPublish,
}: {
  state: MessageDefinitionState;
  applicationSlug: string;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const { definition, latest_version, releases } = state;
  const sender = state.sender_bindings[0]?.sender_id;
  const sms = latest_version?.channel === "sms";
  const content = latest_version?.content as unknown as
    | SmsContent
    | EmailContent
    | undefined;
  const body = sms
    ? ((content as SmsContent | undefined)?.body ?? "")
    : ((content as EmailContent | undefined)?.subject ?? "");
  const query = applicationSlug
    ? `?application=${encodeURIComponent(applicationSlug)}`
    : "";
  // Name WHICH version is released, not merely that one is. "v2 · Released to sandbox" read as "v2 is
  // serving" while the release still pointed at v1 — and the Publish control right below it stayed
  // enabled, so the card contradicted its own buttons.
  const released = releases[0];
  const releaseLabel = !released
    ? "Not released"
    : released.version_id === latest_version?.id
      ? "Released to sandbox"
      : "Draft — an earlier version serves sandbox";

  return (
    <Card className="group relative gap-3 px-4 py-4 transition-colors hover:border-foreground/25">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/message-definitions/${encodeURIComponent(definition.key)}${query}`}
          className="min-w-0 rounded outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 className="truncate font-mono font-semibold leading-tight group-hover:underline">
            {definition.key}
          </h3>
          <p className="text-muted-foreground text-sm">
            {latest_version ? `v${latest_version.version}` : "no version"} ·{" "}
            {releaseLabel}
          </p>
        </Link>
        {/* Above the stretched link so the menu is reachable, not navigated past. */}
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <Badge variant="outline" className={STATUS_STYLE[definition.status]}>
            {definition.status}
          </Badge>
          {canWrite ? (
            <DefinitionActions
              state={state}
              canPublish={canPublish}
              applicationSlug={applicationSlug}
              variant="menu"
            />
          ) : null}
        </div>
      </div>

      {latest_version ? (
        <>
          <p className="line-clamp-2 text-sm">{body}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{latest_version.channel}</Badge>
            <Badge variant="secondary">{latest_version.default_locale}</Badge>
            {sms ? (
              <>
                <Badge variant="secondary">
                  {(content as SmsContent | undefined)?.class}
                </Badge>
                <Badge variant="secondary">
                  Sender: {sender ?? "Not bound"}
                </Badge>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          No version authored yet.
        </p>
      )}
    </Card>
  );
}
