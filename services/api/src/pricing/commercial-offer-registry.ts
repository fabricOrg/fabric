import type {
  CommercialOfferChannelDto,
  CommercialRouteVocabulary,
} from "@app/contracts";
import {
  commercialOfferChannels,
  type ProvisioningDb,
  providerCostRates,
} from "@app/db";
import { asc } from "drizzle-orm";

type Db = ProvisioningDb["db"];

/**
 * The distinct route dimensions provider costs exist for. Authoring picks from these, so a staff
 * member cannot invent a vendor or destination the margin gate would then refuse. NULL columns are
 * wildcard rates ("any destination"), which contribute no value to pick from.
 */
export async function listRouteVocabulary(
  db: Db,
): Promise<CommercialRouteVocabulary> {
  const rows = await db
    .selectDistinct({
      channel: providerCostRates.channel,
      providerVendor: providerCostRates.providerVendor,
      destinationCountry: providerCostRates.destinationCountry,
      trafficClass: providerCostRates.trafficClass,
    })
    .from(providerCostRates);
  // NULL destination/traffic columns are wildcard rates ("any"); they name no value to pick from.
  const add = (target: string[], value: string | null): void => {
    if (value !== null && !target.includes(value)) target.push(value);
  };
  const vocabulary: CommercialRouteVocabulary = {};
  for (const row of rows) {
    let entry = vocabulary[row.channel];
    if (!entry) {
      entry = {
        provider_vendors: [],
        destination_countries: [],
        traffic_classes: [],
      };
      vocabulary[row.channel] = entry;
    }
    add(entry.provider_vendors, row.providerVendor);
    add(entry.destination_countries, row.destinationCountry);
    add(entry.traffic_classes, row.trafficClass);
  }
  for (const entry of Object.values(vocabulary)) {
    entry.provider_vendors.sort();
    entry.destination_countries.sort();
    entry.traffic_classes.sort();
  }
  return vocabulary;
}

export async function listChannelRegistry(
  db: Db,
): Promise<CommercialOfferChannelDto[]> {
  const rows = await db
    .select()
    .from(commercialOfferChannels)
    .orderBy(
      asc(commercialOfferChannels.code),
      asc(commercialOfferChannels.unitCode),
    );
  return rows.map((row) => ({
    code: row.code,
    unit_code: row.unitCode,
    display_name: row.displayName,
    unit_label: row.unitLabel,
    is_active: row.isActive,
  }));
}
