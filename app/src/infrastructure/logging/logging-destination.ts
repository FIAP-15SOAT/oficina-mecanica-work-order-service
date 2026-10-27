import pino, { DestinationStream } from 'pino';

import { reportDestinationFailure } from './logging-diagnostics';

/**
 * Default destination: a stream to fd 1 (stdout), in synchronous mode.
 *
 * `sync: true` because pino's asynchronous buffer loses the last lines when
 * the process dies suddenly — crash, k8s OOM kill —, which is exactly when
 * they matter.
 *
 * The `error` handler is required, not zeal: an `'error'` event with no
 * listener on a Node stream kills the process, so a broken `stdout` — EPIPE
 * when the collector goes down — would make logging kill the application it
 * exists to observe.
 *
 * It lives in its own file, not in the module, because `*.module.ts` is out of
 * `collectCoverageFrom`: here both decisions above are covered by a spec.
 */
export function createDefaultDestination(): DestinationStream {
  const destination = pino.destination({ dest: 1, sync: true });

  destination.on('error', () => reportDestinationFailure());

  return destination;
}
