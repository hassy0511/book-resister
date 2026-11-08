/**
 * Web Push の送信（web-push）。
 */
import { sendNotification, setVapidDetails, WebPushError, type RequestOptions } from 'web-push';
import { ConfigError, type VapidConfig } from './config';
import type { StoredSubscription } from './firestore';

/** 端末に届くまで保持する時間（秒）。翌朝には新しい通知が出るので半日で十分 */
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
/** 1 件の送信のソケットタイムアウト（ミリ秒） */
export const PUSH_TIMEOUT_MS = 15_000;

export type SendOutcome =
  | { kind: 'sent'; statusCode: number }
  /** 購読が無効（404/410）。Firestore から削除する */
  | { kind: 'gone'; statusCode: number }
  | { kind: 'failed'; statusCode: number | null; message: string };

/** 購読が無効になったことを示すステータス */
export function isGoneStatus(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

/** VAPID 鍵を検証して設定する。形式が違えば ConfigError */
export function configureVapid(vapid: VapidConfig): void {
  try {
    setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`VAPID の設定が正しくありません: ${detail}`);
  }
}

/** ログ用の送信先の表示（endpoint は推測されると送信できてしまうので、ホスト名と ID の先頭だけ） */
export function describeSubscription(sub: Pick<StoredSubscription, 'id' | 'endpoint'>): string {
  let host = '不明なホスト';
  try {
    host = new URL(sub.endpoint).host;
  } catch {
    // そのまま
  }
  return `${host} (${sub.id.slice(0, 8)})`;
}

function shorten(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 1 件送る。例外は投げず、結果を返す */
export async function sendPush(
  sub: StoredSubscription,
  payload: string,
  opts: { proxy?: string } = {},
): Promise<SendOutcome> {
  const options: RequestOptions = {
    TTL: PUSH_TTL_SECONDS,
    urgency: 'high',
    timeout: PUSH_TIMEOUT_MS,
  };
  if (opts.proxy) options.proxy = opts.proxy;
  try {
    const result = await sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, options);
    return { kind: 'sent', statusCode: result.statusCode };
  } catch (e) {
    if (e instanceof WebPushError) {
      if (isGoneStatus(e.statusCode)) return { kind: 'gone', statusCode: e.statusCode };
      const body = typeof e.body === 'string' && e.body ? `: ${shorten(e.body)}` : '';
      return { kind: 'failed', statusCode: e.statusCode, message: `HTTP ${e.statusCode}${body}` };
    }
    return { kind: 'failed', statusCode: null, message: e instanceof Error ? e.message : String(e) };
  }
}
