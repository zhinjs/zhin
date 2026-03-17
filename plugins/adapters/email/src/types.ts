/**
 * Email 适配器类型定义
 */
import type { Attachment } from "mailparser";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface ImapConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  checkInterval?: number;
  mailbox?: string;
  markSeen?: boolean;
}

export interface EmailBotConfig {
  context: "email";
  name: string;
  smtp: SmtpConfig;
  imap: ImapConfig;
  attachments?: {
    enabled: boolean;
    downloadPath?: string;
    maxFileSize?: number;
    allowedTypes?: string[];
  };
}

export interface EmailMessage {
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments: Attachment[];
  date: Date;
  uid: number;
}
