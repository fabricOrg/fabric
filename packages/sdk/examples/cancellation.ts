import { Fabric, UserAbortedError } from "fabric-messaging";

const fabric = new Fabric({
  apiKey: process.env.FABRIC_API_KEY ?? "sk_test_example",
});
const controller = new AbortController();

try {
  await fabric.sms.list({ signal: controller.signal, timeout: 5_000 });
} catch (error) {
  if (!(error instanceof UserAbortedError)) throw error;
}
