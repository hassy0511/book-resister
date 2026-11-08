/// <reference lib="webworker" />
/**
 * Service Worker（vite-plugin-pwa の injectManifest でビルドする）。
 * - ビルド成果物のプリキャッシュと、古いキャッシュの削除
 * - SPA のナビゲーションは index.html にフォールバック（Firebase Auth の /__/ は除く）
 * - 返却日の通知（push）と、通知をタップしたときにアプリを開く（notificationclick）
 *
 * 注意: classic スクリプトとして登録されるので、このファイルからは何も export しない。
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

// registerType: 'autoUpdate' のため、新しい SW はすぐに有効にして開いている画面も制御下に置く
self.skipWaiting();
clientsClaim();

// self.__WB_MANIFEST はビルド時に置き換わる（1 か所だけで参照すること）
const precacheManifest = self.__WB_MANIFEST;
precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();

function isPrecached(entries: Array<PrecacheEntry | string>, path: string): boolean {
  return entries.some((entry) => (typeof entry === 'string' ? entry : entry.url).replace(/^\.?\//, '') === path);
}

// アプリ内のパス（/loans/xxx など）を直接開いた・再読み込みした場合も index.html を返す。
// /__/ で始まるパスは Firebase Auth のハンドラ（/__/auth/handler など）なのでネットワークに任せる。
if (isPrecached(precacheManifest, 'index.html')) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/__\//] }));
}

// ---- 通知 ----

/** scripts/notify から届くペイロード（scripts/notify/messages.ts の PushPayload と同じ形） */
interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string | null;
}

const DEFAULT_TITLE = '返却日のお知らせ';
const DEFAULT_BODY = 'アプリを開いて返却日を確認してください。';
const MAX_BODY_LENGTH = 500;

function scopeUrl(path: string): string {
  return new URL(path, self.registration.scope).href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * push のデータを読む。形式が正しくなくても必ず何か表示できる内容を返す
 * （iOS は push を受けて通知を出さないと購読を取り消すため）。
 */
function readPushPayload(data: PushMessageData | null): PushPayload {
  const fallback: PushPayload = { title: DEFAULT_TITLE, body: DEFAULT_BODY, url: '/', tag: null };
  if (!data) return fallback;
  let text: string;
  try {
    text = data.text();
  } catch {
    return fallback;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON でなければ文字列をそのまま本文にする
    const plain = text.trim();
    return plain ? { ...fallback, body: plain.slice(0, MAX_BODY_LENGTH) } : fallback;
  }
  if (!isRecord(json)) return fallback;
  return {
    title: nonEmptyString(json.title) ?? DEFAULT_TITLE,
    body: (nonEmptyString(json.body) ?? DEFAULT_BODY).slice(0, MAX_BODY_LENGTH),
    url: nonEmptyString(json.url) ?? '/',
    tag: nonEmptyString(json.tag),
  };
}

async function showPushNotification(payload: PushPayload): Promise<void> {
  const icon = scopeUrl('icons/icon-192.png');
  const options: NotificationOptions = {
    body: payload.body,
    icon,
    badge: icon,
    lang: 'ja',
    data: { url: payload.url },
  };
  // 同じ tag の通知は置き換わる（同じ日に再送しても 1 件だけ残る）
  if (payload.tag) options.tag = payload.tag;
  try {
    await self.registration.showNotification(payload.title, options);
  } catch {
    // オプションが原因で失敗した場合も、最低限の通知は出す
    await self.registration.showNotification(DEFAULT_TITLE, { body: DEFAULT_BODY, data: { url: '/' } });
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(showPushNotification(readPushPayload(event.data)));
});

/** 通知に入っている URL。別オリジンや不正な値ならアプリのトップ */
function notificationTargetUrl(data: unknown): string {
  const raw = isRecord(data) ? nonEmptyString(data.url) : null;
  if (raw) {
    try {
      const url = new URL(raw, self.registration.scope);
      if (url.origin === self.location.origin) return url.href;
    } catch {
      // トップを開く
    }
  }
  return scopeUrl('./');
}

/** 開いているウィンドウがあれば前面に出して移動し、無ければ新しく開く */
async function openApp(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((w) => w.focused) ?? windows.find((w) => w.visibilityState === 'visible') ?? windows[0];
  if (!existing) {
    await self.clients.openWindow(url);
    return;
  }
  let client: WindowClient = existing;
  try {
    client = await existing.focus();
  } catch {
    // 前面に出せなくても移動は試す
  }
  if (client.url === url) return;
  try {
    await client.navigate(url);
  } catch {
    // 制御下にないウィンドウは移動できない。前面に出ていれば十分とする
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openApp(notificationTargetUrl(event.notification.data)));
});
