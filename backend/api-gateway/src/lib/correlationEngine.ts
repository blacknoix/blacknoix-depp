import {
  AlertToCreate,
  BatchBurstRule,
  CorrelationRule,
  EvaluationContext,
  EventTypeMatchRule,
  SeverityThresholdRule,
  TelemetryEventRow,
} from '../types/correlationRule';
import { extractAlertIndicator } from './alertIndicator';

/** Replace `{token}` placeholders in alert title templates. */
function applyTemplate(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = tokens[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

function rulePriority(rule: CorrelationRule): number {
  return rule.priority ?? 100;
}

function sortRules(rules: CorrelationRule[]): CorrelationRule[] {
  return [...rules].sort((a, b) => rulePriority(a) - rulePriority(b));
}

/**
 * Default correlation rules with explicit priorities (lower = earlier).
 * 1. Event-type match (malware. prefix) — priority 10
 * 2. Severity threshold (high/critical) — priority 20
 * 3. Batch burst — priority 30 (evaluated after per-event phase)
 */
export const DEFAULT_RULES: CorrelationRule[] = [
  {
    kind: 'event_type_match',
    id: 'malware-prefix',
    enabled: true,
    priority: 10,
    prefix: 'malware.',
    alertSeverity: 'high',
    titleTemplate: 'Malware event: {eventType}',
  },
  {
    kind: 'severity_threshold',
    id: 'severity-threshold',
    enabled: true,
    priority: 20,
    severities: ['high', 'critical'],
    titleTemplate: '{SEVERITY} event: {eventType}',
  },
  {
    kind: 'batch_burst',
    id: 'batch-burst',
    enabled: true,
    priority: 30,
    minCount: 3,
    severities: ['high', 'critical'],
    alertSeverity: 'critical',
    titleTemplate: 'Burst: {count} high/critical events in batch',
  },
];

function matchSeverityThreshold(
  rule: SeverityThresholdRule,
  row: TelemetryEventRow
): AlertToCreate | null {
  // Non-malware only — malware.* is owned by event_type_match rules.
  if (row.eventType.startsWith('malware.')) {
    return null;
  }
  if (!rule.severities.includes(row.severity)) {
    return null;
  }
  return {
    tenantId: row.tenantId,
    agentId: row.agentId,
    telemetryEventId: row.id,
    title: applyTemplate(rule.titleTemplate, {
      SEVERITY: row.severity.toUpperCase(),
      eventType: row.eventType,
    }),
    severity: row.severity,
    ruleId: rule.id,
    indicator: extractAlertIndicator(row.payload),
  };
}

function matchEventTypePrefix(rule: EventTypeMatchRule, row: TelemetryEventRow): AlertToCreate | null {
  if (!row.eventType.startsWith(rule.prefix)) {
    return null;
  }
  return {
    tenantId: row.tenantId,
    agentId: row.agentId,
    telemetryEventId: row.id,
    title: applyTemplate(rule.titleTemplate, { eventType: row.eventType }),
    severity: rule.alertSeverity,
    ruleId: rule.id,
    indicator: extractAlertIndicator(row.payload),
  };
}

function matchBatchBurst(
  rule: BatchBurstRule,
  eventRows: TelemetryEventRow[],
  context: EvaluationContext
): AlertToCreate | null {
  const matching = eventRows.filter((row) => rule.severities.includes(row.severity));
  if (matching.length < rule.minCount) {
    return null;
  }
  return {
    tenantId: context.tenantId,
    agentId: context.agentId,
    telemetryEventId: null,
    title: applyTemplate(rule.titleTemplate, { count: matching.length }),
    severity: rule.alertSeverity,
    ruleId: rule.id,
    indicator: null,
  };
}

function matchPerEventRule(rule: CorrelationRule, row: TelemetryEventRow): AlertToCreate | null {
  if (!rule.enabled || rule.kind === 'batch_burst') {
    return null;
  }
  if (rule.kind === 'severity_threshold') {
    return matchSeverityThreshold(rule, row);
  }
  if (rule.kind === 'event_type_match') {
    return matchEventTypePrefix(rule, row);
  }
  return null;
}

/**
 * Pure correlation evaluation — no DB, metrics, or audit side effects.
 *
 * Per-event rules: enabled rules sorted by priority; first match wins (claimedEventIds).
 * Batch burst rules: evaluated after per-event phase; telemetryEventId unset; no claimed ids.
 *
 * v2 TODO: cross-batch burst / sliding-window correlation should run as a background job
 * (e.g. scheduled worker reading recent telemetry per agent), not inline on ingest.
 */
export function evaluateRules(
  eventRows: TelemetryEventRow[],
  context: EvaluationContext,
  rules: CorrelationRule[] = DEFAULT_RULES
): AlertToCreate[] {
  if (eventRows.length === 0) {
    return [];
  }

  const enabled = rules.filter((r) => r.enabled);
  const perEventRules = sortRules(enabled.filter((r) => r.kind !== 'batch_burst'));
  const burstRules = sortRules(enabled.filter((r) => r.kind === 'batch_burst'));

  const alerts: AlertToCreate[] = [];
  const claimedEventIds = new Set<string>();

  for (const row of eventRows) {
    if (claimedEventIds.has(row.id)) {
      continue;
    }

    for (const rule of perEventRules) {
      const draft = matchPerEventRule(rule, row);
      if (draft) {
        alerts.push(draft);
        claimedEventIds.add(row.id);
        break;
      }
    }
  }

  for (const rule of burstRules) {
    const burst = matchBatchBurst(rule as BatchBurstRule, eventRows, context);
    if (burst) {
      alerts.push(burst);
    }
  }

  return alerts;
}
