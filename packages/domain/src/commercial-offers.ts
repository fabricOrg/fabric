/**
 * Exact deferred-revenue allocation for a fixed-total commercial offer (ADR-0012).
 *
 * The math deliberately knows nothing about SMS, email, voice, or any other channel. It allocates
 * consideration over the channel's registered natural units using bigint arithmetic only.
 */

export interface CommercialOfferRecognitionInput {
  readonly totalPriceMinor: bigint;
  readonly totalUnits: bigint;
  readonly consumedBefore: bigint;
  readonly quantity: bigint;
}

function assertValidPosition(
  totalPriceMinor: bigint,
  totalUnits: bigint,
  consumed: bigint,
): void {
  if (totalPriceMinor <= 0n) {
    throw new RangeError("totalPriceMinor must be greater than zero");
  }
  if (totalUnits <= 0n) {
    throw new RangeError("totalUnits must be greater than zero");
  }
  if (consumed < 0n || consumed > totalUnits) {
    throw new RangeError("consumed units must be between zero and totalUnits");
  }
}

/** Revenue allocated through a cumulative unit position, rounded down using exact bigint division. */
export function recognizedThroughCommercialOffer(
  totalPriceMinor: bigint,
  totalUnits: bigint,
  consumed: bigint,
): bigint {
  assertValidPosition(totalPriceMinor, totalUnits, consumed);
  return (totalPriceMinor * consumed) / totalUnits;
}

/** The exact incremental revenue for one committed consumption allocation from a single offer lot. */
export function allocateCommercialOfferRecognition(
  input: CommercialOfferRecognitionInput,
): bigint {
  if (input.quantity <= 0n) {
    throw new RangeError("quantity must be greater than zero");
  }
  const consumedAfter = input.consumedBefore + input.quantity;
  const before = recognizedThroughCommercialOffer(
    input.totalPriceMinor,
    input.totalUnits,
    input.consumedBefore,
  );
  const after = recognizedThroughCommercialOffer(
    input.totalPriceMinor,
    input.totalUnits,
    consumedAfter,
  );
  return after - before;
}
