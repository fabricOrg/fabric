export interface WhatsappSendJob {
  tenantId: string;
  messageId: string;
}

export const WHATSAPP_SEND_QUEUE = "whatsapp-send";
