import { describe, expect, it } from "vitest";
import type { NormalizedWhatsAppTemplateMessage } from "../plugin.js";
import { FakeWhatsAppProvider } from "./fake-whatsapp-provider.js";

const MESSAGE: NormalizedWhatsAppTemplateMessage = {
  messageId: "8f900e21-c1f3-4cd4-b94b-b3a37cb085b7",
  to: "+999900000001",
  templateName: "sandbox_template",
  templateLanguage: "en",
  templateCategory: "utility",
  variables: [],
};

describe("FakeWhatsAppProvider", () => {
  it("returns a visibly fake provider ref", async () => {
    await expect(new FakeWhatsAppProvider().send(MESSAGE, {})).resolves.toEqual(
      {
        status: "accepted",
        providerRef: `fake-whatsapp-${MESSAGE.messageId}`,
        raw: { fake: true, templateCategory: "utility" },
      },
    );
  });
});
