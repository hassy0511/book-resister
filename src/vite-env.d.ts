/// <reference types="vite/client" />

// アプリが読む環境変数（.env.example を参照）
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string;
  readonly VITE_USE_EMULATORS?: string;
  /** vite.config.ts が package.json の version を入れる */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
