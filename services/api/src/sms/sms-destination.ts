/**
 * Fabric's initial live market is Ghana and Nigeria. Unknown E.164 prefixes intentionally return
 * undefined so only an explicit wildcard pricing rule can authorize the destination.
 */
export function smsDestinationCountry(
  normalizedRecipient: string,
): "GH" | "NG" | undefined {
  if (normalizedRecipient.startsWith("+233")) return "GH";
  if (normalizedRecipient.startsWith("+234")) return "NG";
  return undefined;
}
