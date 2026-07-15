export interface EmailSendJob {
  tenantId: string;
  messageId: string;
}

export const EMAIL_SEND_QUEUE = "email-send";
