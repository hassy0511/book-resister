/**
 * app.config.json（リポジトリに置く「秘密ではない設定」）を、ビルドと通知のための環境変数に変換する。
 *
 * GitHub Actions のデプロイと毎朝の通知で使う。GitHub の Variables に同じ名前の値があれば、そちらを優先する
 * （Variables は空でよい。設定はふつう app.config.json だけに書く）。
 *
 * 使い方:
 *   npx tsx scripts/appConfig.ts           … 変換した KEY=VALUE を表示する
 *   GitHub Actions の中では $GITHUB_ENV に追記し、後の手順で使えるようにする。
 *
 * 秘密の値（サービスアカウントの鍵、VAPID の秘密鍵）は、このファイルにも app.config.json にも書かない。
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface AppConfigFile {
  firebase?: {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    appId?: string;
    messagingSenderId?: string;
  };
  vapidPublicKey?: string;
  vapidSubject?: string;
  notifyGroupIds?: string;
  googleSignIn?: boolean;
  googleBooksApiKey?: string;
}

/** 出力する環境変数の名前（この順で出す） */
export const APP_CONFIG_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_VAPID_PUBLIC_KEY',
  'VITE_GOOGLE_SIGN_IN',
  'VITE_GOOGLE_BOOKS_API_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_SUBJECT',
  'APP_URL',
  'NOTIFY_GROUP_IDS',
] as const;

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];
export type AppConfigEnv = Record<AppConfigKey, string>;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * app.config.json の中身と、すでにある環境変数（GitHub の Variables）を合わせる。
 * 環境変数に空でない値があればそちらを使う。
 */
export function resolveAppConfig(file: AppConfigFile, env: Readonly<Record<string, string | undefined>>): AppConfigEnv {
  const fb = file.firebase ?? {};
  const projectId = str(env.VITE_FIREBASE_PROJECT_ID) || str(fb.projectId);
  // ホーム画面のアプリでログインを安定させるため、ログイン用のドメインはアプリと同じ web.app にする
  const defaultDomain = projectId ? `${projectId}.web.app` : '';
  const vapidPublicKey = str(env.VITE_VAPID_PUBLIC_KEY) || str(env.VAPID_PUBLIC_KEY) || str(file.vapidPublicKey);

  const fromFile: AppConfigEnv = {
    VITE_FIREBASE_API_KEY: str(fb.apiKey),
    VITE_FIREBASE_AUTH_DOMAIN: str(fb.authDomain) || defaultDomain,
    VITE_FIREBASE_PROJECT_ID: projectId,
    VITE_FIREBASE_APP_ID: str(fb.appId),
    VITE_FIREBASE_MESSAGING_SENDER_ID: str(fb.messagingSenderId),
    VITE_VAPID_PUBLIC_KEY: vapidPublicKey,
    VITE_GOOGLE_SIGN_IN: file.googleSignIn === true ? 'true' : 'false',
    VITE_GOOGLE_BOOKS_API_KEY: str(file.googleBooksApiKey),
    VAPID_PUBLIC_KEY: vapidPublicKey,
    VAPID_SUBJECT: str(file.vapidSubject),
    APP_URL: defaultDomain ? `https://${defaultDomain}` : '',
    NOTIFY_GROUP_IDS: str(file.notifyGroupIds),
  };

  const result = {} as AppConfigEnv;
  for (const key of APP_CONFIG_KEYS) {
    result[key] = str(env[key]) || fromFile[key];
  }
  return result;
}

/** 必須なのに空の項目（デプロイ用） */
export function missingForDeploy(config: AppConfigEnv): AppConfigKey[] {
  const required: AppConfigKey[] = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_VAPID_PUBLIC_KEY',
  ];
  return required.filter((key) => !config[key]);
}

/** $GITHUB_ENV に書ける形にする（値に改行は入らない前提。入っていたら空白にする） */
export function toEnvLines(config: AppConfigEnv): string {
  return APP_CONFIG_KEYS.map((key) => `${key}=${config[key].replace(/[\r\n]+/g, ' ')}`).join('\n') + '\n';
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const path = resolve(root, 'app.config.json');
  let file: AppConfigFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as AppConfigFile;
  } catch (e) {
    console.error(`::error::app.config.json を読めませんでした（${e instanceof Error ? e.message : String(e)}）`);
    process.exit(1);
  }
  const config = resolveAppConfig(file, process.env);
  const lines = toEnvLines(config);
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(githubEnv, lines);
    console.log('app.config.json の設定を読み込みました。');
    for (const key of APP_CONFIG_KEYS) console.log(`  ${key}: ${config[key] ? '設定あり' : '（空）'}`);
  } else {
    process.stdout.write(lines);
  }
  if (process.argv.includes('--check-deploy')) {
    const missing = missingForDeploy(config);
    if (missing.length > 0) {
      console.error(
        `::error::app.config.json の設定が足りません: ${missing.join(', ')}（docs/setup.md の手順 4・5 を参照）`,
      );
      process.exit(1);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
