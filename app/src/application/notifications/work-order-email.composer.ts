import { OutboxMessage } from '@domain/messaging/message-catalog';

import { CustomerEmailRecipient } from '@application/services/customer-email-recipients';

interface BaseEmailInput {
  recipient: CustomerEmailRecipient;
  workOrderId: string;
  workOrderNumber: string;
}

type QuoteSentInput = BaseEmailInput & {
  total: string;
  items: { name: string; quantity: number; unitPrice: string }[];
};

type PaymentLinkInput = BaseEmailInput & {
  amount: string;
  checkoutUrl: string;
  expiresAt: string;
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Names and numbers are user-typed and go into HTML; escape them so they cannot inject markup
function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function emailMessage(
  { recipient, workOrderId }: BaseEmailInput,
  purpose: string,
  subject: string,
  text: string,
  html: string,
): OutboxMessage {
  return {
    type: 'notification.email.send',
    workOrderId,
    payload: { to: [recipient.email], subject, text, html, purpose },
  };
}

export class WorkOrderEmailComposer {
  static quoteSent(input: QuoteSentInput): OutboxMessage {
    const { recipient, workOrderNumber, total, items } = input;
    const number = escapeHtml(workOrderNumber);

    const instructionText = recipient.hasAccess
      ? 'Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.'
      : 'Você ainda não possui acesso ao sistema. Entre em contato com a oficina para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.';

    const instructionHtml = recipient.hasAccess
      ? '<p>Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.</p>'
      : '<p>Você ainda não possui acesso ao sistema. <strong>Entre em contato com a oficina</strong> para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.</p>';

    const itemLines = items.map((item) => ({
      text: `${item.name}: ${item.quantity} x R$ ${item.unitPrice}`,
      html: `${escapeHtml(item.name)}: ${item.quantity} x R$ ${item.unitPrice}`,
    }));

    return emailMessage(
      input,
      'quote_sent',
      `Orçamento para Ordem de Serviço ${workOrderNumber} - Aguardando sua aprovação`,
      `Olá ${recipient.name},\n\n` +
        `Um orçamento para a Ordem de Serviço ${workOrderNumber} está disponível para sua aprovação.\n` +
        itemLines.map((line) => `${line.text}\n`).join('') +
        `Valor total: R$ ${total}\n\n` +
        `${instructionText}\n\n` +
        `Atenciosamente,\nEquipe da Oficina Mecânica`,
      `<p>Olá <strong>${escapeHtml(recipient.name)}</strong>,</p>` +
        `<p>Um orçamento para a Ordem de Serviço <strong>${number}</strong> está disponível para sua aprovação.</p>` +
        `<ul>${itemLines.map((line) => `<li>${line.html}</li>`).join('')}</ul>` +
        `<p><strong>Valor total:</strong> R$ ${total}</p>` +
        `${instructionHtml}` +
        `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
    );
  }

  static paymentLink(input: PaymentLinkInput): OutboxMessage {
    const { recipient, workOrderNumber, amount, checkoutUrl, expiresAt } = input;
    const number = escapeHtml(workOrderNumber);

    const expiresAtText = new Date(expiresAt).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });

    // The serialized URL percent-encodes quotes, so the link cannot break out of the href.
    const checkoutLink = new URL(checkoutUrl).href;

    return emailMessage(
      input,
      'payment_link',
      `Pagamento da Ordem de Serviço ${workOrderNumber}`,
      `Olá ${recipient.name},\n\n` +
        `O pagamento da Ordem de Serviço ${workOrderNumber} está disponível.\n` +
        `Valor: R$ ${amount}\n` +
        `Link para pagamento: ${checkoutLink}\n` +
        `Válido até ${expiresAtText}\n\n` +
        `Atenciosamente,\nEquipe da Oficina Mecânica`,
      `<p>Olá <strong>${escapeHtml(recipient.name)}</strong>,</p>` +
        `<p>O pagamento da Ordem de Serviço <strong>${number}</strong> está disponível.</p>` +
        `<p><strong>Valor:</strong> R$ ${amount}</p>` +
        `<p><a href="${checkoutLink}">Pagar agora</a> (válido até ${expiresAtText})</p>` +
        `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
    );
  }

  static quoteApprovalReverted(input: BaseEmailInput): OutboxMessage {
    const { recipient, workOrderNumber } = input;
    const number = escapeHtml(workOrderNumber);

    return emailMessage(
      input,
      'quote_approval_reverted',
      `Orçamento da Ordem de Serviço ${workOrderNumber} - Estoque insuficiente`,
      `Olá ${recipient.name},\n\n` +
        `A aprovação do orçamento da Ordem de Serviço ${workOrderNumber} não foi concluída por falta de estoque de uma ou mais peças.\n` +
        `O orçamento voltou a aguardar sua aprovação e pode ser aprovado de novo quando o estoque for reposto.\n\n` +
        `Atenciosamente,\nEquipe da Oficina Mecânica`,
      `<p>Olá <strong>${escapeHtml(recipient.name)}</strong>,</p>` +
        `<p>A aprovação do orçamento da Ordem de Serviço <strong>${number}</strong> não foi concluída por falta de estoque de uma ou mais peças.</p>` +
        `<p>O orçamento voltou a aguardar sua aprovação e pode ser aprovado de novo quando o estoque for reposto.</p>` +
        `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
    );
  }
}
