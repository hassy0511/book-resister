/*
 * エントリ。グローバル CSS の読み込み、React の描画、Service Worker の登録（本番ビルドのみ）。
 */
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

/** 新しいバージョンの確認間隔（ホーム画面から開いた PWA は再読み込みされにくいため定期的に確認） */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** アプリに戻ってきたときの確認は、前回からこれだけ空いていれば行う */
const UPDATE_CHECK_MIN_GAP_MS = 10 * 60 * 1000;

if (import.meta.env.PROD) {
  // registerType: 'autoUpdate' なので、新しい SW が有効になると自動で再読み込みされる
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      let lastCheck = Date.now();
      const check = () => {
        if (navigator.onLine === false) return;
        if (Date.now() - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
        lastCheck = Date.now();
        registration.update().catch(() => {
          // 通信できないときは次回に回す
        });
      };
      window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
    onRegisterError(error: unknown) {
      console.error('Service Worker の登録に失敗しました', error);
    },
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
