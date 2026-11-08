/*
 * グループ参加済みの画面の外枠: 画面（Outlet）＋ 下部タブ。App.tsx のルートで使う。
 * 各画面のルート要素は「親いっぱいの高さ」になる前提（Page を使えば自動。自作する場合は
 * display:flex; flex-direction:column; flex:1; min-height:0 にする）。
 *
 * 下部タブを隠す方法:
 *   1) 画面側で useHideTabBar() を呼ぶ／<Page hideTabBar> にする（ScanPage の全画面表示など）
 *   2) TAB_BAR_HIDDEN_PATHS にパスの先頭を追加する
 * タブの表示中は <html data-tabbar="shown"> になり、CSS 変数 --tabbar-offset（トーストの位置）と
 * --page-bottom-inset（ページ下端の余白）が切り替わる。
 */
import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BottomTabBar } from '../ui/BottomTabBar';
import { Spinner } from '../ui/Spinner';
import { TabBarVisibilityProvider, useTabBarHiddenByPage } from './tabBarVisibility';
import styles from './AppLayout.module.css';

/** 下部タブを常に隠すパスの先頭（例: '/scan'）。画面側の useHideTabBar() でも隠せる */
export const TAB_BAR_HIDDEN_PATHS: readonly string[] = [];

export function isTabBarHiddenPath(pathname: string): boolean {
  return TAB_BAR_HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppLayout() {
  return (
    <TabBarVisibilityProvider>
      <AppLayoutInner />
    </TabBarVisibilityProvider>
  );
}

function AppLayoutInner() {
  const { pathname } = useLocation();
  const hiddenByPage = useTabBarHiddenByPage();
  const showTabBar = !hiddenByPage && !isTabBarHiddenPath(pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (showTabBar) root.dataset.tabbar = 'shown';
    else delete root.dataset.tabbar;
    return () => {
      delete root.dataset.tabbar;
    };
  }, [showTabBar]);

  return (
    <div className={styles.layout}>
      <div className={styles.screen}>
        <Suspense fallback={<Spinner size="lg" center className={styles.fallback} />}>
          <Outlet />
        </Suspense>
      </div>
      {showTabBar ? <BottomTabBar /> : null}
    </div>
  );
}

export default AppLayout;
