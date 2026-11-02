export interface NotificationMessagePayloads {
  'notification.email.send': {
    to: string[];
    subject: string;
    text: string;
    html: string;
    // Lowercase snake_case e-mail label; the notification function logs it, never the subject
    purpose?: string;
  };
}
