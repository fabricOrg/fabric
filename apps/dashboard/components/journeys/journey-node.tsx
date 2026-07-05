import { cn } from "@app/ui/lib/utils";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  branchLabels,
  type JourneyNode,
  NODE_META,
  summarize,
} from "@/lib/journeys/schema";

/** One card renderer for every node kind — styling + handles keyed off data.kind. */
export function JourneyNodeCard({ data, selected }: NodeProps<JourneyNode>) {
  const meta = NODE_META[data.kind];
  const Icon = meta.icon;
  const branching = meta.outputs === "branch";
  const labels = branchLabels(data.kind);

  return (
    <div
      className={cn(
        "w-52 rounded-xl border bg-card shadow-sm transition-shadow",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      {meta.hasInput ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!size-2 !border-2 !border-background !bg-muted-foreground"
        />
      ) : null}

      <div className="flex items-start gap-2.5 p-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            meta.accent,
          )}
        >
          <Icon aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {meta.label}
          </span>
          <span className="truncate text-sm font-medium leading-tight">
            {data.label}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {summarize(data)}
          </span>
        </div>
      </div>

      {meta.outputs === "single" ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!size-2 !border-2 !border-background !bg-primary"
        />
      ) : null}

      {branching ? (
        <div className="flex justify-between px-4 pb-1 text-[10px] text-muted-foreground">
          <span>{labels.yes}</span>
          <span>{labels.no}</span>
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            style={{ left: "25%" }}
            className="!size-2 !border-2 !border-background !bg-success"
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            style={{ left: "75%" }}
            className="!size-2 !border-2 !border-background !bg-destructive"
          />
        </div>
      ) : null}
    </div>
  );
}
