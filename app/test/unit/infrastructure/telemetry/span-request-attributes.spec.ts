import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { MAX_USER_AGENT_LENGTH, REDACTED } from '@infrastructure/logging/redaction/text-sanitizer';
import * as urlAttributes from '@infrastructure/logging/url-attributes';
import { sanitizeUrlPath } from '@infrastructure/logging/url-attributes';
import {
  buildIncomingSpanAttributes,
  extractRequestPathname,
} from '@infrastructure/telemetry/span-request-attributes';
import { captureDiagnostics } from '../../../helpers/diagnostics-capture';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

interface RequestOptions {
  url?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}

/**
 * Synthetic `IncomingMessage`: the hook runs **before** Express, so this is what
 * it really receives in production — no `path`, no `query`, no `ip`.
 */
function createRequest({ url = '/api/work-orders', headers = {}, remoteAddress }: RequestOptions) {
  return {
    url,
    headers,
    socket: { remoteAddress } as Socket,
  } as unknown as IncomingMessage;
}

describe('extractRequestPathname', () => {
  it('should cut at the first question mark', () => {
    expect(extractRequestPathname('/api/quotes/1/decisions?token=abc')).toBe(
      '/api/quotes/1/decisions',
    );
  });

  it('should return the whole path when there is no query', () => {
    expect(extractRequestPathname('/api/work-orders')).toBe('/api/work-orders');
  });

  it('should treat a missing url as empty', () => {
    expect(extractRequestPathname()).toBe('');
    expect(extractRequestPathname(undefined)).toBe('');
  });

  it('should preserve an explicitly null url as empty', () => {
    expect(extractRequestPathname(null)).toBe('');
  });
});

describe('buildIncomingSpanAttributes — url.path', () => {
  it('should apply the same sanitization as the access log, not a second policy', () => {
    const path = '/api/customers/123.456.789-09';

    const attributes = buildIncomingSpanAttributes(createRequest({ url: path }));

    expect(attributes['url.path']).toBe(sanitizeUrlPath(path));
    expect(attributes['url.path']).toBe('/api/customers/***.***.789-09');
  });

  it('should mask a percent-encoded e-mail in the path', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ url: '/api/users/maria.silva%40gmail.com' }),
    );

    expect(attributes['url.path']).toBe('/api/users/ma***va@gmail.com');
  });

  // `%2540` decodes to `%40`, which still has no at-sign shape: a single pass
  // would let the double-encoded value through.
  it('should decode until stable before scrubbing', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ url: '/api/users/maria%2540gmail.com' }),
    );

    expect(attributes['url.path']).toBe('/api/users/m***@gmail.com');
  });

  it('should remove a percent-encoded signed token from the path', () => {
    const encoded = `/api/x/${JWT.split('.').join('%2E')}`;

    expect(buildIncomingSpanAttributes(createRequest({ url: encoded }))['url.path']).toBe(
      `/api/x/${REDACTED}`,
    );
  });

  it('should sanitize the path without carrying the query along', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ url: '/api/quotes/abc/decisions?token=super-secret' }),
    );

    expect(attributes['url.path']).toBe('/api/quotes/abc/decisions');
    expect(JSON.stringify(attributes)).not.toContain('super-secret');
  });
});

describe('buildIncomingSpanAttributes — url.query', () => {
  /**
   * The log protects the query by **parameter name** over the already split
   * query; here only the raw text exists, and an opaque token has no shape a
   * scrubber recognizes. Emitting "whatever can be sanitized" would fail open,
   * so the key goes out `undefined` — and the span drops a null attribute.
   */
  it('should never emit the query, not even sanitized', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ url: `/api/quotes/abc/decisions?token=${JWT}` }),
    );

    expect(attributes['url.query']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(attributes, 'url.query')).toBe(true);
  });

  it('should not emit a harmless filter query either', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ url: '/api/work-orders?page=1&limit=10' }),
    );

    expect(attributes['url.query']).toBeUndefined();
  });
});

describe('buildIncomingSpanAttributes — client.address', () => {
  it('should omit the address when the forwarded header is not an IP', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ headers: { 'x-forwarded-for': 'maria@x.com' } }),
    );

    expect(attributes['client.address']).toBeUndefined();
  });

  /**
   * The access line uses `request.ip`, which honors `trust proxy`. Without this
   * symmetry, with the **shipped** configuration (no trusted proxy) the caller
   * forged the address in the span while the log kept the real one — two values
   * for the same request, the span's coming from whoever is being investigated.
   */
  it('should ignore the forwarded header when no proxy is trusted', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({
        headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.2' },
        remoteAddress: '10.0.0.4',
      }),
    );

    expect(attributes['client.address']).toBe('10.0.0.4');
  });

  /**
   * The leftmost hop is the caller's text: behind a load balancer that only
   * appends its own, the caller chooses what goes there. Trusting only
   * `10.0.0.0/8` means believing **one** hop back — what `10.0.0.4` reported —,
   * and `203.0.113.7` cannot be verified.
   */
  it('should stop at the first untrusted hop, never at the caller-supplied one', () => {
    process.env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8';

    try {
      const attributes = buildIncomingSpanAttributes(
        createRequest({
          headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.2' },
          remoteAddress: '10.0.0.4',
        }),
      );

      expect(attributes['client.address']).toBe('198.51.100.2');
    } finally {
      delete process.env.TRUSTED_PROXY_CIDRS;
    }
  });

  /**
   * Configuring trusted proxies does not authorize the header from **any** peer:
   * a peer outside the range is a direct connection, and the header it sent is
   * worth nothing. Before this fix the span accepted the header whenever some
   * range was configured, without looking at where the connection came from.
   */
  it('should ignore the forwarded header when the peer is outside the trusted range', () => {
    process.env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8';

    try {
      const attributes = buildIncomingSpanAttributes(
        createRequest({
          headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.2' },
          remoteAddress: '192.0.2.5',
        }),
      );

      expect(attributes['client.address']).toBe('192.0.2.5');
    } finally {
      delete process.env.TRUSTED_PROXY_CIDRS;
    }
  });

  /**
   * Fails closed, like `applyTrustProxy` on the other side: a list `proxy-addr`
   * refuses becomes "no trusted hop", never "all".
   */
  it('should trust no hop when the configured list is invalid', () => {
    process.env.TRUSTED_PROXY_CIDRS = 'faixa-invalida';

    try {
      const attributes = buildIncomingSpanAttributes(
        createRequest({
          headers: { 'x-forwarded-for': '203.0.113.7' },
          remoteAddress: '10.0.0.4',
        }),
      );

      expect(attributes['client.address']).toBe('10.0.0.4');
    } finally {
      delete process.env.TRUSTED_PROXY_CIDRS;
    }
  });

  it('should fall back to the socket address when there is no forwarded header', () => {
    const attributes = buildIncomingSpanAttributes(createRequest({ remoteAddress: '10.0.0.4' }));

    expect(attributes['client.address']).toBe('10.0.0.4');
  });

  it('should omit the address when not even the socket carries a valid IP', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ headers: { 'x-forwarded-for': 'not-an-ip' }, remoteAddress: undefined }),
    );

    expect(attributes['client.address']).toBeUndefined();
  });
});

describe('buildIncomingSpanAttributes — user_agent.original', () => {
  it('should truncate at the same per-attribute limit the access log uses', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ headers: { 'user-agent': 'a'.repeat(MAX_USER_AGENT_LENGTH + 500) } }),
    );

    expect((attributes['user_agent.original'] as string).length).toBeLessThanOrEqual(
      MAX_USER_AGENT_LENGTH,
    );
  });

  it('should scrub sensitive content like any free text', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ headers: { 'user-agent': `curl/8.0 ${JWT}` } }),
    );

    expect(attributes['user_agent.original']).toBe(`curl/8.0 ${REDACTED}`);
  });

  it('should omit the attribute when the header is absent', () => {
    expect(buildIncomingSpanAttributes(createRequest({}))['user_agent.original']).toBeUndefined();
  });
});

describe('buildIncomingSpanAttributes — server.address', () => {
  /**
   * The instrumentation derives `server.address` and `server.port` from
   * `Forwarded`/`X-Forwarded-Host`/`Host`, without validating, truncating or
   * falling back to the socket. Measured before the fix: a 322-character `Host`
   * with an e-mail inside went out whole in the span — and the access line does
   * not carry this attribute in any form, so there is no equivalent sanitization
   * to reuse. Removed by subtraction, like the query.
   */
  it.each(['host', 'x-forwarded-host'])('should not emit a server address from %s', (header) => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ headers: { [header]: `maria.silva@gmail.com-${'a'.repeat(300)}:999999` } }),
    );

    expect(attributes['server.address']).toBeUndefined();
    expect(attributes['server.port']).toBeUndefined();
    expect(JSON.stringify(attributes)).not.toContain('maria.silva@gmail.com');
  });
});

describe('buildIncomingSpanAttributes — surface', () => {
  /**
   * The hook only **subtracts**: it overwrites only what the instrumentation
   * would emit raw. Any new key here would be an attribute outside the redaction
   * chain.
   */
  it('should not introduce any attribute beyond the overridden ones', () => {
    const attributes = buildIncomingSpanAttributes(
      createRequest({ headers: { authorization: 'Bearer super-secret', cookie: 'a=b' } }),
    );

    expect(Object.keys(attributes).sort()).toEqual([
      'client.address',
      'server.address',
      'server.port',
      'url.path',
      'url.query',
      'user_agent.original',
    ]);
    expect(JSON.stringify(attributes)).not.toContain('super-secret');
  });
});

describe('buildIncomingSpanAttributes — non-throwing boundary', () => {
  /**
   * A throw here would fail **open**: the instrumentation wraps the hook in
   * `safeExecuteInTheMiddle` with `rethrow: false`, and an `undefined` return
   * leaves its raw attributes untouched — including the `url.query` this hook
   * exists to remove. The fallback must be the **closed** set.
   */
  it('should return the closed set when sanitization fails', () => {
    const diagnostics = captureDiagnostics();
    const explode = jest.spyOn(urlAttributes, 'sanitizeUrlPath').mockImplementation(() => {
      throw new Error('scrubber quebrou');
    });

    const attributes = buildIncomingSpanAttributes(
      createRequest({
        url: `/api/quotes/abc/decisions?token=${JWT}`,
        headers: { 'user-agent': JWT, 'x-forwarded-for': '203.0.113.7' },
      }),
    );

    expect(attributes['url.path']).toBe(REDACTED);
    expect(attributes['url.query']).toBeUndefined();
    expect(attributes['client.address']).toBeUndefined();
    expect(attributes['user_agent.original']).toBeUndefined();
    expect(attributes['server.address']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(attributes, 'url.query')).toBe(true);
    expect(diagnostics.text()).toContain('sanitization');

    explode.mockRestore();
    diagnostics.restore();
  });
});
