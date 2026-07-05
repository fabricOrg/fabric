import { cn } from "@app/ui/lib/utils";
import { NODE_META, type NodeKind, PALETTE_KINDS } from "@/lib/journeys/schema";

/** The MIME key the canvas reads in onDrop. */
export const DND_MIME = "application/x-fabric-node";

/** Node source list. Drag a step onto the canvas, or click to drop it at the center. */
export function Palette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Steps
      </span>
      {PALETTE_KINDS.map((kind) => (
        <PaletteItem key={kind} kind={kind} onAdd={onAdd} />
      ))}
      <p className="mt-1 px-1 text-xs text-muted-foreground">
        Drag a step onto the canvas — or click to add — then connect the dots.
      </p>
    </div>
  );
}

function PaletteItem({
  kind,
  onAdd,
}: {
  kind: NodeKind;
  onAdd: (kind: NodeKind) => void;
}) {
  const meta = NODE_META[kind];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      draggable
      onClick={() => onAdd(kind)}
      onDragStart={(event) => {
        event.dataTransfer.setData(DND_MIME, kind);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="flex cursor-grab items-center gap-2.5 rounded-lg border bg-card p-2 text-left active:cursor-grabbing hover:border-primary/50"
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5",
          meta.accent,
        )}
      >
        <Icon aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium leading-tight">{meta.label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {meta.description}
        </span>
      </span>
    </button>
  );
}
