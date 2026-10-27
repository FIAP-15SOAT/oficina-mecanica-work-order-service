import {
  HEALTH_PATHS,
  isHealthProbePath,
  LIVENESS_PATH,
  READINESS_PATH,
} from '@infrastructure/health/health.constants';

describe('isHealthProbePath', () => {
  it('should match the exact paths exposed by the controller', () => {
    expect(isHealthProbePath(LIVENESS_PATH)).toBe(true);
    expect(isHealthProbePath(READINESS_PATH)).toBe(true);
  });

  it('should use the same closed path set the application declares', () => {
    for (const path of HEALTH_PATHS) {
      expect(isHealthProbePath(path)).toBe(true);
    }
  });

  // Behavior kept from the access log suppressor: the router accepts the
  // trailing slash (`strict` is false), but it never comes from the kubelet —
  // it comes from a human or a scanner, exactly the traffic worth seeing.
  it('should not match a path with a trailing slash', () => {
    expect(isHealthProbePath(`${LIVENESS_PATH}/`)).toBe(false);
    expect(isHealthProbePath(`${READINESS_PATH}/`)).toBe(false);
  });

  // A prefix match would silence a future neighbor route. The closed set
  // does not.
  it('should not match a neighbouring path that only shares the prefix', () => {
    expect(isHealthProbePath('/api/health/liveness')).toBe(false);
    expect(isHealthProbePath('/api/health')).toBe(false);
    expect(isHealthProbePath('/api/healthz')).toBe(false);
  });

  it('should not match a business route', () => {
    expect(isHealthProbePath('/api/work-orders')).toBe(false);
    expect(isHealthProbePath('')).toBe(false);
  });
});
