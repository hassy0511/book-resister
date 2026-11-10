/**
 * Firebase の初期化（app / auth / db）。
 *
 * - VITE_FIREBASE_* が揃っていない場合は初期化せず、isFirebaseConfigured = false にする。
 *   その場合も import 時に例外は出さない。app / auth / db に触れた時点で分かりやすいエラーを投げる。
 *   UI 側は isFirebaseConfigured を見てセットアップ案内を出す。
 * - VITE_USE_EMULATORS=true のときは Auth（9099）と Firestore（8080）のエミュレータに接続する。
 *   エミュレータ利用時に設定が無ければ demo プロジェクト（demo-book-resister）を使う。
 */
import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

/** エミュレータ利用時の既定プロジェクト ID（package.json の emulators スクリプトと合わせる） */
const EMULATOR_PROJECT_ID = 'demo-book-resister';

function envString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const useEmulators = envString(import.meta.env.VITE_USE_EMULATORS) === 'true';

/**
 * 「Google でログイン」を出すか。VITE_GOOGLE_SIGN_IN=false のときだけ隠す
 * （本番では app.config.json の googleSignIn から決まる。初めはメールアドレスだけで始め、
 *  Google のリダイレクト先の設定（docs/setup.md）を済ませてから true にする）。
 */
export const isGoogleSignInEnabled = envString(import.meta.env.VITE_GOOGLE_SIGN_IN) !== 'false';

const firebaseOptions: FirebaseOptions = {
  apiKey: envString(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: envString(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: envString(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  appId: envString(import.meta.env.VITE_FIREBASE_APP_ID),
  messagingSenderId: envString(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined,
};

/** 認証と Firestore に最低限必要な値が揃っているか */
const hasRequiredOptions = Boolean(
  firebaseOptions.apiKey && firebaseOptions.authDomain && firebaseOptions.projectId && firebaseOptions.appId,
);

if (!hasRequiredOptions && useEmulators) {
  // エミュレータは demo- で始まるプロジェクト ID なら実プロジェクト無しで動く
  firebaseOptions.apiKey ||= 'demo-api-key';
  firebaseOptions.projectId ||= EMULATOR_PROJECT_ID;
  firebaseOptions.authDomain ||= `${firebaseOptions.projectId}.firebaseapp.com`;
  firebaseOptions.appId ||= 'demo-app-id';
}

function emulatorHost(): string {
  return typeof location !== 'undefined' && location.hostname ? location.hostname : 'localhost';
}

/** 未設定時に返すダミー。どのプロパティに触れても日本語のエラーを投げる */
function notConfigured<T extends object>(name: string): T {
  const fail = (): never => {
    throw new Error(
      `Firebase が設定されていないため ${name} を使えません。.env に VITE_FIREBASE_* を設定してください。`,
    );
  };
  return new Proxy({} as T, {
    get(_target, prop) {
      // Promise 判定（then）や Symbol での問い合わせでは落とさない
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      return fail();
    },
    set: fail,
  });
}

interface Instances {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

function initialize(): Instances | null {
  if (!hasRequiredOptions && !useEmulators) return null;
  try {
    // HMR などで 2 回目の評価になった場合は既存のインスタンスを使う
    const alreadyInitialized = getApps().length > 0;
    const firebaseApp = alreadyInitialized ? getApp() : initializeApp(firebaseOptions);

    const firebaseAuth = getAuth(firebaseApp);
    firebaseAuth.languageCode = 'ja';

    let firestore: Firestore;
    try {
      firestore = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      firestore = getFirestore(firebaseApp);
    }

    if (useEmulators && !alreadyInitialized) {
      const host = emulatorHost();
      connectAuthEmulator(firebaseAuth, `http://${host}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(firestore, host, 8080);
    }
    return { app: firebaseApp, auth: firebaseAuth, db: firestore };
  } catch (e) {
    console.error('Firebase の初期化に失敗しました', e);
    return null;
  }
}

const instances = initialize();

/** VITE_FIREBASE_* が揃っていて初期化できたか（未設定ならセットアップ案内を表示する） */
export const isFirebaseConfigured: boolean = instances !== null;

export const app: FirebaseApp = instances?.app ?? notConfigured<FirebaseApp>('app');
export const auth: Auth = instances?.auth ?? notConfigured<Auth>('auth');
/** initializeFirestore + persistentLocalCache({ tabManager: persistentMultipleTabManager() }) */
export const db: Firestore = instances?.db ?? notConfigured<Firestore>('db');
