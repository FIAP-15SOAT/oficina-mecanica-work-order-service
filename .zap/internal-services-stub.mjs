// Stands in for the Inventory, the Billing and the Identity during the DAST scan: without it the
// routes that read the catalog or the users, open a work order with items or deliver one would
// answer 503 and ZAP would flag every 5xx.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = 3000;
const contractsDir = process.env.CONTRACTS_DIR;

if (!contractsDir) {
  throw new Error('CONTRACTS_DIR is required');
}

const readFixtureData = (path) =>
  JSON.parse(readFileSync(join(contractsDir, path), 'utf8')).data;

const service = readFixtureData('inventory/internal-service.json');
const partSupply = readFixtureData('inventory/internal-part-supply.json');
const quoteSummary = readFixtureData('billing/internal-quote-summary.json');
const balance = readFixtureData('billing/internal-work-order-balance.json');
const payments = readFixtureData('billing/internal-work-order-payments.json');
const user = readFixtureData('identity/internal-user.json');
const customerUser = readFixtureData('identity/internal-customer-user.json');

const notFound = {
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: 'Recurso não encontrado' },
};

const readBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {};
  } catch {
    return {};
  }
};

const handlers = {
  'GET /internal/services/:id': ({ id }) => ({ status: 200, body: { data: { ...service, id } } }),
  'GET /internal/parts-supplies/:id': ({ id }) => ({
    status: 200,
    body: { data: { ...partSupply, id } },
  }),
  'POST /internal/quotes': async (_params, req) => {
    const { workOrderId } = await readBody(req);

    return { status: 201, body: { data: { ...quoteSummary, id: randomUUID(), workOrderId } } };
  },
  'DELETE /internal/quotes/:id': () => ({ status: 204 }),
  'GET /internal/work-orders/:workOrderId/balance': () => ({
    status: 200,
    body: { data: { ...balance, paidTotal: balance.approvedTotal, balance: '0.00' } },
  }),
  'GET /internal/work-orders/:workOrderId/payments': ({ workOrderId }) => ({
    status: 200,
    body: { data: payments.map((payment) => ({ ...payment, workOrderId })) },
  }),
  'GET /internal/users/:id': ({ id }) => ({ status: 200, body: { data: { ...user, id } } }),
  'POST /internal/customer-users': async (_params, req) => {
    await readBody(req);

    return { status: 200, body: { data: customerUser } };
  },
};

const routes = Object.entries(handlers).map(([route, handle]) => {
  const [method, pathname] = route.split(' ');

  return { method, pattern: new URLPattern({ pathname }), handle };
});

const answer = async (req) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  for (const { method, pattern, handle } of routes) {
    const match = method === req.method ? pattern.exec({ pathname }) : null;

    if (match) {
      return handle(match.pathname.groups, req);
    }
  }

  return notFound;
};

createServer(async (req, res) => {
  const { status, body } = await answer(req);

  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body && JSON.stringify(body));
}).listen(PORT, () => console.log(`internal services stub listening on ${PORT}`));
