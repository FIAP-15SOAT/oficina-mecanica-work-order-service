export interface EmailMessage {
  text: string;
  html: string;
}

export interface SendEmailInput {
  toEmail: string;
  toName: string;
  subject: string;
  message: EmailMessage;
}

export interface IEmailSenderService {
  send(input: SendEmailInput): Promise<void>;
}
