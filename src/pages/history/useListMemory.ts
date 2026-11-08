/*
 * 一覧の「表示件数」と「スクロール位置」を、ブラウザの履歴エントリごとに sessionStorage に覚える。
 * 本の詳細から戻ったときに、同じ位置から続けて見られるようにする。
 * anchorRef には Page の中に常に描画される要素を渡す（その祖先の <main> がスクロール領域）。
 */
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useLocation } from 'react-router-dom';

type Saved = { visible: number; scrollTop: number };

const PREFIX = 'listMemory:';

function readSaved(name: string, key: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${name}:${key}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { visible, scrollTop } = value as Record<string, unknown>;
    if (typeof visible !== 'number' || typeof scrollTop !== 'number') return null;
    return { visible, scrollTop };
  } catch {
    return null;
  }
}

function writeSaved(name: string, key: string, value: Saved): void {
  try {
    sessionStorage.setItem(`${PREFIX}${name}:${key}`, JSON.stringify(value));
  } catch {
    // 保存できなくても困らない
  }
}

function scrollParent(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.closest('main') ?? null;
}

export function useListMemory(
  name: string,
  defaultVisible: number,
  anchorRef: RefObject<HTMLElement | null>,
  ready: boolean,
): [number, Dispatch<SetStateAction<number>>] {
  const location = useLocation();
  const [saved] = useState(() => readSaved(name, location.key));
  const [visible, setVisible] = useState(() => Math.max(defaultVisible, saved?.visible ?? 0));

  const keyRef = useRef(location.key);
  const visibleRef = useRef(visible);
  const scrollTopRef = useRef(0);
  const restoredRef = useRef(false);

  useLayoutEffect(() => {
    keyRef.current = location.key;
    visibleRef.current = visible;
  });

  // スクロール位置を追いかける
  useEffect(() => {
    const el = scrollParent(anchorRef.current);
    if (!el) return undefined;
    const onScroll = () => {
      scrollTopRef.current = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [anchorRef]);

  // データがそろったら 1 回だけ元の位置に戻す
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const el = scrollParent(anchorRef.current);
    if (el && saved && saved.scrollTop > 0) {
      el.scrollTop = saved.scrollTop;
      scrollTopRef.current = el.scrollTop;
    }
  }, [ready, saved, anchorRef]);

  // 画面を離れるときに保存する
  useEffect(
    () => () => {
      writeSaved(name, keyRef.current, { visible: visibleRef.current, scrollTop: scrollTopRef.current });
    },
    [name],
  );

  return [visible, setVisible];
}
