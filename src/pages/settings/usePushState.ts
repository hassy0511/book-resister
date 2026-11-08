/*
 * この端末の通知の状態（getPushState）を読む。設定アプリから戻ってきたとき（画面が再表示されたとき）にも読み直す。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPushState, type PushState } from '../../lib/push';

export function usePushState(): { state: PushState | null; refresh: () => Promise<void> } {
  const [state, setState] = useState<PushState | null>(null);
  const active = useRef(true);
  // 古い問い合わせの結果で新しい結果を上書きしないための連番
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    let next: PushState;
    try {
      next = await getPushState();
    } catch (e) {
      console.error('[push] 通知の状態を取得できませんでした', e);
      next = 'unsupported';
    }
    if (active.current && mine === seq.current) setState(next);
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      active.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  return { state, refresh };
}
