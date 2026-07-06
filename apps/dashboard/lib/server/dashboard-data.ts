import "server-only";

import {
  messageDetailResponse,
  messageListResponse,
  walletSnapshot,
} from "@app/contracts";
import { BffError, dashboardApi } from "./api-client";

async function unwrap<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof BffError) throw error.payload;
    throw error;
  }
}

export async function getWalletSnapshot() {
  return walletSnapshot.parse(
    await unwrap(dashboardApi("/v1/wallet", "wallet:read")),
  );
}

export async function getMessageList() {
  return messageListResponse.parse(
    await unwrap(dashboardApi("/v1/messages", "sms:read")),
  );
}

export async function getMessageDetail(id: string) {
  return messageDetailResponse.parse(
    await unwrap(dashboardApi(`/v1/sms/${encodeURIComponent(id)}`, "sms:read")),
  );
}
