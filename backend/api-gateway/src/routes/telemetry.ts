import { Router, Response } from 'express';
import { authenticateAgent } from '../middleware/authenticateAgent';
import { ingestTelemetryBatch } from '../services/telemetryService';
import {
  AgentAuthenticatedRequest,
  TelemetryEventInput,
  VALID_SEVERITIES,
} from '../types/telemetry';

export const telemetryRouter = Router();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidIsoDatetime(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function validateEvents(
  body: unknown
): { ok: true; events: TelemetryEventInput[] } | { ok: false; details: string[] } {
  if (!Array.isArray(body)) {
    return { ok: false, details: ['Request body must be a JSON array'] };
  }

  if (body.length < 1 || body.length > 100) {
    return { ok: false, details: ['Batch must contain between 1 and 100 events'] };
  }

  const details: string[] = [];

  const events: TelemetryEventInput[] = body.map((item, index) => {
    const prefix = `events[${index}]`;
    const data = item as Record<string, unknown>;

    if (typeof data.eventType !== 'string' || !data.eventType.trim()) {
      details.push(`${prefix}.eventType is required`);
    }

    if (
      typeof data.severity !== 'string' ||
      !(VALID_SEVERITIES as readonly string[]).includes(data.severity)
    ) {
      details.push(
        `${prefix}.severity must be one of: ${VALID_SEVERITIES.join(', ')}`
      );
    }

    if (typeof data.occurredAt !== 'string' || !isValidIsoDatetime(data.occurredAt)) {
      details.push(`${prefix}.occurredAt must be a valid ISO datetime string`);
    }

    if (!isPlainObject(data.payload)) {
      details.push(`${prefix}.payload must be a JSON object`);
    }

    return {
      eventType: (data.eventType as string)?.trim() ?? '',
      severity: data.severity as TelemetryEventInput['severity'],
      occurredAt: data.occurredAt as string,
      payload: data.payload as Record<string, unknown>,
    };
  });

  if (details.length > 0) {
    return { ok: false, details };
  }

  return { ok: true, events };
}

/**
 * POST /telemetry/events
 * Agent-authenticated batch telemetry ingestion.
 */
telemetryRouter.post('/events', authenticateAgent, async (req, res: Response): Promise<void> => {
  const validated = validateEvents(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'Validation failed', details: validated.details });
    return;
  }

  const { agentId, tenantId } = (req as AgentAuthenticatedRequest).agent;

  await ingestTelemetryBatch(agentId, tenantId, validated.events);

  res.status(202).json({ accepted: validated.events.length });
});
