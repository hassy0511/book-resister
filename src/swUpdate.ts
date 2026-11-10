/**
 * 新しい版の公開後の再読み込み（main.tsx の registerSW に onNeedReload として渡す）。
 *
 * registerType: 'autoUpdate' と sw.ts の skipWaiting / clientsClaim により、新しい Service Worker は
 * 見つかるとすぐに有効になる。そのまま再読み込みすると、感想や登録の入力中でも内容が消えるため:
 *   - 読み込み直後（RELOAD_NOW_WITHIN_MS 以内）なら、まだ入力していないのですぐ再読み込みする。
 *   - それ以外は「再読み込み待ち」にして、次に別の画面へ移るときに移動先の URL を読み込み直す
 *     （react-router は history.pushState / replaceState で画面を移るので、それを差し替えて行う）。
 *     戻る操作（popstate）でも読み込み直す。同じ画面のままなら再読み込みしない。
 * 古い画面のまま lazy() の画面ファイルを読むと、新しい SW がキャッシュから消しているため読めない
 * （ErrorBoundary の「画面を読み込めませんでした」）。画面を移るときに読み込み直すのはこれを避けるため。
 * アプリを裏に回しただけ（visibilitychange）では再読み込みしない（戻ったときに入力が消えるため）。
 */

/** 読み込みからこの時間以内に新しい版が有効になったら、すぐ再読み込みする */
export const RELOAD_NOW_WITHIN_MS = 10_000;

type HistoryMethod = (data: unknown, unused: string, url?: string | URL | null) => void;

/** window のうち使う部分（テストで差し替えられるように） */
export interface ReloadTarget {
  location: {
    href: string;
    pathname: string;
    reload(): void;
    assign(url: string): void;
    replace(url: string): void;
  };
  history: { pushState: HistoryMethod; replaceState: HistoryMethod };
  addEventListener(type: 'popstate', listener: () => void): void;
}

export interface UpdateReloader {
  /** registerSW の onNeedReload に渡す */
  onNeedReload(): void;
  /** 再読み込み待ちか（テスト用） */
  readonly pending: boolean;
}

export function createUpdateReloader(
  target: ReloadTarget,
  /** 読み込み開始からの経過時間（ミリ秒）。既定は performance.now() */
  elapsedMs: () => number = () => performance.now(),
): UpdateReloader {
  let pending = false;
  let installed = false;

  /** 移動先が別の画面なら、その URL を読み込み直して true を返す */
  const reloadInstead = (url: string | URL | null | undefined, replace: boolean): boolean => {
    if (!pending || url == null) return false;
    let next: URL;
    try {
      next = new URL(String(url), target.location.href);
    } catch {
      return false;
    }
    if (next.pathname === target.location.pathname) return false;
    if (replace) target.location.replace(next.href);
    else target.location.assign(next.href);
    return true;
  };

  const install = () => {
    if (installed) return;
    installed = true;
    const { history } = target;
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (data, unused, url) => {
      if (!reloadInstead(url, false)) push(data, unused, url);
    };
    history.replaceState = (data, unused, url) => {
      if (!reloadInstead(url, true)) replace(data, unused, url);
    };
    // 戻る・進む（URL はもう変わっている）
    target.addEventListener('popstate', () => {
      if (pending) target.location.reload();
    });
  };

  return {
    onNeedReload() {
      if (elapsedMs() < RELOAD_NOW_WITHIN_MS) {
        target.location.reload();
        return;
      }
      pending = true;
      install();
    },
    get pending() {
      return pending;
    },
  };
}
