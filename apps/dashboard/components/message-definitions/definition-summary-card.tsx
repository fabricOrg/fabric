import type { MessageDefinitionState } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import {
  ResourceBadge,
  ResourceCard,
  ResourceMetric,
} from "@app/ui/components/ui/resource-card";
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
  const { definition, latest_version } = state;
  const query = applicationSlug
    ? `?application=${encodeURIComponent(applicationSlug)}`
    : "";
  const content = latest_version?.content as unknown as
    | SmsContent
    | EmailContent
    | undefined;
  const sms = latest_version?.channel === "sms";
  const preview = sms
    ? ((content as SmsContent | undefined)?.body ?? "")
    : ((content as EmailContent | undefined)?.subject ?? "");
  const releaseLabel = releaseStatus(state);

  return (
    <ResourceCard
      title={
        <Link
          href={`/message-definitions/${encodeURIComponent(definition.key)}${query}`}
          className="rounded font-mono outline-none after:absolute after:inset-0 after:content-[''] group-hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {definition.key}
        </Link>
      }
      status={
        <Badge variant="outline" className={STATUS_STYLE[definition.status]}>
          {definition.status}
        </Badge>
      }
      meta={
        latest_version
          ? `v${latest_version.version} · ${releaseLabel}`
          : releaseLabel
      }
      description={latest_version ? preview : "No version authored yet."}
      action={
        canWrite ? (
          <DefinitionActions
            state={state}
            canPublish={canPublish}
            applicationSlug={applicationSlug}
            variant="menu"
          />
        ) : null
      }
      metrics={
        latest_version ? (
          <>
            <ResourceMetric
              label="Channel"
              value={<ResourceBadge>{latest_version.channel}</ResourceBadge>}
            />
            <ResourceMetric
              label="Locale"
              value={
                <ResourceBadge>{latest_version.default_locale}</ResourceBadge>
              }
            />
            {sms ? (
              <>
                <ResourceMetric
                  label="Class"
                  value={
                    <ResourceBadge>
                      {(content as SmsContent | undefined)?.class ?? "Unset"}
                    </ResourceBadge>
                  }
                />
                <ResourceMetric
                  label="Sender"
                  value={
                    <ResourceBadge>
                      {state.sender_bindings[0]?.sender_id ?? "Not bound"}
                    </ResourceBadge>
                  }
                />
              </>
            ) : null}
          </>
        ) : null
      }
    />
  );
}

function releaseStatus(state: MessageDefinitionState): string {
  const latest = state.latest_version;
  const released = state.releases[0];
  if (!latest) return "No version";
  if (!released) return "Not released";
  if (released.version_id === latest.id) return "Released to sandbox";
  return "Earlier version serves sandbox";
}
