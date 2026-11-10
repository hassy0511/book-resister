import { describe, expect, it, vi } from 'vitest';
import { RELOAD_NOW_WITHIN_MS, createUpdateReloader, type ReloadTarget } from './swUpdate';

function fakeWindow(path = '/loans/abc/return') {
  const popstate: (() => void)[] = [];
  const pushed: unknown[] = [];
  const replaced: unknown[] = [];
  const target: ReloadTarget = {
    location: {
      href: `https://example.web.app${path}`,
      pathname: path,
      reload: vi.fn(),
      assign: vi.fn(),
      replace: vi.fn(),
    },
    history: {
      pushState: (_data, _unused, url) => pushed.push(url),
      replaceState: (_data, _unused, url) => replaced.push(url),
    },
    addEventListener: (_type, listener) => popstate.push(listener),
  };
  return { target, pushed, replaced, firePopstate: () => popstate.forEach((l) => l()) };
}

describe('createUpdateReloader', () => {
  it('読み込み直後に新しい版が有効になったら、すぐ再読み込みする', () => {
    const w = fakeWindow();
    const reloader = createUpdateReloader(w.target, () => RELOAD_NOW_WITHIN_MS - 1);
    reloader.onNeedReload();
    expect(w.target.location.reload).toHaveBeenCalledTimes(1);
    expect(reloader.pending).toBe(false);
  });

  it('使っている途中なら、その場では再読み込みしない（入力中の内容を消さない）', () => {
    const w = fakeWindow();
    const reloader = createUpdateReloader(w.target, () => 60_000);
    reloader.onNeedReload();
    expect(w.target.location.reload).not.toHaveBeenCalled();
    expect(reloader.pending).toBe(true);
    // 同じ画面のままの URL 変更（検索条件など）では読み込み直さない
    w.target.history.replaceState(null, '', '/loans/abc/return?step=2');
    expect(w.replaced).toEqual(['/loans/abc/return?step=2']);
    expect(w.target.location.assign).not.toHaveBeenCalled();
    expect(w.target.location.replace).not.toHaveBeenCalled();
  });

  it('再読み込み待ちのときは、次に別の画面へ移るときに移動先を読み込み直す', () => {
    const w = fakeWindow();
    const reloader = createUpdateReloader(w.target, () => 60_000);
    reloader.onNeedReload();
    w.target.history.pushState({ idx: 1 }, '', '/history');
    expect(w.target.location.assign).toHaveBeenCalledWith('https://example.web.app/history');
    expect(w.pushed).toEqual([]);
  });

  it('replace の移動は location.replace で読み込み直す（履歴を増やさない）', () => {
    const w = fakeWindow();
    const reloader = createUpdateReloader(w.target, () => 60_000);
    reloader.onNeedReload();
    w.target.history.replaceState(null, '', '/');
    expect(w.target.location.replace).toHaveBeenCalledWith('https://example.web.app/');
    expect(w.replaced).toEqual([]);
  });

  it('戻る操作でも読み込み直す', () => {
    const w = fakeWindow();
    const reloader = createUpdateReloader(w.target, () => 60_000);
    reloader.onNeedReload();
    w.firePopstate();
    expect(w.target.location.reload).toHaveBeenCalledTimes(1);
  });

  it('新しい版が無ければ画面の移動はそのまま', () => {
    const w = fakeWindow();
    createUpdateReloader(w.target, () => 60_000);
    w.target.history.pushState(null, '', '/history');
    w.firePopstate();
    expect(w.pushed).toEqual(['/history']);
    expect(w.target.location.assign).not.toHaveBeenCalled();
    expect(w.target.location.reload).not.toHaveBeenCalled();
  });

  it('2 回呼ばれても差し替えは 1 回だけ', () => {
    const w = fakeWindow();
    const reloader = createUpdateReloader(w.target, () => 60_000);
    reloader.onNeedReload();
    reloader.onNeedReload();
    w.firePopstate();
    expect(w.target.location.reload).toHaveBeenCalledTimes(1);
  });
});
