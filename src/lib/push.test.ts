import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => segments.join('/')),
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('../firebase', () => ({ db: { mock: 'db' } }));
vi.mock('firebase/firestore', () => firestore);

import {
  detectIos,
  disablePush,
  enablePush,
  getPushState,
  isStandalone,
  isSupportedPushEndpoint,
  sameKey,
  sha256Hex,
  urlBase64ToUint8Array,
} from './push';

/** web-push のドキュメントにある公開鍵の例（65 バイト） */
const VAPID_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const OTHER_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('detectIos', () => {
  it('iPhone・iPad の UA', () => {
    expect(detectIos(IPHONE_UA, 'iPhone', 5)).toBe(true);
    expect(detectIos(IPHONE_UA.replace('iPhone;', 'iPad;'), 'iPad', 5)).toBe(true);
  });

  it('iPadOS のデスクトップ表示（MacIntel + タッチ）', () => {
    expect(detectIos(MAC_UA, 'MacIntel', 5)).toBe(true);
  });

  it('Mac・Android は iOS ではない', () => {
    expect(detectIos(MAC_UA, 'MacIntel', 0)).toBe(false);
    expect(detectIos(ANDROID_UA, 'Linux armv8l', 5)).toBe(false);
  });
});

describe('urlBase64ToUint8Array / sameKey', () => {
  it('VAPID 公開鍵は 65 バイトで 0x04 から始まる', () => {
    const bytes = urlBase64ToUint8Array(VAPID_KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it('同じ鍵かどうか', () => {
    const a = urlBase64ToUint8Array(VAPID_KEY);
    expect(sameKey(a.buffer, urlBase64ToUint8Array(VAPID_KEY))).toBe(true);
    expect(sameKey(a.buffer, urlBase64ToUint8Array(OTHER_KEY))).toBe(false);
    expect(sameKey(null, a)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('16 進 64 文字', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

// ---- ブラウザの API を差し替えて状態遷移を確かめる ----

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSubscription(endpoint: string, key: string): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: urlBase64ToUint8Array(key).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256DH', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

interface BrowserOptions {
  ua?: string;
  platform?: string;
  touch?: number;
  standalone?: boolean;
  push?: boolean;
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  subscription?: FakeSubscription | null;
}

function setupBrowser(opts: BrowserOptions & { newEndpoint?: string } = {}) {
  let subscription = opts.subscription ?? null;
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async (o: { applicationServerKey: Uint8Array }) => {
      subscription = fakeSubscription(opts.newEndpoint ?? 'https://web.push.apple.com/NEW', VAPID_KEY);
      subscription.options.applicationServerKey = o.applicationServerKey.slice().buffer;
      return subscription;
    }),
  };
  const registration = { pushManager, scope: 'https://book.example/', showNotification: vi.fn(async () => undefined) };
  const notification = {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => opts.requestResult ?? 'granted'),
  };
  const win: Record<string, unknown> = {
    matchMedia: () => ({ matches: opts.standalone ?? false }),
    Notification: notification,
  };
  if (opts.push !== false) win.PushManager = class {};
  vi.stubGlobal('window', win);
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('navigator', {
    userAgent: opts.ua ?? IPHONE_UA,
    platform: opts.platform ?? 'iPhone',
    maxTouchPoints: opts.touch ?? 5,
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
    },
  });
  return { pushManager, notification, registration, current: () => subscription };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getPushState', () => {
  it('iPhone の Safari（ホーム画面から開いていない）は needs-install', async () => {
    setupBrowser({ standalone: false, push: false });
    expect(isStandalone()).toBe(false);
    expect(await getPushState()).toBe('needs-install');
  });

  it('PushManager が無ければ unsupported', async () => {
    setupBrowser({ ua: ANDROID_UA, platform: 'Linux', push: false });
    expect(await getPushState()).toBe('unsupported');
  });

  it('許可の状態と購読で denied / off / on', async () => {
    setupBrowser({ standalone: true, permission: 'denied' });
    expect(await getPushState()).toBe('denied');

    setupBrowser({ standalone: true, permission: 'default' });
    expect(await getPushState()).toBe('off');

    setupBrowser({ standalone: true, permission: 'granted', subscription: null });
    expect(await getPushState()).toBe('off');

    setupBrowser({ standalone: true, permission: 'granted', subscription: fakeSubscription('https://x/1', VAPID_KEY) });
    expect(await getPushState()).toBe('on');
  });

  it('公開鍵が変わった古い購読は off', async () => {
    setupBrowser({ standalone: true, permission: 'granted', subscription: fakeSubscription('https://x/1', OTHER_KEY) });
    expect(await getPushState()).toBe('off');
  });
});

describe('enablePush', () => {
  it('許可 → 購読 → Firestore に保存', async () => {
    const browser = setupBrowser({ standalone: true });
    await enablePush('g1', 'u1');

    expect(browser.notification.requestPermission).toHaveBeenCalledOnce();
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    const id = await sha256Hex('https://web.push.apple.com/NEW');
    expect(firestore.setDoc).toHaveBeenCalledWith(`groups/g1/pushSubscriptions/${id}`, {
      uid: 'u1',
      endpoint: 'https://web.push.apple.com/NEW',
      keys: { p256dh: 'P256DH', auth: 'AUTH' },
      userAgent: IPHONE_UA,
      createdAt: 'SERVER_TIMESTAMP',
    });
  });

  it('同じ鍵の購読があればそれを使う', async () => {
    const existing = fakeSubscription('https://web.push.apple.com/OLD', VAPID_KEY);
    const browser = setupBrowser({ standalone: true, subscription: existing });
    await enablePush('g1', 'u1');
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    const id = await sha256Hex('https://web.push.apple.com/OLD');
    expect(firestore.setDoc).toHaveBeenCalledWith(`groups/g1/pushSubscriptions/${id}`, expect.anything());
  });

  it('別の鍵の購読は解除して購読し直す', async () => {
    const existing = fakeSubscription('https://web.push.apple.com/OLD', OTHER_KEY);
    const browser = setupBrowser({ standalone: true, subscription: existing });
    await enablePush('g1', 'u1');
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(browser.pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it('許可されなければエラーで、購読しない', async () => {
    const browser = setupBrowser({ standalone: true, requestResult: 'denied' });
    await expect(enablePush('g1', 'u1')).rejects.toThrow(/ブロック/);
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('VAPID 公開鍵が無ければ許可を求める前に分かるエラー', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    const browser = setupBrowser({ standalone: true });
    await expect(enablePush('g1', 'u1')).rejects.toThrow(/VITE_VAPID_PUBLIC_KEY/);
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('VAPID 公開鍵の形式が違えばエラー', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'not-a-key');
    setupBrowser({ standalone: true });
    await expect(enablePush('g1', 'u1')).rejects.toThrow(/形式/);
  });

  it('iPhone でホーム画面から開いていなければエラー', async () => {
    setupBrowser({ standalone: false });
    await expect(enablePush('g1', 'u1')).rejects.toThrow(/ホーム画面/);
  });

  it('対応していないプッシュサービスなら保存せず、購読も解除する', async () => {
    const browser = setupBrowser({ standalone: true, newEndpoint: 'https://push.example.com/abc' });
    await expect(enablePush('g1', 'u1')).rejects.toThrow(/対応していません/);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(browser.current()?.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('isSupportedPushEndpoint', () => {
  it('主要なブラウザのプッシュサービスだけ', () => {
    expect(isSupportedPushEndpoint('https://web.push.apple.com/QGxhYmVs')).toBe(true);
    expect(isSupportedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true);
    expect(isSupportedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAA')).toBe(true);
    expect(isSupportedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=BQYAAA')).toBe(true);
    expect(isSupportedPushEndpoint('https://attacker.example/x')).toBe(false);
    expect(isSupportedPushEndpoint('https://web.push.apple.com.attacker.example/x')).toBe(false);
    expect(isSupportedPushEndpoint('https://web.push.apple.com:8443/x')).toBe(false);
    expect(isSupportedPushEndpoint('https://web.push.apple.com/')).toBe(false);
    expect(isSupportedPushEndpoint('http://web.push.apple.com/x')).toBe(false);
  });
});

describe('disablePush', () => {
  it('購読を解除して Firestore から削除', async () => {
    const existing = fakeSubscription('https://web.push.apple.com/OLD', VAPID_KEY);
    setupBrowser({ standalone: true, permission: 'granted', subscription: existing });
    await disablePush('g1');
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    const id = await sha256Hex('https://web.push.apple.com/OLD');
    expect(firestore.deleteDoc).toHaveBeenCalledWith(`groups/g1/pushSubscriptions/${id}`);
  });

  it('購読が無ければ何もしない', async () => {
    setupBrowser({ standalone: true, permission: 'granted', subscription: null });
    await disablePush('g1');
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });
});
