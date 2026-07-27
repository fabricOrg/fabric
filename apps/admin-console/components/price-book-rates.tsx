import type { PriceBookDto, PriceBookRateDto } from "@app/contracts";

/** Format minor units as a readable amount (e.g. GHS 3 pesewas → "0.03"). */
function formatMinor(minor: string): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return minor;
  return (n / 100).toFixed(2);
}

/** SMS is metered per segment, email flat per send — stated once per row, not once per cell. */
const UNIT: Record<PriceBookRateDto["channel"], string> = {
  sms: "per segment",
  email: "per send",
};

const CHANNEL_LABEL: Record<PriceBookRateDto["channel"], string> = {
  sms: "SMS",
  email: "Email",
};

/**
 * A book's rates as the matrix they actually are: channel down, currency across.
 *
 * The previous rendering was one identical outline badge per rate, so two channels across three
 * currencies became six interchangeable pills wrapping onto two lines — the reader had to parse
 * each one to recover a structure the data already has. A grid also makes a GAP visible: a missing
 * (channel, currency) pair shows as an em dash rather than simply not being there, which matters
 * because publishing a currency requires both channels.
 */
export function PriceBookRates({ rates }: { rates: PriceBookDto["rates"] }) {
  if (rates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No rates configured.</p>
    );
  }

  // Currencies across, in a stable order so two books read the same way side by side.
  const currencies = [...new Set(rates.map((rate) => rate.currency))].sort();
  // Channels down, but only those the book actually prices — an email-less book shows no email row.
  const channels = (["sms", "email"] as const).filter((channel) =>
    rates.some((rate) => rate.channel === channel),
  );
  const priced = new Map(
    rates.map((rate) => [`${rate.channel}:${rate.currency}`, rate]),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-sm border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="w-px whitespace-nowrap py-1 pr-6 text-left font-medium text-muted-foreground">
              <span className="sr-only">Channel</span>
            </th>
            {currencies.map((currency) => (
              <th
                key={currency}
                scope="col"
                className="px-3 py-1 text-right font-medium text-muted-foreground tabular-nums"
              >
                {currency}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <tr key={channel}>
              <th
                scope="row"
                className="whitespace-nowrap py-1 pr-6 text-left font-normal"
              >
                {CHANNEL_LABEL[channel]}
                <span className="ml-2 text-xs text-muted-foreground">
                  {UNIT[channel]}
                </span>
              </th>
              {currencies.map((currency) => {
                const rate = priced.get(`${channel}:${currency}`);
                return (
                  <td
                    key={currency}
                    className="px-3 py-1 text-right tabular-nums"
                  >
                    {rate ? (
                      formatMinor(rate.unit_price_minor)
                    ) : (
                      // Not priced. Shown rather than omitted: publishing a currency needs both
                      // channels, so a hole here is the thing an operator must notice.
                      <span
                        className="text-muted-foreground"
                        title={`No ${CHANNEL_LABEL[channel]} rate for ${currency}`}
                      >
                        —
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
