/*
 * 下部タブの表示・非表示を画面側から切り替える仕組み。
 * AppLayout が TabBarVisibilityProvider を置く。画面では次のどちらかを使う:
 *   useHideTabBar();          // この画面を表示している間タブを隠す（ScanPage の全画面表示など）
 *   <Page hideTabBar> … </Page>
 * AppLayout の外（ログイン画面など）で呼んでも何もしない。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type TabBarVisibilityValue = {
  /** 隠すよう要求している画面の数 */
  hiddenCount: number;
  hide(): () => void;
};

const TabBarVisibilityContext = createContext<TabBarVisibilityValue | null>(null);

export function TabBarVisibilityProvider({ children }: { children: ReactNode }) {
  const [hiddenCount, setHiddenCount] = useState(0);
  const hide = useCallback(() => {
    setHiddenCount((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHiddenCount((n) => Math.max(0, n - 1));
    };
  }, []);
  const value = useMemo(() => ({ hiddenCount, hide }), [hiddenCount, hide]);
  return <TabBarVisibilityContext.Provider value={value}>{children}</TabBarVisibilityContext.Provider>;
}

/** 呼んだ画面が表示されている間、下部タブを隠す（hidden=false なら何もしない） */
export function useHideTabBar(hidden: boolean = true): void {
  const ctx = useContext(TabBarVisibilityContext);
  const hide = ctx?.hide;
  useEffect(() => {
    if (!hidden || !hide) return;
    return hide();
  }, [hidden, hide]);
}

/** 画面側からの非表示要求があるか（AppLayout 用） */
export function useTabBarHiddenByPage(): boolean {
  const ctx = useContext(TabBarVisibilityContext);
  return (ctx?.hiddenCount ?? 0) > 0;
}
