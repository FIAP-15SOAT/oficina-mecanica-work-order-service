import { NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { GLOBAL_PREFIX } from './http.constants';

const PREFIX_PATH = `/${GLOBAL_PREFIX}`;

/**
 * NestJS 12 mounts its 404 handler only under the global prefix, so a request
 * outside it fell through to Express's HTML 404. Every route of the service
 * lives under the prefix, so anything outside it is a 404: handing Nest the
 * exception keeps the JSON envelope of the exception filters.
 */
export function rejectOutsideGlobalPrefix(req: Request, _res: Response, next: NextFunction): void {
  if (req.path === PREFIX_PATH || req.path.startsWith(`${PREFIX_PATH}/`)) {
    next();

    return;
  }

  // Same text as Nest's own 404, so the log rewrite of the framework message applies.
  next(new NotFoundException(`Cannot ${req.method} ${req.originalUrl}`));
}
