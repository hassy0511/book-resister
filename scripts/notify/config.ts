/**
 * 通知スクリプトのコマンドライン引数と環境変数の読み取り（純粋関数）。
 *
 * 環境変数:
 *   FIREBASE_SERVICE_ACCOUNT  サービスアカウントの JSON（文字列そのまま）
 *   VAPID_PUBLIC_KEY          VAPID 公開鍵（アプリの VITE_VAPID_PUBLIC_KEY と同じ値）
 *   VAPID_PRIVATE_KEY         VAPID 秘密鍵
 *   VAPID_SUBJECT             'mailto:...' か 'https://...'（未設定なら https の APP_URL を使う）
 *   APP_URL                   通知をタップしたときに開く URL（既定 '/'）
 * ローカル確認用: FIRESTORE_EMULATOR_HOST があればサービスアカウント無しでエミュレータに接続する。
 */
import { isDateString } from '../../src/lib/date';
import type { DateString } from '../../src/types';

/** 設定の誤り（メッセージはそのまま利用者に見せる） */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

export interface CliOptions {
  /** 送信・削除をせず、内容だけ表示する */
  dryRun: boolean;
  /** 「今日」を差し替える（確認用）。null なら日本時間の今日 */
  today: DateString | null;
}

export const USAGE = '使い方: npx tsx scripts/notify/index.ts [--dry-run] [--today YYYY-MM-DD]';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { dryRun: false, today: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--today' || arg.startsWith('--today=')) {
      const value = arg === '--today' ? argv[++i] : arg.slice('--today='.length);
      if (!value || !isDateString(value)) {
        throw new ConfigError(`--today には YYYY-MM-DD 形式の日付を指定してください（指定値: ${value ?? 'なし'}）。`);
      }
      options.today = value;
    } else {
      throw new ConfigError(`不明な引数です: ${arg}\n${USAGE}`);
    }
  }
  return options;
}

function envValue(env: Env, name: string): string {
  return (env[name] ?? '').trim();
}

export interface ServiceAccountCredential {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export type FirebaseTarget =
  | { kind: 'service-account'; credential: ServiceAccountCredential }
  | { kind: 'emulator'; projectId: string; host: string };

/** エミュレータ利用時の既定プロジェクト ID（package.json の emulators スクリプトと合わせる） */
export const EMULATOR_PROJECT_ID = 'demo-book-resister';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** サービスアカウントの JSON 文字列を読む。中身（秘密鍵）はエラーメッセージに含めない */
export function parseServiceAccount(json: string): ServiceAccountCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ConfigError(
      'FIREBASE_SERVICE_ACCOUNT を JSON として読めません。サービスアカウントの鍵ファイル（.json）の中身をそのまま登録してください。',
    );
  }
  if (!isRecord(parsed)) {
    throw new ConfigError('FIREBASE_SERVICE_ACCOUNT の形式が正しくありません（JSON オブジェクトではありません）。');
  }
  const pick = (key: string): string => {
    const value = parsed[key];
    return typeof value === 'string' ? value : '';
  };
  const projectId = pick('project_id');
  const clientEmail = pick('client_email');
  const privateKey = pick('private_key');
  const missing = [
    projectId ? null : 'project_id',
    clientEmail ? null : 'client_email',
    privateKey ? null : 'private_key',
  ].filter((x): x is string => x !== null);
  if (missing.length > 0) {
    throw new ConfigError(`FIREBASE_SERVICE_ACCOUNT に ${missing.join(', ')} がありません。`);
  }
  return { projectId, clientEmail, privateKey };
}

/** 接続先の Firestore を決める */
export function readFirebaseTarget(env: Env): FirebaseTarget {
  const json = envValue(env, 'FIREBASE_SERVICE_ACCOUNT');
  if (json) return { kind: 'service-account', credential: parseServiceAccount(json) };
  const emulatorHost = envValue(env, 'FIRESTORE_EMULATOR_HOST');
  if (emulatorHost) {
    const projectId = envValue(env, 'GCLOUD_PROJECT') || envValue(env, 'GOOGLE_CLOUD_PROJECT') || EMULATOR_PROJECT_ID;
    return { kind: 'emulator', projectId, host: emulatorHost };
  }
  throw new ConfigError(
    'FIREBASE_SERVICE_ACCOUNT が設定されていません。GitHub の Settings > Secrets and variables > Actions に登録してください。',
  );
}

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** VAPID の設定。形式の細かい検証は web-push の setVapidDetails に任せる */
export function readVapidConfig(env: Env): VapidConfig {
  const publicKey = envValue(env, 'VAPID_PUBLIC_KEY');
  const privateKey = envValue(env, 'VAPID_PRIVATE_KEY');
  let subject = envValue(env, 'VAPID_SUBJECT');
  if (!subject) {
    const appUrl = envValue(env, 'APP_URL');
    if (isHttpsUrl(appUrl)) subject = appUrl;
  }
  const missing = [
    publicKey ? null : 'VAPID_PUBLIC_KEY',
    privateKey ? null : 'VAPID_PRIVATE_KEY',
    subject ? null : 'VAPID_SUBJECT',
  ].filter((x): x is string => x !== null);
  if (missing.length > 0) {
    throw new ConfigError(
      `${missing.join(', ')} が設定されていません（VAPID_PRIVATE_KEY は Secrets、それ以外は Variables に登録します）。`,
    );
  }
  if (!subject.startsWith('mailto:') && !isHttpsUrl(subject)) {
    throw new ConfigError('VAPID_SUBJECT は「mailto:メールアドレス」か「https://〜」の形式で指定してください。');
  }
  return { subject, publicKey, privateKey };
}

/** 通知をタップしたときに開く URL。未設定なら '/'（SW のスコープ内のホーム） */
export function readAppUrl(env: Env): string {
  const value = envValue(env, 'APP_URL');
  if (!value) return '/';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    // 下で ConfigError にする
  }
  throw new ConfigError(`APP_URL は「https://〜」か「/」で始まるパスで指定してください（指定値: ${value}）。`);
}

/** web-push に渡すプロキシ（社内ネットワークなどでローカル実行する場合のみ） */
export function readProxy(env: Env): string | undefined {
  return envValue(env, 'HTTPS_PROXY') || envValue(env, 'https_proxy') || undefined;
}
