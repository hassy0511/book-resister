import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  EMULATOR_PROJECT_ID,
  parseArgs,
  parseServiceAccount,
  readAppUrl,
  readFirebaseTarget,
  readVapidConfig,
} from './config';

const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'book-resister',
  client_email: 'notify@book-resister.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n',
});

describe('parseArgs', () => {
  it('既定は送信する', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, today: null });
  });

  it('--dry-run と --today', () => {
    expect(parseArgs(['--dry-run', '--today', '2026-11-08'])).toEqual({ dryRun: true, today: '2026-11-08' });
    expect(parseArgs(['--today=2026-12-31'])).toEqual({ dryRun: false, today: '2026-12-31' });
  });

  it('不正な引数は ConfigError', () => {
    expect(() => parseArgs(['--dryrun'])).toThrow(ConfigError);
    expect(() => parseArgs(['--today'])).toThrow(ConfigError);
    expect(() => parseArgs(['--today=2026-02-30'])).toThrow(ConfigError);
  });
});

describe('parseServiceAccount / readFirebaseTarget', () => {
  it('JSON から認証情報を取り出す', () => {
    expect(parseServiceAccount(SERVICE_ACCOUNT)).toEqual({
      projectId: 'book-resister',
      clientEmail: 'notify@book-resister.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n',
    });
  });

  it('壊れた JSON や項目不足は ConfigError（秘密鍵をメッセージに出さない）', () => {
    expect(() => parseServiceAccount('{"private_key": "SECRET"')).toThrow(ConfigError);
    try {
      parseServiceAccount('{"private_key": "SECRET"}');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain('project_id');
      expect((e as Error).message).not.toContain('SECRET');
    }
  });

  it('サービスアカウントが無くエミュレータの指定があればエミュレータ', () => {
    expect(readFirebaseTarget({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toEqual({
      kind: 'emulator',
      projectId: EMULATOR_PROJECT_ID,
      host: '127.0.0.1:8080',
    });
    expect(readFirebaseTarget({ FIREBASE_SERVICE_ACCOUNT: SERVICE_ACCOUNT, FIRESTORE_EMULATOR_HOST: 'x' }).kind).toBe(
      'service-account',
    );
  });

  it('どちらも無ければ ConfigError', () => {
    expect(() => readFirebaseTarget({})).toThrow(ConfigError);
    expect(() => readFirebaseTarget({ FIREBASE_SERVICE_ACCOUNT: '  ' })).toThrow(ConfigError);
  });
});

describe('readVapidConfig', () => {
  const keys = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };

  it('VAPID_SUBJECT を使う', () => {
    expect(readVapidConfig({ ...keys, VAPID_SUBJECT: 'mailto:family@example.com' })).toEqual({
      subject: 'mailto:family@example.com',
      publicKey: 'pub',
      privateKey: 'priv',
    });
  });

  it('VAPID_SUBJECT が無ければ https の APP_URL を使う', () => {
    expect(readVapidConfig({ ...keys, APP_URL: 'https://book.example.web.app/' }).subject).toBe(
      'https://book.example.web.app/',
    );
    expect(() => readVapidConfig({ ...keys, APP_URL: '/' })).toThrow(ConfigError);
  });

  it('鍵が無い・subject の形式が違うと ConfigError', () => {
    expect(() => readVapidConfig({ VAPID_SUBJECT: 'mailto:a@example.com' })).toThrow(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY/);
    expect(() => readVapidConfig({ ...keys, VAPID_SUBJECT: 'family@example.com' })).toThrow(ConfigError);
  });
});

describe('readAppUrl', () => {
  it('未設定なら /', () => {
    expect(readAppUrl({})).toBe('/');
    expect(readAppUrl({ APP_URL: ' ' })).toBe('/');
  });

  it('パスか http(s) の URL', () => {
    expect(readAppUrl({ APP_URL: '/?from=notification' })).toBe('/?from=notification');
    expect(readAppUrl({ APP_URL: 'https://book.example.web.app' })).toBe('https://book.example.web.app/');
  });

  it('それ以外は ConfigError', () => {
    expect(() => readAppUrl({ APP_URL: 'book.example.web.app' })).toThrow(ConfigError);
    expect(() => readAppUrl({ APP_URL: '//evil.example.com' })).toThrow(ConfigError);
    expect(() => readAppUrl({ APP_URL: 'javascript:alert(1)' })).toThrow(ConfigError);
  });
});
