export interface MetricsSnapshot {
  loginSuccess: number;
  loginFailure: number;
  refreshSuccess: number;
  refreshFailure: number;
  refreshReuseDetected: number;
  logoutSuccess: number;
  unauthorizedCount: number;
  forbiddenCount: number;
  rateLimitedCount: number;
  collectedAt: string;
}

const counters = {
  loginSuccess: 0,
  loginFailure: 0,
  refreshSuccess: 0,
  refreshFailure: 0,
  refreshReuseDetected: 0,
  logoutSuccess: 0,
  unauthorizedCount: 0,
  forbiddenCount: 0,
  rateLimitedCount: 0,
};

export function recordLoginSuccess(): void {
  counters.loginSuccess += 1;
}

export function recordLoginFailure(): void {
  counters.loginFailure += 1;
}

export function recordRefreshSuccess(): void {
  counters.refreshSuccess += 1;
}

export function recordRefreshFailure(): void {
  counters.refreshFailure += 1;
}

export function recordRefreshReuseDetected(): void {
  counters.refreshReuseDetected += 1;
}

export function recordLogoutSuccess(): void {
  counters.logoutSuccess += 1;
}

export function recordUnauthorized(): void {
  counters.unauthorizedCount += 1;
}

export function recordForbidden(): void {
  counters.forbiddenCount += 1;
}

export function recordRateLimited(): void {
  counters.rateLimitedCount += 1;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    loginSuccess: counters.loginSuccess,
    loginFailure: counters.loginFailure,
    refreshSuccess: counters.refreshSuccess,
    refreshFailure: counters.refreshFailure,
    refreshReuseDetected: counters.refreshReuseDetected,
    logoutSuccess: counters.logoutSuccess,
    unauthorizedCount: counters.unauthorizedCount,
    forbiddenCount: counters.forbiddenCount,
    rateLimitedCount: counters.rateLimitedCount,
    collectedAt: new Date().toISOString(),
  };
}

/** Reset all counters — test helper only. */
export function resetMetrics(): void {
  counters.loginSuccess = 0;
  counters.loginFailure = 0;
  counters.refreshSuccess = 0;
  counters.refreshFailure = 0;
  counters.refreshReuseDetected = 0;
  counters.logoutSuccess = 0;
  counters.unauthorizedCount = 0;
  counters.forbiddenCount = 0;
  counters.rateLimitedCount = 0;
}
