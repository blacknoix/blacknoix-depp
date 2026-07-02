export interface TelemetryEventRow {
  id: string;
  tenantId: string;
  agentId: string;
  eventType: string;
  severity: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface EvaluationContext {
  tenantId: string;
  agentId: string;
}

export interface AlertToCreate {
  tenantId: string;
  agentId: string;
  telemetryEventId: string | null;
  title: string;
  severity: string;
  ruleId: string;
}

interface CorrelationRuleBase {
  id: string;
  enabled: boolean;
  priority?: number;
}

export interface SeverityThresholdRule extends CorrelationRuleBase {
  kind: 'severity_threshold';
  severities: string[];
  titleTemplate: string;
}

export interface EventTypeMatchRule extends CorrelationRuleBase {
  kind: 'event_type_match';
  prefix: string;
  alertSeverity: string;
  titleTemplate: string;
}

export interface BatchBurstRule extends CorrelationRuleBase {
  kind: 'batch_burst';
  minCount: number;
  severities: string[];
  alertSeverity: string;
  titleTemplate: string;
}

export type CorrelationRule = SeverityThresholdRule | EventTypeMatchRule | BatchBurstRule;
