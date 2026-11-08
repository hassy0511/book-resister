/**
 * Web Push の送信（web-push）。
 */
import { Agent } from 'node:https';
import { sendNotification, setVapidDetails, WebPushError, type RequestOptions, type SendResult } from 'web-push';
import { ConfigError, type VapidConfig } from './config';
import type { StoredSubscription } from './firestore';

/** 端末に届くまで保持する時間（秒）。翌朝には新しい通知が出るので半日で十分 */
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
/** 1 件の送信のソケットの無通信タイムアウト（ミリ秒）。少しずつ応答が届く間は切れない */
export const PUSH_TIMEOUT_MS = 15_000;
/**
 * 1 件の送信の締め切り（ミリ秒）。接続から応答の受信までの全体にかける。
 * web-push の timeout は無通信の時間しか見ないので、応答を少しずつ返し続ける相手には別に締め切りが要る。
 */
export const PUSH_DEADLINE_MS = 20_000;

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

type Sender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: RequestOptions,
) => Promise<SendResult>;

export interface SendPushOptions {
  /** ローカル実行用のプロキシ */
  proxy?: string;
  /** 締め切り（既定 PUSH_DEADLINE_MS） */
  deadlineMs?: number;
  /** テスト用: 実際の送信の代わり */
  send?: Sender;
}

function statusHint(statusCode: number): string {
  if (statusCode === 413) return '（通知の内容が大きすぎます）';
  return '';
}

/** 1 件送る。例外は投げず、結果を返す。締め切りを過ぎたら接続を切って失敗にする */
export async function sendPush(sub: StoredSubscription, payload: string, opts: SendPushOptions = {}): Promise<SendOutcome> {
  const deadlineMs = opts.deadlineMs ?? PUSH_DEADLINE_MS;
  const send = opts.send ?? sendNotification;
  // 締め切りで接続を確実に切るため、送信ごとに専用の Agent を使う（プロキシ経由のときは web-push が自前の Agent を使う）
  const agent = opts.proxy ? null : new Agent({ keepAlive: false });
  const options: RequestOptions = {
    TTL: PUSH_TTL_SECONDS,
    urgency: 'high',
    timeout: PUSH_TIMEOUT_MS,
  };
  if (opts.proxy) options.proxy = opts.proxy;
  else if (agent) options.agent = agent;

  const attempt = async (): Promise<SendOutcome> => {
    try {
      const result = await send({ endpoint: sub.endpoint, keys: sub.keys }, payload, options);
      return { kind: 'sent', statusCode: result.statusCode };
    } catch (e) {
      if (e instanceof WebPushError) {
        if (isGoneStatus(e.statusCode)) return { kind: 'gone', statusCode: e.statusCode };
        const body = typeof e.body === 'string' && e.body ? `: ${shorten(e.body)}` : '';
        return {
          kind: 'failed',
          statusCode: e.statusCode,
          message: `HTTP ${e.statusCode}${statusHint(e.statusCode)}${body}`,
        };
      }
      return { kind: 'failed', statusCode: null, message: e instanceof Error ? e.message : String(e) };
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<SendOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        kind: 'failed',
        statusCode: null,
        message: `${Math.round(deadlineMs / 1000)} 秒以内に送信が終わらなかったため打ち切りました`,
      });
    }, deadlineMs);
  });
  try {
    return await Promise.race([attempt(), deadline]);
  } finally {
    clearTimeout(timer);
    // 使い終わった（または締め切りを過ぎた）接続を切る
    agent?.destroy();
  }
}

/**
 * items を最大 limit 件ずつ同時に処理する。結果は items と同じ順番。
 * fn は例外を投げないこと（投げた場合はそのまま reject する）。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
