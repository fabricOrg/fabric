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
        readonly channels: "sms";
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
  ? Omit<BaseOptions, "data" | "locale"> & {
      readonly data: Catalog["messages"][Key]["data"];
      readonly locale?: Catalog["messages"][Key]["locales"];
    }
  : BaseOptions;
