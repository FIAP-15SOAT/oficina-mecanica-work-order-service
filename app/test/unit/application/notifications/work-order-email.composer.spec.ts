import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { CustomerEmailRecipient } from '@application/services/customer-email-recipients';

describe('WorkOrderEmailComposer', () => {
  const workOrderId = 'work-order-id';
  const workOrderNumber = '000123';
  let recipient: CustomerEmailRecipient;

  beforeEach(() => {
    recipient = { email: 'maria@example.com', name: 'Maria Souza', hasAccess: true };
  });

  describe('quoteSent', () => {
    const items = [
      { name: 'Troca de óleo', quantity: 1, unitPrice: '150.00' },
      { name: 'Filtro', quantity: 2, unitPrice: '30.00' },
    ];

    it('should compose the quote e-mail for a recipient with access', () => {
      const message = WorkOrderEmailComposer.quoteSent({
        recipient,
        workOrderId,
        workOrderNumber,
        total: '210.00',
        items,
      });

      expect(message.type).toBe('notification.email.send');
      expect(message.workOrderId).toBe(workOrderId);

      expect(message.payload).toEqual({
        to: ['maria@example.com'],
        purpose: 'quote_sent',
        subject: 'Orçamento para Ordem de Serviço 000123 - Aguardando sua aprovação',
        text:
          'Olá Maria Souza,\n\n' +
          'Um orçamento para a Ordem de Serviço 000123 está disponível para sua aprovação.\n' +
          'Troca de óleo: 1 x R$ 150.00\n' +
          'Filtro: 2 x R$ 30.00\n' +
          'Valor total: R$ 210.00\n\n' +
          'Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.\n\n' +
          'Atenciosamente,\nEquipe da Oficina Mecânica',
        html:
          '<p>Olá <strong>Maria Souza</strong>,</p>' +
          '<p>Um orçamento para a Ordem de Serviço <strong>000123</strong> está disponível para sua aprovação.</p>' +
          '<ul><li>Troca de óleo: 1 x R$ 150.00</li><li>Filtro: 2 x R$ 30.00</li></ul>' +
          '<p><strong>Valor total:</strong> R$ 210.00</p>' +
          '<p>Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.</p>' +
          '<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>',
      });
    });

    it('should tell a recipient without access to contact the workshop', () => {
      recipient.hasAccess = false;

      const message = WorkOrderEmailComposer.quoteSent({
        recipient,
        workOrderId,
        workOrderNumber,
        total: '210.00',
        items,
      });

      expect(message.payload).toMatchObject({
        text: expect.stringContaining(
          'Você ainda não possui acesso ao sistema. Entre em contato com a oficina para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.',
        ),
        html: expect.stringContaining(
          '<p>Você ainda não possui acesso ao sistema. <strong>Entre em contato com a oficina</strong> para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.</p>',
        ),
      });
    });

    it('should escape the recipient and item names in the html and keep them literal in the text', () => {
      recipient.name = '<script>alert(1)</script>';

      const message = WorkOrderEmailComposer.quoteSent({
        recipient,
        workOrderId,
        workOrderNumber: '<b>1</b>',
        total: '10.00',
        items: [{ name: '<script>x</script> & "peça"', quantity: 1, unitPrice: '10.00' }],
      });
      const { text, html } = message.payload as { text: string; html: string };

      expect(text).toContain('Olá <script>alert(1)</script>,');
      expect(text).toContain('<script>x</script> & "peça": 1 x R$ 10.00');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;peça&quot;: 1 x R$ 10.00');
      expect(html).toContain('<strong>&lt;b&gt;1&lt;/b&gt;</strong>');
    });
  });

  describe('paymentLink', () => {
    it('should compose the payment link e-mail', () => {
      const message = WorkOrderEmailComposer.paymentLink({
        recipient,
        workOrderId,
        workOrderNumber,
        amount: '210.00',
        checkoutUrl: 'https://pay.example.com/checkout/abc',
        expiresAt: '2026-11-13T15:30:00.000Z',
      });

      expect(message.type).toBe('notification.email.send');
      expect(message.workOrderId).toBe(workOrderId);

      expect(message.payload).toEqual({
        to: ['maria@example.com'],
        purpose: 'payment_link',
        subject: 'Pagamento da Ordem de Serviço 000123',
        text:
          'Olá Maria Souza,\n\n' +
          'O pagamento da Ordem de Serviço 000123 está disponível.\n' +
          'Valor: R$ 210.00\n' +
          'Link para pagamento: https://pay.example.com/checkout/abc\n' +
          'Válido até 13/11/2026, 12:30\n\n' +
          'Atenciosamente,\nEquipe da Oficina Mecânica',
        html:
          '<p>Olá <strong>Maria Souza</strong>,</p>' +
          '<p>O pagamento da Ordem de Serviço <strong>000123</strong> está disponível.</p>' +
          '<p><strong>Valor:</strong> R$ 210.00</p>' +
          '<p><a href="https://pay.example.com/checkout/abc">Pagar agora</a> (válido até 13/11/2026, 12:30)</p>' +
          '<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>',
      });
    });

    it('should escape the recipient name and percent-encode quotes in the link', () => {
      recipient.name = '<i>Maria</i>';

      const message = WorkOrderEmailComposer.paymentLink({
        recipient,
        workOrderId,
        workOrderNumber,
        amount: '10.00',
        checkoutUrl: 'https://pay.example.com/checkout/a"b',
        expiresAt: '2026-11-13T15:30:00.000Z',
      });
      const { text, html } = message.payload as { text: string; html: string };

      expect(text).toContain('Olá <i>Maria</i>,');
      expect(html).toContain('<strong>&lt;i&gt;Maria&lt;/i&gt;</strong>');
      expect(html).toContain('href="https://pay.example.com/checkout/a%22b"');
    });
  });

  describe('quoteApprovalReverted', () => {
    it('should compose the stock shortage e-mail', () => {
      const message = WorkOrderEmailComposer.quoteApprovalReverted({
        recipient,
        workOrderId,
        workOrderNumber,
      });

      expect(message.type).toBe('notification.email.send');
      expect(message.workOrderId).toBe(workOrderId);

      expect(message.payload).toEqual({
        to: ['maria@example.com'],
        purpose: 'quote_approval_reverted',
        subject: 'Orçamento da Ordem de Serviço 000123 - Estoque insuficiente',
        text:
          'Olá Maria Souza,\n\n' +
          'A aprovação do orçamento da Ordem de Serviço 000123 não foi concluída por falta de estoque de uma ou mais peças.\n' +
          'O orçamento voltou a aguardar sua aprovação e pode ser aprovado de novo quando o estoque for reposto.\n\n' +
          'Atenciosamente,\nEquipe da Oficina Mecânica',
        html:
          '<p>Olá <strong>Maria Souza</strong>,</p>' +
          '<p>A aprovação do orçamento da Ordem de Serviço <strong>000123</strong> não foi concluída por falta de estoque de uma ou mais peças.</p>' +
          '<p>O orçamento voltou a aguardar sua aprovação e pode ser aprovado de novo quando o estoque for reposto.</p>' +
          '<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>',
      });
    });

    it('should escape the recipient name in the html', () => {
      recipient.name = '<u>Maria</u>';

      const message = WorkOrderEmailComposer.quoteApprovalReverted({
        recipient,
        workOrderId,
        workOrderNumber,
      });
      const { html } = message.payload as { html: string };

      expect(html).toContain('<strong>&lt;u&gt;Maria&lt;/u&gt;</strong>');
    });
  });
});
