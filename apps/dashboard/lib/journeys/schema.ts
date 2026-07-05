// Journey (messaging flow) model — the authoring surface only. A journey is a graph of nodes +
// edges the user drags together to DEFINE a multi-step messaging automation.
//
// SCOPE: this is mock-first authoring. There is NO execution runtime yet — saving a journey stores
// the definition (localStorage today; /v1/journeys later), it does NOT run it. Running a journey =
// sending real SMS/WhatsApp + durable scheduling/retries, which is a separate large backend epic and
// a human-gated action (real money/messages). "Publish" is intentionally inert until that exists.
// TODO(contracts): promote NodeKind + JourneyConfig to a discriminated union in @app/contracts and
// share it with the future execution engine so the canvas and the runtime validate the SAME shape.

import type { Edge, Node } from "@xyflow/react";
import {
  CircleStop,
  Clock,
  Filter,
  GitBranch,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Repeat,
  Reply,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";

export type NodeKind =
  | "trigger"
  | "sendSms"
  | "sendWhatsApp"
  | "sendVoice"
  | "sendEmail"
  | "verify"
  | "wait"
  | "waitReply"
  | "condition"
  | "branch"
  | "loop"
  | "goal"
  | "end";

/** Loose string map for the mock. TODO(contracts): replace with a per-kind discriminated union. */
export type JourneyConfig = Record<string, string>;

export interface JourneyNodeData extends Record<string, unknown> {
  readonly kind: NodeKind;
  readonly label: string;
  readonly config: JourneyConfig;
}

export type JourneyNode = Node<JourneyNodeData>;
export type JourneyEdge = Edge;

export interface Journey {
  readonly nodes: JourneyNode[];
  readonly edges: JourneyEdge[];
}

export interface NodeKindMeta {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
  /** Token classes for the node's icon chip — reuse the app palette. */
  readonly accent: string;
  readonly hasInput: boolean;
  /** "single" = one bottom output; "branch" = delivered/else; "none" = terminal. */
  readonly outputs: "single" | "branch" | "none";
  readonly defaults: JourneyConfig;
}

export const NODE_META: Record<NodeKind, NodeKindMeta> = {
  trigger: {
    label: "Trigger",
    icon: Zap,
    description: "Starts the journey",
    accent: "bg-primary/12 text-primary",
    hasInput: false,
    outputs: "single",
    defaults: { event: "api_event" },
  },
  sendSms: {
    label: "Send SMS",
    icon: MessageSquare,
    description: "Send an SMS message",
    accent: "bg-primary/12 text-primary",
    hasInput: true,
    outputs: "single",
    defaults: { senderId: "Fabric", body: "Hi {{name}}, …" },
  },
  sendWhatsApp: {
    label: "Send WhatsApp",
    icon: MessageCircle,
    description: "Send a WhatsApp message",
    accent: "bg-success/15 text-success",
    hasInput: true,
    outputs: "single",
    defaults: { template: "order_update", body: "Your order is on the way." },
  },
  sendVoice: {
    label: "Send Voice",
    icon: Phone,
    description: "Place a voice call",
    accent: "bg-gold-subtle text-gold-ink",
    hasInput: true,
    outputs: "single",
    defaults: { script: "Hello, this is a call from Fabric." },
  },
  sendEmail: {
    label: "Send Email",
    icon: Mail,
    description: "Send an email",
    accent: "bg-muted text-muted-foreground",
    hasInput: true,
    outputs: "single",
    defaults: { subject: "Update from Fabric", body: "Hi {{name}}, …" },
  },
  verify: {
    label: "Verify",
    icon: ShieldCheck,
    description: "Send + check an OTP",
    accent: "bg-gold-subtle text-gold-ink",
    hasInput: true,
    outputs: "branch",
    defaults: { channel: "sms" },
  },
  wait: {
    label: "Wait",
    icon: Clock,
    description: "Pause for a fixed time",
    accent: "bg-muted text-muted-foreground",
    hasInput: true,
    outputs: "single",
    defaults: { duration: "1", unit: "days" },
  },
  waitReply: {
    label: "Wait for reply",
    icon: Reply,
    description: "Pause until they reply",
    accent: "bg-muted text-muted-foreground",
    hasInput: true,
    outputs: "branch",
    defaults: { timeout: "24", unit: "hours" },
  },
  condition: {
    label: "Condition",
    icon: Filter,
    description: "Split on contact data",
    accent: "bg-primary/12 text-primary",
    hasInput: true,
    outputs: "branch",
    defaults: { attribute: "country", equals: "GH" },
  },
  branch: {
    label: "Branch",
    icon: GitBranch,
    description: "Split on delivery outcome",
    accent: "bg-gold-subtle text-gold-ink",
    hasInput: true,
    outputs: "branch",
    defaults: { condition: "delivered" },
  },
  loop: {
    label: "Loop",
    icon: Repeat,
    description: "Repeat until done",
    accent: "bg-primary/12 text-primary",
    hasInput: true,
    outputs: "branch",
    defaults: { mode: "count", count: "3" },
  },
  goal: {
    label: "Goal",
    icon: Target,
    description: "Mark a conversion + exit",
    accent: "bg-success/15 text-success",
    hasInput: true,
    outputs: "none",
    defaults: { name: "Converted" },
  },
  end: {
    label: "End",
    icon: CircleStop,
    description: "Ends this path",
    accent: "bg-muted text-muted-foreground",
    hasInput: true,
    outputs: "none",
    defaults: {},
  },
};

/** Nodes offered in the palette (Trigger is seeded, not dragged in repeatedly). */
export const PALETTE_KINDS: readonly NodeKind[] = [
  "sendSms",
  "sendWhatsApp",
  "sendVoice",
  "sendEmail",
  "verify",
  "wait",
  "waitReply",
  "condition",
  "branch",
  "loop",
  "goal",
  "end",
];

/** One-line summary of a node's config for the card + minimap. */
export function summarize(data: JourneyNodeData): string {
  const c = data.config;
  switch (data.kind) {
    case "trigger":
      return c.event === "contact_added"
        ? "When a contact is added"
        : c.event === "inbound_message"
          ? "On inbound message"
          : "On API event";
    case "sendSms":
      return c.body ? `“${c.body.slice(0, 40)}”` : "No message yet";
    case "sendWhatsApp":
      return c.template ? `Template: ${c.template}` : "WhatsApp";
    case "sendVoice":
      return c.script ? `“${c.script.slice(0, 34)}”` : "Voice call";
    case "sendEmail":
      return c.subject ? `Subject: ${c.subject}` : "Email";
    case "verify":
      return `Verify via ${c.channel ?? "sms"}`;
    case "wait":
      return `Wait ${c.duration ?? "1"} ${c.unit ?? "days"}`;
    case "waitReply":
      return `Reply within ${c.timeout ?? "24"} ${c.unit ?? "hours"}`;
    case "condition":
      return `If ${c.attribute ?? "attribute"} = ${c.equals ?? "…"}`;
    case "branch":
      return `If ${c.condition ?? "delivered"}`;
    case "loop":
      return c.mode === "until"
        ? `Until ${c.condition ?? "condition"}`
        : `Repeat ${c.count ?? "3"}×`;
    case "goal":
      return c.name ? `Goal: ${c.name}` : "Conversion";
    case "end":
      return "Path ends";
    default:
      return "";
  }
}

/** The two labelled outputs for branching kinds. */
export function branchLabels(kind: NodeKind): { yes: string; no: string } {
  switch (kind) {
    case "verify":
      return { yes: "verified", no: "failed" };
    case "waitReply":
      return { yes: "replied", no: "timeout" };
    case "condition":
      return { yes: "match", no: "else" };
    case "loop":
      return { yes: "loop", no: "done" };
    default:
      return { yes: "yes", no: "no" };
  }
}

// A seeded example so the canvas isn't blank on first load — the classic order→delivery journey.
export const SAMPLE_JOURNEY: Journey = {
  nodes: [
    {
      id: "n-trigger",
      type: "trigger",
      position: { x: 0, y: 120 },
      data: {
        kind: "trigger",
        label: "Order placed",
        config: { event: "api_event" },
      },
    },
    {
      id: "n-confirm",
      type: "sendSms",
      position: { x: 260, y: 120 },
      data: {
        kind: "sendSms",
        label: "Order confirmation",
        config: {
          senderId: "Fabric",
          body: "Hi {{name}}, order {{ref}} is confirmed.",
        },
      },
    },
    {
      id: "n-branch",
      type: "branch",
      position: { x: 520, y: 120 },
      data: {
        kind: "branch",
        label: "Delivered?",
        config: { condition: "delivered" },
      },
    },
    {
      id: "n-wait",
      type: "wait",
      position: { x: 780, y: 20 },
      data: {
        kind: "wait",
        label: "Wait 1 day",
        config: { duration: "1", unit: "days" },
      },
    },
    {
      id: "n-followup",
      type: "sendWhatsApp",
      position: { x: 1040, y: 20 },
      data: {
        kind: "sendWhatsApp",
        label: "Delivery update",
        config: { template: "delivery_update", body: "On its way!" },
      },
    },
    {
      id: "n-end",
      type: "end",
      position: { x: 780, y: 240 },
      data: { kind: "end", label: "End", config: {} },
    },
  ],
  edges: [
    { id: "e1", source: "n-trigger", target: "n-confirm" },
    { id: "e2", source: "n-confirm", target: "n-branch" },
    {
      id: "e3",
      source: "n-branch",
      sourceHandle: "yes",
      target: "n-wait",
      label: "delivered",
    },
    { id: "e4", source: "n-wait", target: "n-followup" },
    {
      id: "e5",
      source: "n-branch",
      sourceHandle: "no",
      target: "n-end",
      label: "no",
    },
  ],
};

const STORAGE_KEY = "fabric.journeys.draft.v1";

export function loadJourney(): Journey {
  if (typeof window === "undefined") return SAMPLE_JOURNEY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return SAMPLE_JOURNEY;
    const parsed = JSON.parse(raw) as Journey;
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges))
      return parsed;
    return SAMPLE_JOURNEY;
  } catch {
    return SAMPLE_JOURNEY;
  }
}

export function saveJourney(journey: Journey): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journey));
    return true;
  } catch {
    return false;
  }
}

export function clearJourney(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export interface ValidationIssue {
  readonly nodeId: string | null;
  readonly message: string;
}

/** Light structural validation — the kind of feedback the runtime will later enforce hard. */
export function validateJourney(journey: Journey): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const triggers = journey.nodes.filter((n) => n.data.kind === "trigger");
  if (triggers.length === 0)
    issues.push({
      nodeId: null,
      message: "No trigger — the journey can't start.",
    });
  if (triggers.length > 1)
    issues.push({ nodeId: null, message: "More than one trigger." });

  const hasOutgoing = new Set(journey.edges.map((e) => e.source));
  const hasIncoming = new Set(journey.edges.map((e) => e.target));

  for (const node of journey.nodes) {
    const meta = NODE_META[node.data.kind];
    if (meta.outputs !== "none" && !hasOutgoing.has(node.id))
      issues.push({
        nodeId: node.id,
        message: `“${node.data.label}” has no next step.`,
      });
    if (meta.hasInput && !hasIncoming.has(node.id))
      issues.push({
        nodeId: node.id,
        message: `“${node.data.label}” is unreachable.`,
      });
    if (node.data.kind === "sendSms" && !node.data.config.body)
      issues.push({
        nodeId: node.id,
        message: `“${node.data.label}” has no message body.`,
      });
  }
  return issues;
}
