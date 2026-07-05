"use client";

import "@xyflow/react/dist/style.css";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { useSidebar } from "@app/ui/components/ui/sidebar";
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { Info, Plus, RotateCcw, Save, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Inspector, type NodePatch } from "@/components/journeys/inspector";
import { JourneyNodeCard } from "@/components/journeys/journey-node";
import { DND_MIME, Palette } from "@/components/journeys/palette";
import {
  branchLabels,
  clearJourney,
  type JourneyEdge,
  type JourneyNode,
  loadJourney,
  NODE_META,
  type NodeKind,
  SAMPLE_JOURNEY,
  saveJourney,
  validateJourney,
} from "@/lib/journeys/schema";

const nodeTypes = {
  trigger: JourneyNodeCard,
  sendSms: JourneyNodeCard,
  sendWhatsApp: JourneyNodeCard,
  sendVoice: JourneyNodeCard,
  sendEmail: JourneyNodeCard,
  verify: JourneyNodeCard,
  wait: JourneyNodeCard,
  waitReply: JourneyNodeCard,
  condition: JourneyNodeCard,
  branch: JourneyNodeCard,
  loop: JourneyNodeCard,
  goal: JourneyNodeCard,
  end: JourneyNodeCard,
};

function makeNode(
  kind: NodeKind,
  position: { x: number; y: number },
): JourneyNode {
  const meta = NODE_META[kind];
  return {
    id: `n-${crypto.randomUUID().slice(0, 8)}`,
    type: kind,
    position,
    data: { kind, label: meta.label, config: { ...meta.defaults } },
  };
}

function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<JourneyNode>(
    SAMPLE_JOURNEY.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<JourneyEdge>(
    SAMPLE_JOURNEY.edges,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const { screenToFlowPosition } = useReactFlow();

  // Give the canvas the whole screen: collapse the app sidebar while the builder is mounted,
  // then restore whatever the user had when they leave. setOpen's identity changes on every toggle
  // (it's a useCallback over `open`), so we pin it in a ref and run this effect exactly once —
  // otherwise re-opening the sidebar would re-trigger the collapse and trap it shut.
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const setSidebarOpenRef = useRef(setSidebarOpen);
  setSidebarOpenRef.current = setSidebarOpen;
  const priorSidebar = useRef(sidebarOpen);
  useEffect(() => {
    const restore = priorSidebar.current;
    setSidebarOpenRef.current(false);
    return () => setSidebarOpenRef.current(restore);
  }, []);

  // Load the saved draft after mount (avoids SSR/hydration mismatch on localStorage).
  useEffect(() => {
    const journey = loadJourney();
    setNodes(journey.nodes);
    setEdges(journey.edges);
  }, [setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      const source = nodes.find((n) => n.id === params.source);
      const labels = source
        ? branchLabels(source.data.kind)
        : { yes: "yes", no: "no" };
      const label =
        params.sourceHandle === "yes"
          ? labels.yes
          : params.sourceHandle === "no"
            ? labels.no
            : undefined;
      setEdges((eds) => addEdge({ ...params, label }, eds));
    },
    [nodes, setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const addNode = useCallback(
    (kind: NodeKind, position: { x: number; y: number }) => {
      const node = makeNode(kind, position);
      setNodes((nds) => nds.concat(node));
      setSelectedId(node.id);
    },
    [setNodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DND_MIME) as NodeKind;
      if (!kind || !NODE_META[kind]) return;
      addNode(
        kind,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [screenToFlowPosition, addNode],
  );

  // Click-to-add (keyboard-accessible, and a fallback where HTML5 drag misbehaves): drop the node
  // near the middle of the current viewport.
  const addAtCenter = useCallback(
    (kind: NodeKind) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNode(kind, position);
    },
    [screenToFlowPosition, addNode],
  );

  const patchNode = useCallback(
    (id: string, patch: NodePatch) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...(patch.label !== undefined ? { label: patch.label } : {}),
                  ...(patch.config ? { config: patch.config } : {}),
                },
              }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [setNodes, setEdges],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const issues = useMemo(
    () => validateJourney({ nodes, edges }),
    [nodes, edges],
  );

  function save() {
    if (saveJourney({ nodes, edges }))
      toast.success("Journey saved", {
        description:
          "Draft stored locally. It won't run until the engine ships.",
      });
    else toast.error("Couldn't save the journey");
  }

  function reset() {
    clearJourney();
    setNodes(SAMPLE_JOURNEY.nodes);
    setEdges(SAMPLE_JOURNEY.edges);
    setSelectedId(null);
    toast.success("Reset to the sample journey");
  }

  return (
    <div
      role="application"
      aria-label="Journey canvas — drop steps here"
      className="relative h-[calc(100vh-7rem)] min-h-[30rem] w-full overflow-hidden rounded-xl border bg-muted/20"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow<JourneyNode, JourneyEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        nodeTypes={nodeTypes}
        colorMode="system"
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls className="!bottom-4 !left-4" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            NODE_META[(n.data as JourneyNode["data"]).kind]
              ? "var(--color-primary)"
              : "var(--color-muted-foreground)"
          }
        />
      </ReactFlow>

      {/* Floating toolbar */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card/90 px-2 py-1.5 shadow-sm backdrop-blur">
          <Button
            variant={paletteOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPaletteOpen((v) => !v)}
          >
            <Plus data-icon="inline-start" />
            Steps
          </Button>
          <span className="px-1 font-display text-sm font-semibold">
            Journeys
          </span>
          <Badge variant="secondary" className="tabular-nums">
            {nodes.length} steps
          </Badge>
          <Badge variant="secondary" className="tabular-nums">
            {edges.length} links
          </Badge>
          {issues.length > 0 ? (
            <Badge
              variant="outline"
              className="border-warning/40 text-warning-strong tabular-nums"
            >
              {issues.length} issue{issues.length === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-success/40 text-success">
              Valid
            </Badge>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border bg-card/90 px-2 py-1.5 shadow-sm backdrop-blur">
          <Badge
            variant="outline"
            className="gap-1 border-warning/40 text-warning-strong"
            title="This defines a journey; it doesn't run yet. Scheduling, waits, retries and live sends are a separate build, so Publish is disabled."
          >
            <Info className="size-3" />
            Draft
          </Badge>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={save}>
            <Save data-icon="inline-start" />
            Save
          </Button>
          <Button size="sm" disabled title="Execution engine not wired yet">
            <Upload data-icon="inline-start" />
            Publish
          </Button>
        </div>
      </div>

      {/* Palette — slides in from the left */}
      <div
        className={`absolute left-3 top-16 z-10 w-56 rounded-xl border bg-card p-3 shadow-lg transition-transform duration-200 ${
          paletteOpen ? "translate-x-0" : "-translate-x-[130%]"
        }`}
      >
        <Palette onAdd={addAtCenter} />
      </div>

      {/* Inspector — slides in from the right when a node is selected */}
      <div
        className={`absolute right-3 top-16 bottom-4 z-10 flex w-72 flex-col rounded-xl border bg-card shadow-lg transition-transform duration-200 ${
          selectedNode ? "translate-x-0" : "translate-x-[130%]"
        }`}
      >
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-medium">Configure step</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setSelectedId(null)}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <Inspector
            node={selectedNode}
            onChange={patchNode}
            onDelete={deleteNode}
          />
        </div>
      </div>
    </div>
  );
}

/** Journey builder — the authoring canvas. Wrapped in the provider so the canvas can use hooks. */
export function JourneyCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
