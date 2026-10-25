import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { rejectOutsideGlobalPrefix } from '@infrastructure/http/outside-prefix.middleware';

function run(path: string, originalUrl = path): jest.Mock {
  const next = jest.fn();

  rejectOutsideGlobalPrefix({ path, originalUrl, method: 'GET' } as Request, {} as Response, next);

  return next;
}

describe('rejectOutsideGlobalPrefix', () => {
  it('should let a request under the global prefix through', () => {
    expect(run('/api/customers')).toHaveBeenCalledWith();
  });

  it('should let the bare prefix through', () => {
    expect(run('/api')).toHaveBeenCalledWith();
  });

  it('should let /internal paths through', () => {
    expect(run('/internal/work-orders/1')).toHaveBeenCalledWith();
  });

  it('should hand Nest a 404 for the bare internal prefix', () => {
    const [error] = run('/internal').mock.calls[0] as [unknown];

    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('should hand Nest a 404 for a path outside the prefix', () => {
    const next = run('/customers', '/customers?page=2');
    const [error] = next.mock.calls[0] as [NotFoundException];

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Cannot GET /customers?page=2');
  });

  it('should not treat a path that only starts with the prefix text as inside it', () => {
    const [error] = run('/apiary').mock.calls[0] as [unknown];

    expect(error).toBeInstanceOf(NotFoundException);
  });
});
