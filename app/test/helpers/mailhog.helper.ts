import { StartedTestContainer } from 'testcontainers';

export interface MailhogEmail {
  subject: string;
  body: string;
}

interface MailhogResponse {
  items: {
    To: { Mailbox: string; Domain: string }[];
    Content: { Headers: { Subject: string[] }; Body: string };
  }[];
}

// The body comes back with the quoted-printable soft line breaks (a trailing `=`) removed.
export async function findEmails(
  mailhogContainer: StartedTestContainer,
  toEmail: string,
): Promise<MailhogEmail[]> {
  const mailhogUrl = `http://${mailhogContainer.getHost()}:${mailhogContainer.getMappedPort(8025)}`;

  const { items } = (await (
    await fetch(`${mailhogUrl}/api/v2/messages`)
  ).json()) as MailhogResponse;

  return items
    .filter((item) => item.To.some((to) => `${to.Mailbox}@${to.Domain}` === toEmail))
    .map(({ Content }) => ({
      subject: Content.Headers.Subject[0],
      body: Content.Body.replace(/=\r?\n/g, ''),
    }));
}
