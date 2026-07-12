import {
  AuthenticationError,
  Fabric,
  FabricError,
  RateLimitError,
} from "fabric-messaging";

const fabric = new Fabric({
  apiKey: process.env.FABRIC_API_KEY ?? "sk_test_example",
});

try {
  await fabric.sms.list();
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error("Rate limited", {
      retryAfter: error.retryAfter,
      requestId: error.requestId,
    });
  } else if (error instanceof AuthenticationError) {
    console.error("Replace or rotate the API key", {
      requestId: error.requestId,
    });
  } else if (error instanceof FabricError) {
    console.error(error.code, {
      requestId: error.requestId,
      retryable: error.retryable,
    });
  } else {
    throw error;
  }
}
