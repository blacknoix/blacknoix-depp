import {
  authTelemetryColumnsForEvent,
  extractPrivilegeChangeAuthFields,
  extractRemoteLogonAuthFields,
} from '../lib/authTelemetryExtractors';
import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../types/authTelemetry';

describe('extractRemoteLogonAuthFields', () => {
  it('returns structured columns when account and targetHost are present', () => {
    expect(
      extractRemoteLogonAuthFields({
        account: ' CORP\\jdoe ',
        targetHost: 'workstation-01',
        sourceHost: 'jumpbox-02',
        logonType: 'remoteInteractive',
      })
    ).toEqual({
      authAccount: 'CORP\\jdoe',
      authHost: 'workstation-01',
      authGrantedTo: null,
      authSourceHost: 'jumpbox-02',
    });
  });

  it('returns null when account or targetHost is missing', () => {
    expect(extractRemoteLogonAuthFields({ targetHost: 'host-a' })).toBeNull();
    expect(extractRemoteLogonAuthFields({ account: 'user-a' })).toBeNull();
    expect(extractRemoteLogonAuthFields({})).toBeNull();
  });
});

describe('extractPrivilegeChangeAuthFields', () => {
  it('returns structured columns when account and host are present', () => {
    expect(
      extractPrivilegeChangeAuthFields({
        account: 'jdoe',
        host: 'server-01',
        grantedTo: 'admin',
        mechanism: 'sudo',
      })
    ).toEqual({
      authAccount: 'jdoe',
      authHost: 'server-01',
      authGrantedTo: 'admin',
      authSourceHost: null,
    });
  });

  it('returns null when account or host is missing', () => {
    expect(extractPrivilegeChangeAuthFields({ host: 'server-01' })).toBeNull();
    expect(extractPrivilegeChangeAuthFields({ account: 'jdoe' })).toBeNull();
  });
});

describe('authTelemetryColumnsForEvent', () => {
  it('returns all-null columns for non-auth event types', () => {
    expect(
      authTelemetryColumnsForEvent('process.start', { account: 'ignored' })
    ).toEqual({
      authAccount: null,
      authHost: null,
      authGrantedTo: null,
      authSourceHost: null,
    });
  });

  it('dispatches by eventType', () => {
    expect(
      authTelemetryColumnsForEvent(AUTH_REMOTE_LOGON_EVENT_TYPE, {
        account: 'a',
        targetHost: 'h1',
      }).authAccount
    ).toBe('a');

    expect(
      authTelemetryColumnsForEvent(AUTH_PRIVILEGE_CHANGE_EVENT_TYPE, {
        account: 'b',
        host: 'h2',
        grantedTo: 'admin',
      }).authGrantedTo
    ).toBe('admin');
  });
});
