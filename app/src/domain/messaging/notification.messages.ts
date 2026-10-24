export interface NotificationMessagePayloads {
  'notification.email.send': { to: string[]; subject: string; text: string; html: string };
}
