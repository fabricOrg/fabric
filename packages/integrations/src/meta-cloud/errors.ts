export class MetaCloudError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly param?: string,
  ) {
    super(message);
    this.name = "MetaCloudError";
  }
}
