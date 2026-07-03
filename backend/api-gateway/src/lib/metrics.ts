export interface MetricsSnapshot {
  loginSuccess: number;
  loginFailure: number;
  refreshSuccess: number;
  refreshFailure: number;
  refreshReuseDetected: number;
  logoutSuccess: number;
  agentEnrollmentSuccess: number;
  agentEnrollmentFailure: number;
  agentAuthSuccess: number;
  agentAuthFailure: number;
  agentActivated: number;
  agentExpired: number;
  agentRevoked: number;
  agentsIsolated: number;
  agentsRestored: number;
  unauthorizedCount: number;
  forbiddenCount: number;
  rateLimitedCount: number;
  alertsCreated: number;
  alertsUpdated: number;
  collectedAt: string;
}

const counters = {
  loginSuccess: 0,
  loginFailure: 0,
  refreshSuccess: 0,
  refreshFailure: 0,
  refreshReuseDetected: 0,
  logoutSuccess: 0,
  agentEnrollmentSuccess: 0,
  agentEnrollmentFailure: 0,
  agentAuthSuccess: 0,
  agentAuthFailure: 0,
  agentActivated: 0,
  agentExpired: 0,
  agentRevoked: 0,
  agentsIsolated: 0,
  agentsRestored: 0,
  unauthorizedCount: 0,
  forbiddenCount: 0,
  rateLimitedCount: 0,
  alertsCreated: 0,
  alertsUpdated: 0,
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

export function recordAgentEnrollmentSuccess(): void {
  counters.agentEnrollmentSuccess += 1;
}

export function recordAgentEnrollmentFailure(): void {
  counters.agentEnrollmentFailure += 1;
}

export function recordAgentAuthSuccess(): void {
  counters.agentAuthSuccess += 1;
}

export function recordAgentAuthFailure(): void {
  counters.agentAuthFailure += 1;
}

export function recordAgentActivated(): void {
  counters.agentActivated += 1;
}

export function recordAgentExpired(): void {
  counters.agentExpired += 1;
}

export function recordAgentRevoked(): void {
  counters.agentRevoked += 1;
}

export function recordAgentIsolated(): void {
  counters.agentsIsolated += 1;
}

export function recordAgentRestored(): void {
  counters.agentsRestored += 1;
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

/** Increment alertsCreated by one — call once per persisted alert. */
export function recordAlertCreated(): void {
  counters.alertsCreated += 1;
}

export function recordAlertUpdated(): void {
  counters.alertsUpdated += 1;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    loginSuccess: counters.loginSuccess,
    loginFailure: counters.loginFailure,
    refreshSuccess: counters.refreshSuccess,
    refreshFailure: counters.refreshFailure,
    refreshReuseDetected: counters.refreshReuseDetected,
    logoutSuccess: counters.logoutSuccess,
    agentEnrollmentSuccess: counters.agentEnrollmentSuccess,
    agentEnrollmentFailure: counters.agentEnrollmentFailure,
    agentAuthSuccess: counters.agentAuthSuccess,
    agentAuthFailure: counters.agentAuthFailure,
    agentActivated: counters.agentActivated,
    agentExpired: counters.agentExpired,
    agentRevoked: counters.agentRevoked,
    agentsIsolated: counters.agentsIsolated,
    agentsRestored: counters.agentsRestored,
    unauthorizedCount: counters.unauthorizedCount,
    forbiddenCount: counters.forbiddenCount,
    rateLimitedCount: counters.rateLimitedCount,
    alertsCreated: counters.alertsCreated,
    alertsUpdated: counters.alertsUpdated,
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
  counters.agentEnrollmentSuccess = 0;
  counters.agentEnrollmentFailure = 0;
  counters.agentAuthSuccess = 0;
  counters.agentAuthFailure = 0;
  counters.agentActivated = 0;
  counters.agentExpired = 0;
  counters.agentRevoked = 0;
  counters.agentsIsolated = 0;
  counters.agentsRestored = 0;
  counters.unauthorizedCount = 0;
  counters.forbiddenCount = 0;
  counters.rateLimitedCount = 0;
  counters.alertsCreated = 0;
  counters.alertsUpdated = 0;
}
