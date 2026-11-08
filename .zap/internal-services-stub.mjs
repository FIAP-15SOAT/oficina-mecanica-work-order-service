// Stands in for the Inventory during the DAST scan: without it the routes that read the
// catalog would answer 503 and ZAP would flag every 5xx.
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

const fixtures = new Map([
  ['services', readFixtureData('inventory/internal-service.json')],
  ['parts-supplies', readFixtureData('inventory/internal-part-supply.json')],
]);

const reply = (res, statusCode, body) => {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const segments = new URL(req.url ?? '/', 'http://localhost').pathname.split('/');
  const [, prefix, resource, id] = segments;

  const fixture =
    req.method === 'GET' && prefix === 'internal' && id && segments.length === 4
      ? fixtures.get(resource)
      : undefined;

  if (fixture) {
    reply(res, 200, { data: { ...fixture, id } });
  } else {
    reply(res, 404, { statusCode: 404, error: 'Not Found', message: 'Recurso não encontrado' });
  }
}).listen(PORT, () => console.log(`internal services stub listening on ${PORT}`));
