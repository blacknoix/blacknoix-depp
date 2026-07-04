import { extractAlertIndicator } from '../lib/alertIndicator';

describe('extractAlertIndicator', () => {
  it('returns trimmed fileHash when present', () => {
    expect(
      extractAlertIndicator({ fileHash: '  abc123def456  ' })
    ).toBe('abc123def456');
  });

  it('returns null when fileHash is missing', () => {
    expect(extractAlertIndicator({ pid: 1 })).toBeNull();
  });

  it('returns null when fileHash is empty or whitespace', () => {
    expect(extractAlertIndicator({ fileHash: '' })).toBeNull();
    expect(extractAlertIndicator({ fileHash: '   ' })).toBeNull();
  });

  it('returns null when fileHash is not a string', () => {
    expect(extractAlertIndicator({ fileHash: 12345 })).toBeNull();
  });
});
