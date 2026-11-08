/*
 * 今日の日付（'YYYY-MM-DD'）。ホーム画面に置いたまま日付が変わっても、
 * アプリに戻ったとき（visibilitychange / focus）や 1 分ごとの確認で更新する。
 */
import { useEffect, useState } from 'react';
import type { DateString } from '../../types';
import { todayString } from '../../lib/date';

const CHECK_INTERVAL_MS = 60_000;

export function useToday(): DateString {
  const [today, setToday] = useState<DateString>(() => todayString());

  useEffect(() => {
    // 同じ値なら React が再描画を省く
    const refresh = () => setToday(todayString());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);

  return today;
}
