import type { AppDb } from "@app/db";
import type { RateTable } from "@app/domain";
import type { Creds, MessageStatus, SmsSenderPlugin } from "@app/integrations";
import type { ManagedSendContext } from "./managed-send.js";

export interface EngineDeps {
  db: AppDb;
  provider: SmsSenderPlugin;
  creds?: Creds;
  rates?: RateTable;
}

export interface SendInput {
  tenantId: string;
  messageId?: string;
  applicationId?: string | null;
  environmentId?: string | null;
  to: string;
  senderId: string;
  body: string;
  currency: string;
  subjectId?: string;
  bodyPiiId?: string;
  deliveryMode?: "virtual" | "live";
  managed?: ManagedSendContext;
}

export interface PreparedSend {
  messageId: string;
  encoding: "gsm7" | "ucs2";
  segments: number;
  replayed?: boolean;
}

export interface SendResult {
  messageId: string;
  status: MessageStatus;
}
