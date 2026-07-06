import { Badge } from "@app/ui/components/ui/badge";
import { COUNTRY_LABEL, type RecipientReport } from "@/lib/send/preflight";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border bg-muted/30 px-3 py-2">
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${tone ?? ""}`}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Recipient hygiene at a glance: what we'll actually send to, and what we filtered out + why. */
export function RecipientReportView({ report }: { report: RecipientReport }) {
  const countries = (["GH", "NG", "other"] as const).filter(
    (c) => report.byCountry[c] > 0,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Sendable"
          value={report.sendable.length}
          tone="text-success"
        />
        {report.invalid > 0 ? (
          <Stat
            label="Invalid"
            value={report.invalid}
            tone="text-destructive"
          />
        ) : null}
        {report.duplicates > 0 ? (
          <Stat label="Duplicates removed" value={report.duplicates} />
        ) : null}
        {report.suppressed.length > 0 ? (
          <Stat
            label="DND-skipped"
            value={report.suppressed.length}
            tone="text-warning-strong"
          />
        ) : null}
      </div>
      {countries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {countries.map((c) => (
            <Badge
              key={c}
              variant="secondary"
              className="font-normal tabular-nums"
            >
              {COUNTRY_LABEL[c]} · {report.byCountry[c]}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
