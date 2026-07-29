import { z } from "zod";
import { money } from "./money.js";

export const overviewChannel = z.enum(["sms", "whatsapp", "voice", "verify"]);
export type OverviewChannel = z.infer<typeof overviewChannel>;

export const overviewActivity = z.object({
  id: z.string(),
  kind: z.enum(["message", "campaign", "topup"]),
  label: z.string(),
  at: z.string(),
  status: z.string(),
});
export type OverviewActivity = z.infer<typeof overviewActivity>;

export const overviewChannelSpend = z.object({
  channel: overviewChannel,
  spend: money,
});
export type OverviewChannelSpend = z.infer<typeof overviewChannelSpend>;

export const overviewTrafficPoint = z.object({
  /** ISO UTC date. */
  date: z.string(),
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
});
export type OverviewTrafficPoint = z.infer<typeof overviewTrafficPoint>;

export const overviewResponse = z.object({
  messagesSent: z.number().int().nonnegative(),
  deliveryRate: z.number().min(0).max(1),
  spendThisMonth: money,
  walletBalance: money,
  traffic: z.array(overviewTrafficPoint),
  spendByChannel: z.array(overviewChannelSpend),
  recentActivity: z.array(overviewActivity),
});
export type OverviewResponse = z.infer<typeof overviewResponse>;
