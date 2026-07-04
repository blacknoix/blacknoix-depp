/**
 * Extract a queryable malware/IOC indicator from telemetry payload when present.
 * Agents may emit `fileHash` on malware events; until they do, this returns null.
 */
export function extractAlertIndicator(payload: Record<string, unknown>): string | null {
  const raw = payload.fileHash;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
