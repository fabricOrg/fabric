import "server-only";

import {
  autoTopupResponseSchema,
  commercialOfferPurchaseReceiptSchema,
  customerCommercialOfferCatalogSchema,
  messageDetailResponse,
  messageListResponse,
  paymentMethodResponseSchema,
  tokenBalancesResponseSchema,
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

export async function getSavedPaymentMethod() {
  return paymentMethodResponseSchema.parse(
    await unwrap(dashboardApi("/v1/wallet/payment-method", "wallet:read")),
  );
}

export async function getAutoTopup() {
  return autoTopupResponseSchema.parse(
    await unwrap(dashboardApi("/v1/wallet/auto-topup", "wallet:read")),
  );
}

export async function getCommercialOfferCatalog() {
  return customerCommercialOfferCatalogSchema.parse(
    await unwrap(dashboardApi("/v1/tokens/catalog", "wallet:read")),
  );
}

export async function getTokenBalances() {
  return tokenBalancesResponseSchema.parse(
    await unwrap(dashboardApi("/v1/tokens", "wallet:read")),
  );
}

export async function getCommercialOfferPurchaseReceipt(reference: string) {
  return commercialOfferPurchaseReceiptSchema.parse(
    await unwrap(
      dashboardApi(
        `/v1/tokens/purchases/${encodeURIComponent(reference)}`,
        "wallet:read",
      ),
    ),
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
