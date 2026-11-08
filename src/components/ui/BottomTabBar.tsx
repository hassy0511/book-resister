/*
 * 画面下部のタブ（ホーム／スキャン／履歴／シリーズ／設定）。AppLayout が表示する。
 * 現在地のタブを強調し、ホームバー（safe-area-inset-bottom）分の余白を取る。
 * 使い方: <BottomTabBar />（タブの定義は TABS。現在地の判定は tabForPath）
 */
import type { ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HistoryIcon, HomeIcon, ScanIcon, SeriesIcon, SettingsIcon, type IconProps } from './icons';
import styles from './BottomTabBar.module.css';

export type TabKey = 'home' | 'scan' | 'history' | 'series' | 'settings';

export type TabDef = {
  key: TabKey;
  label: string;
  to: string;
  icon: ComponentType<IconProps>;
  /** このタブに属するパスの先頭 */
  match: string[];
};

export const TABS: TabDef[] = [
  { key: 'home', label: 'ホーム', to: '/', icon: HomeIcon, match: ['/loans', '/return'] },
  { key: 'scan', label: 'スキャン', to: '/scan?mode=borrow', icon: ScanIcon, match: ['/scan', '/borrow'] },
  { key: 'history', label: '履歴', to: '/history', icon: HistoryIcon, match: ['/history', '/books'] },
  { key: 'series', label: 'シリーズ', to: '/series', icon: SeriesIcon, match: ['/series'] },
  { key: 'settings', label: '設定', to: '/settings', icon: SettingsIcon, match: ['/settings'] },
];

/** パスがどのタブに属するか（どれにも当たらなければ null） */
export function tabForPath(pathname: string): TabKey | null {
  if (pathname === '/' || pathname === '') return 'home';
  for (const tab of TABS) {
    if (tab.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return tab.key;
  }
  return null;
}

export type BottomTabBarProps = {
  className?: string;
};

export function BottomTabBar({ className }: BottomTabBarProps) {
  const { pathname } = useLocation();
  const current = tabForPath(pathname);

  return (
    <nav className={[styles.tabBar, className ?? ''].filter(Boolean).join(' ')} aria-label="メイン">
      <ul className={styles.list}>
        {TABS.map((tab) => {
          const active = tab.key === current;
          const Icon = tab.icon;
          return (
            <li key={tab.key} className={styles.item}>
              <Link
                to={tab.to}
                className={[styles.tab, active ? styles.active : ''].filter(Boolean).join(' ')}
                aria-current={active ? 'page' : undefined}
                // 現在のタブを再度押したらそのタブの先頭画面へ（履歴は積まない）
                replace={active}
              >
                <Icon size={24} strokeWidth={active ? 2.4 : 1.9} />
                <span className={styles.label}>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
