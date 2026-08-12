import { messageChannel, type PriceBookRateDto } from "@app/contracts";

/**
 * Which channel rows a book's rate grid shows, in a stable order.
 *
 * Extracted from the grid so it can be tested without a DOM: the defect this replaced was a
 * hardcoded `["sms", "email"]` row list, which silently dropped a WhatsApp rate that WAS saved. The
 * order comes from the contract enum, so a channel the backend accepts cannot be missing here.
 */
export function visibleChannels(
  rates: readonly Pick<PriceBookRateDto, "channel">[],
): PriceBookRateDto["channel"][] {
  return messageChannel.options.filter((channel) =>
    rates.some((rate) => rate.channel === channel),
  );
}
