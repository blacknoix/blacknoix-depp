import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../types/authTelemetry';
import { getMetricsSnapshot, resetMetrics } from '../lib/metrics';
import {
  TELEMETRY_SCHEMA_VERSION,
  isKnownStrictEventType,
  validateTelemetryEventContract,
} from '../lib/telemetryContract';

beforeEach(() => {
  resetMetrics();
});

describe('validateTelemetryEventContract', () => {
  describe('malware.* payloads', () => {
    it('accepts an empty payload', () => {
      const result = validateTelemetryEventContract({
        eventType: 'malware.trojan',
        payload: {},
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload: {},
      });
    });

    it('accepts optional fileHash', () => {
      const result = validateTelemetryEventContract({
        eventType: 'malware.detected',
        payload: { fileHash: 'abc123' },
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload: { fileHash: 'abc123' },
      });
    });

    it('strips extra unrecognized keys and records drift metric', () => {
      const result = validateTelemetryEventContract({
        eventType: 'malware.detected',
        payload: { fileHash: 'abc123', futureField: 'ignored' },
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload: { fileHash: 'abc123' },
      });
      expect(getMetricsSnapshot().telemetryContractUnknownKeysStripped).toBe(1);
    });

    it('rejects non-string fileHash', () => {
      const result = validateTelemetryEventContract({
        eventType: 'malware.detected',
        payload: { fileHash: 12345 },
      });
      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          expect.stringMatching(/payload\.fileHash.*string/i),
        ]),
      });
      expect(getMetricsSnapshot().telemetryContractUnknownKeysStripped).toBe(0);
    });

    it('rejects empty fileHash', () => {
      const result = validateTelemetryEventContract({
        eventType: 'malware.detected',
        payload: { fileHash: '   ' },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('auth.remote_logon payloads', () => {
    const validPayload = {
      account: 'CORP\\jdoe',
      targetHost: 'workstation-42',
      sourceHost: 'jumpbox-01',
      logonType: 'remoteInteractive',
    };

    it('accepts required and optional fields', () => {
      const result = validateTelemetryEventContract({
        eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
        payload: validPayload,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload: validPayload,
      });
    });

    it('rejects missing targetHost', () => {
      const result = validateTelemetryEventContract({
        eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
        payload: { account: 'jdoe' },
      });
      expect(result.ok).toBe(false);
      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          expect.stringMatching(/payload\.targetHost/i),
        ]),
      });
    });

    it('rejects wrong-type account', () => {
      const result = validateTelemetryEventContract({
        eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
        payload: { account: 1, targetHost: 'host-a' },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('auth.privilege_change payloads', () => {
    it('accepts required and optional fields', () => {
      const payload = {
        account: 'jdoe',
        host: 'workstation-42',
        grantedTo: 'admin',
        mechanism: 'sudo',
      };
      const result = validateTelemetryEventContract({
        eventType: AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
        payload,
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload,
      });
    });

    it('rejects missing host', () => {
      const result = validateTelemetryEventContract({
        eventType: AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
        payload: { account: 'jdoe' },
      });
      expect(result.ok).toBe(false);
      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([expect.stringMatching(/payload\.host/i)]),
      });
    });
  });

  describe('progressive validation', () => {
    it('passes unrecognized event types through without payload validation', () => {
      const payload = { totally: 'opaque', count: 42 };
      const result = validateTelemetryEventContract({
        eventType: 'custom.sensor.reading',
        payload,
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload,
      });
      expect(getMetricsSnapshot().telemetryContractUnknownKeysStripped).toBe(0);
    });

    it('still validates schemaVersion when present on opaque event types', () => {
      const result = validateTelemetryEventContract({
        eventType: 'custom.sensor.reading',
        payload: { any: 'shape' },
        schemaVersion: 99,
      });
      expect(result.ok).toBe(false);
      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          expect.stringMatching(/schemaVersion: must be 1/),
        ]),
      });
    });
  });

  describe('schemaVersion', () => {
    it('defaults to the current version when omitted', () => {
      const result = validateTelemetryEventContract({
        eventType: 'process.start',
        payload: { pid: 1 },
      });
      expect(result).toEqual({
        ok: true,
        schemaVersion: TELEMETRY_SCHEMA_VERSION,
        payload: { pid: 1 },
      });
    });

    it('rejects unsupported schema versions', () => {
      const result = validateTelemetryEventContract({
        eventType: 'process.start',
        payload: { pid: 1 },
        schemaVersion: 2,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('isKnownStrictEventType', () => {
    it('matches malware prefix and auth event types only', () => {
      expect(isKnownStrictEventType('malware.trojan')).toBe(true);
      expect(isKnownStrictEventType(AUTH_REMOTE_LOGON_EVENT_TYPE)).toBe(true);
      expect(isKnownStrictEventType(AUTH_PRIVILEGE_CHANGE_EVENT_TYPE)).toBe(true);
      expect(isKnownStrictEventType('process.start')).toBe(false);
    });
  });
});
