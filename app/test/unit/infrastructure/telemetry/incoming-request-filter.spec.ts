import { IncomingMessage } from 'node:http';

import { LIVENESS_PATH, READINESS_PATH } from '@infrastructure/health/health.constants';
import { isIgnoredIncomingRequest } from '@infrastructure/telemetry/incoming-request-filter';

function buildRequest(url: string): IncomingMessage {
  return { url, headers: {} } as IncomingMessage;
}

describe('isIgnoredIncomingRequest', () => {
  it('should exclude the liveness and readiness probes', () => {
    expect(isIgnoredIncomingRequest(buildRequest(LIVENESS_PATH))).toBe(true);
    expect(isIgnoredIncomingRequest(buildRequest(READINESS_PATH))).toBe(true);
  });

  // The hook receives a raw `IncomingMessage`, where `req.path` does not exist
  // yet: without splitting off the query string, a probe with any parameter
  // would no longer be excluded and would produce volume again.
  it('should strip the query string before consulting the predicate', () => {
    expect(isIgnoredIncomingRequest(buildRequest(`${READINESS_PATH}?verbose=1`))).toBe(true);
    expect(isIgnoredIncomingRequest(buildRequest(`${LIVENESS_PATH}?`))).toBe(true);
  });

  it('should not exclude a neighbouring path nor a business route', () => {
    expect(isIgnoredIncomingRequest(buildRequest('/api/health/liveness'))).toBe(false);
    expect(isIgnoredIncomingRequest(buildRequest(`${LIVENESS_PATH}/`))).toBe(false);
    expect(isIgnoredIncomingRequest(buildRequest('/api/work-orders?status=RECEIVED'))).toBe(false);
  });

  it('should not break when the request carries no url', () => {
    expect(isIgnoredIncomingRequest({ headers: {} } as IncomingMessage)).toBe(false);
  });
});
