export interface DefinitionContract {
  readonly data: object;
  readonly channels: string;
  readonly locales: string;
}

export interface DefinitionCatalog {
  readonly generated: boolean;
  readonly environment: "sandbox" | "live";
  readonly messages: Readonly<Record<string, DefinitionContract>>;
}

export interface UngeneratedCatalog extends DefinitionCatalog {
  readonly generated: false;
  readonly environment: "sandbox" | "live";
  readonly messages: Readonly<
    Record<
      string,
      {
        readonly data: Record<string, unknown>;
        readonly channels: "sms" | "email" | "whatsapp";
        readonly locales: string;
      }
    >
  >;
}

export type CatalogMessageKey<Catalog extends DefinitionCatalog> =
  Catalog["generated"] extends true
    ? Extract<keyof Catalog["messages"], string>
    : string;

export type CatalogPreviewOptions<
  Catalog extends DefinitionCatalog,
  Key extends CatalogMessageKey<Catalog>,
  BaseOptions,
> = Catalog["generated"] extends true
  ? Omit<BaseOptions, "data" | "locale" | "channel"> & {
      readonly data: Catalog["messages"][Key]["data"];
      readonly locale?: Catalog["messages"][Key]["locales"];
      // Narrowed to the key's released channel — asserting a channel the definition doesn't target
      // (e.g. `channel: "email"` on an SMS key) fails to compile (SDK-004-AC02 / SDK-007 AC04).
      readonly channel?: Catalog["messages"][Key]["channels"];
    }
  : BaseOptions;
