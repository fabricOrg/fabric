import { z } from "zod";

const eligibilityCode = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:-]+$/);

export const commercialOfferEligibilitySchema = z
  .object({
    destination_countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(250)
      .default([]),
    traffic_classes: z.array(eligibilityCode).max(50).default([]),
    provider_vendors: z.array(eligibilityCode).max(50).default([]),
    service_classes: z.array(eligibilityCode).max(50).default([]),
  })
  .strict();
export type CommercialOfferEligibility = z.infer<
  typeof commercialOfferEligibilitySchema
>;

/**
 * Which eligibility dimensions a channel's SEND PATH can actually supply when it draws a token lot.
 *
 * A restriction the send path cannot answer is not a narrower offer — it is an unspendable one. The
 * lot filter requires the hold's value to be present in the stored list, so an email item restricted
 * to `GH` matches nothing, forever: the customer is charged, every send silently bills the wallet
 * instead, and the stranded allocation is finally recognized as breakage we keep. Refusing the
 * authoring is the only place this stays honest.
 *
 * `service_classes` is absent everywhere on purpose — provider costs are not recorded per service
 * class, so the publish gate refuses it separately as unpriceable.
 */
export const CHANNEL_SUPPORTED_ELIGIBILITY: Readonly<
  Record<string, readonly (keyof CommercialOfferEligibility)[]>
> = {
  // prepare-send carries the full rated route off the pricing snapshot.
  sms: ["provider_vendors", "destination_countries", "traffic_classes"],
  // The email path supplies only the resolved provider; it has no rated destination, and its
  // traffic class is a fixed literal rather than a routed value.
  email: ["provider_vendors"],
};

/** Conservative default for a registry channel with no declared capability yet. */
const DEFAULT_SUPPORTED_ELIGIBILITY: readonly (keyof CommercialOfferEligibility)[] =
  ["provider_vendors"];

/** The eligibility dimensions this channel's send path can match a lot on. Never empty. */
export function supportedEligibilityDimensions(
  channelCode: string,
): readonly (keyof CommercialOfferEligibility)[] {
  return (
    CHANNEL_SUPPORTED_ELIGIBILITY[channelCode] ?? DEFAULT_SUPPORTED_ELIGIBILITY
  );
}

/** The dimensions this item restricts by that its channel's send path cannot satisfy. */
export function unsupportedEligibilityDimensions(
  channelCode: string,
  eligibility: Readonly<
    Record<keyof CommercialOfferEligibility, readonly string[]>
  >,
): (keyof CommercialOfferEligibility)[] {
  const supported = supportedEligibilityDimensions(channelCode);
  return (
    ["destination_countries", "traffic_classes", "provider_vendors"] as const
  ).filter(
    (dimension) =>
      eligibility[dimension].length > 0 && !supported.includes(dimension),
  );
}

/**
 * The route dimensions provider costs are actually recorded against. Authoring restricts eligibility
 * to these values rather than free text, because a dimension with no matching rate is refused at
 * publish (`offer_cost_basis_missing`) — offering it as an option would only invite that failure.
 */
export const commercialRouteVocabularySchema = z.object({
  provider_vendors: z.array(eligibilityCode),
  destination_countries: z.array(z.string().regex(/^[A-Z]{2}$/)),
  traffic_classes: z.array(eligibilityCode),
});
export type CommercialRouteVocabulary = z.infer<
  typeof commercialRouteVocabularySchema
>;
