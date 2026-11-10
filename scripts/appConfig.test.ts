import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { missingForDeploy, resolveAppConfig, toEnvLines, type AppConfigFile } from './appConfig';

const filled: AppConfigFile = {
  firebase: {
    apiKey: 'AIzaTest',
    authDomain: '',
    projectId: 'karita-hon-1a2b3',
    appId: '1:123:web:abc',
    messagingSenderId: '123',
  },
  vapidPublicKey: 'BNxPublic',
  vapidSubject: 'mailto:someone@example.com',
  notifyGroupIds: 'groupA',
  googleSignIn: false,
  googleBooksApiKey: '',
};

describe('resolveAppConfig', () => {
  it('app.config.json の値から環境変数を作る（ログイン用ドメインと URL は web.app）', () => {
    const c = resolveAppConfig(filled, {});
    expect(c.VITE_FIREBASE_API_KEY).toBe('AIzaTest');
    expect(c.VITE_FIREBASE_AUTH_DOMAIN).toBe('karita-hon-1a2b3.web.app');
    expect(c.APP_URL).toBe('https://karita-hon-1a2b3.web.app');
    expect(c.VITE_VAPID_PUBLIC_KEY).toBe('BNxPublic');
    expect(c.VAPID_PUBLIC_KEY).toBe('BNxPublic');
    expect(c.VITE_GOOGLE_SIGN_IN).toBe('false');
    expect(c.NOTIFY_GROUP_IDS).toBe('groupA');
    expect(missingForDeploy(c)).toEqual([]);
  });

  it('GitHub の Variables に値があればそちらを優先し、空なら app.config.json を使う', () => {
    const c = resolveAppConfig(filled, { NOTIFY_GROUP_IDS: 'fromVars', VITE_FIREBASE_API_KEY: '  ' });
    expect(c.NOTIFY_GROUP_IDS).toBe('fromVars');
    expect(c.VITE_FIREBASE_API_KEY).toBe('AIzaTest');
  });

  it('Variables のプロジェクト ID から URL を決める', () => {
    const c = resolveAppConfig({}, { VITE_FIREBASE_PROJECT_ID: 'other-proj' });
    expect(c.APP_URL).toBe('https://other-proj.web.app');
    expect(c.VITE_FIREBASE_AUTH_DOMAIN).toBe('other-proj.web.app');
  });

  it('googleSignIn が true のときだけ VITE_GOOGLE_SIGN_IN=true', () => {
    expect(resolveAppConfig({ ...filled, googleSignIn: true }, {}).VITE_GOOGLE_SIGN_IN).toBe('true');
  });

  it('空の設定では必須項目が足りないと分かる', () => {
    const c = resolveAppConfig({}, {});
    expect(missingForDeploy(c)).toContain('VITE_FIREBASE_API_KEY');
    expect(missingForDeploy(c)).toContain('VITE_VAPID_PUBLIC_KEY');
  });

  it('toEnvLines は KEY=VALUE を 1 行ずつ出し、改行を含めない', () => {
    const lines = toEnvLines(resolveAppConfig({ ...filled, notifyGroupIds: 'a\nb' }, {}));
    expect(lines).toContain('NOTIFY_GROUP_IDS=a b\n');
    expect(lines.trim().split('\n')).toHaveLength(12);
  });

  it('リポジトリの app.config.json は JSON として読める', () => {
    const raw = readFileSync(new URL('../app.config.json', import.meta.url), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
