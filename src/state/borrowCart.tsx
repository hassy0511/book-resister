/*
 * 借りる予定の本（カート）。GroupProvider の内側に置く（App.tsx）。
 *   const cart = useBorrowCart();
 *   cart.addIsbn(isbn13)          // すぐに「取得中」で追加し、書誌の取得と既存の本の確認を裏で行う
 *   cart.addCandidate(candidate)  // タイトル検索・手入力の結果
 *   cart.addExistingBook(book)    // グループ内の本をもう一度借りる
 *
 * - 内容は localStorage に保存する（読めない環境では保存しないだけ）。復元時に「取得中」の本は取得し直す。
 * - 書誌の取得が通信の失敗で確かめられなかった本は status 'error'。retry(key)・同じ本の読み直し・復元で取り直す。
 * - 既存の本（ISBN の本は ID が isbn-<ISBN13>、無い本はタイトル完全一致）があれば existingBookId を設定し、
 *   本の情報とシリーズを優先して表示する。シリーズ名・巻数の初期値は「既存の本のシリーズ」＞「候補の値」。
 *   どうやって結び付けたかは matchedBy に残す。タイトルの一致は別の本のこともあるので、
 *   update(key, { forceNew: true }) で外して別の本として登録できる（結び付ける前の内容に戻る）。
 * - グループ未参加（ログイン前など）でも動く（既存の本の確認をしないだけ）。
 *   保存したときと別のグループに切り替わったら中身を捨てる。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { findBookForCandidate, getBook } from '../data/books';
import { useSeriesList } from '../data/series';
import { useGroup } from '../group/GroupProvider';
import { lookupByIsbnDetailed } from '../lib/bookLookup';
import { bookIdForIsbn } from '../lib/isbn';
import type { Book, BookCandidate, Series, WithId } from '../types';
import {
  CART_STORAGE_KEY,
  applyExisting,
  applyLookup,
  applyPatch,
  cartIsbn,
  findDuplicate,
  itemFromBook,
  itemFromCandidate,
  newIsbnItem,
  parseStoredCart,
  randomCartKey,
  retryLookup,
  serializeCart,
  type AddResult,
  type CartItem,
  type CartItemPatch,
  type ExistingBookInfo,
  type StoredCart,
} from './borrowCartLogic';

export type { CartItem, CartItemPatch, CartItemStatus } from './borrowCartLogic';
export { isItemResolved, itemTitle } from './borrowCartLogic';

export type BorrowCart = {
  items: CartItem[];
  /** 書誌の取得はカート内で非同期に行う */
  addIsbn(isbn13: string): AddResult;
  addCandidate(c: BookCandidate): AddResult;
  addExistingBook(book: WithId<Book>): AddResult;
  update(key: string, patch: CartItemPatch): void;
  /** 通信の失敗などで取れなかった ISBN の本の書誌を取り直す */
  retry(key: string): void;
  remove(key: string): void;
  clear(): void;
};

const BorrowCartContext = createContext<BorrowCart | null>(null);

/** シリーズ一覧の読み込みを待つ最大時間（ミリ秒） */
const SERIES_WAIT_MS = 6000;

// ---------------------------------------------------------------------------
// localStorage（使えない環境では何もしない）
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function loadCart(): StoredCart {
  try {
    return parseStoredCart(storage()?.getItem(CART_STORAGE_KEY));
  } catch {
    return { groupId: null, items: [] };
  }
}

function saveCart(groupId: string | null, items: readonly CartItem[]): void {
  try {
    const s = storage();
    if (!s) return;
    if (items.length === 0) s.removeItem(CART_STORAGE_KEY);
    else s.setItem(CART_STORAGE_KEY, serializeCart(groupId, items));
  } catch {
    // 容量超過・プライベートブラウズなど。保存できなくても画面上のカートは使える
  }
}

// ---------------------------------------------------------------------------
// シリーズ一覧（既存の本のシリーズ名を引くため。グループ参加中だけ購読する）
// ---------------------------------------------------------------------------

type SeriesStore = {
  ready: boolean;
  list: WithId<Series>[];
  waiters: Set<() => void>;
};

function SeriesListSync({ onChange }: { onChange: (ready: boolean, list: WithId<Series>[]) => void }) {
  const { data, loading } = useSeriesList();
  useEffect(() => {
    onChange(!loading, data);
  }, [loading, data, onChange]);
  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function BorrowCartProvider({ children }: { children: ReactNode }) {
  const { groupId, loading: groupLoading } = useGroup();

  const [initial] = useState(loadCart);
  const [items, setItems] = useState<CartItem[]>(initial.items);
  // 最新の中身（追加の重複判定を同じタップ内の連続呼び出しでも正しく行うため、state とは別に持つ）
  const itemsRef = useRef<CartItem[]>(initial.items);
  const ownerGroupRef = useRef<string | null>(initial.groupId);
  const groupIdRef = useRef<string | null>(groupId);
  const inflightRef = useRef(new Set<string>());
  const seriesRef = useRef<SeriesStore>({ ready: false, list: [], waiters: new Set() });

  useLayoutEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);

  const commit = useCallback((updater: (prev: CartItem[]) => CartItem[]) => {
    const next = updater(itemsRef.current);
    if (next === itemsRef.current) return;
    itemsRef.current = next;
    setItems(next);
  }, []);

  const updateItem = useCallback(
    (key: string, fn: (item: CartItem) => CartItem) => {
      commit((prev) => {
        let changed = false;
        const next = prev.map((i) => {
          if (i.key !== key) return i;
          const updated = fn(i);
          if (updated !== i) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
    },
    [commit],
  );

  // 別のグループに切り替わったら中身を捨てる
  useEffect(() => {
    if (!groupId) return;
    if (ownerGroupRef.current && ownerGroupRef.current !== groupId) commit(() => []);
    ownerGroupRef.current = groupId;
  }, [groupId, commit]);

  // 保存
  useEffect(() => {
    saveCart(groupId ?? ownerGroupRef.current, items);
  }, [items, groupId]);

  // ---- シリーズ名の解決 ----

  const handleSeries = useCallback((ready: boolean, list: WithId<Series>[]) => {
    const s = seriesRef.current;
    s.ready = ready;
    s.list = list;
    if (ready) {
      const waiters = Array.from(s.waiters);
      s.waiters.clear();
      waiters.forEach((w) => w());
    }
  }, []);

  useEffect(() => {
    if (groupId) return;
    // グループを抜けたらシリーズ一覧を捨て、待っている処理を先へ進める
    handleSeries(true, []);
    seriesRef.current.ready = false;
  }, [groupId, handleSeries]);

  const seriesNameFor = useCallback(async (seriesId: string | null): Promise<string | null> => {
    if (!seriesId) return null;
    const s = seriesRef.current;
    if (!s.ready) {
      await new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          s.waiters.delete(done);
          resolve();
        };
        const timer = window.setTimeout(done, SERIES_WAIT_MS);
        s.waiters.add(done);
      });
    }
    return seriesRef.current.list.find((x) => x.id === seriesId)?.name ?? null;
  }, []);

  /** 既存の本とそのシリーズ名。グループ未参加・見つからない・読めない場合は null */
  const findExisting = useCallback(
    async (find: (gid: string) => Promise<WithId<Book> | null>): Promise<ExistingBookInfo | null> => {
      const gid = groupIdRef.current;
      if (!gid) return null;
      try {
        const book = await find(gid);
        if (!book) return null;
        return { book, seriesName: await seriesNameFor(book.seriesId) };
      } catch (e) {
        console.warn('[borrowCart] 既存の本を確認できませんでした', e);
        return null;
      }
    },
    [seriesNameFor],
  );

  // ---- ISBN の本の書誌取得（追加時・復元時の「取得中」） ----

  const resolveIsbnItem = useCallback(
    async (key: string, isbn: string) => {
      const existingP = findExisting((gid) => getBook(gid, bookIdForIsbn(isbn)));
      const lookupP = lookupByIsbnDetailed(isbn).catch((e: unknown) => {
        console.warn('[borrowCart] 書誌を取得できませんでした', e);
        return { candidate: null, failed: true };
      });
      // 既存の本が先に分かれば、書誌の取得を待たずに表示する
      void existingP.then((ex) => {
        if (ex) updateItem(key, (i) => (i.status === 'loading' ? applyExisting(i, ex) : i));
      });
      const [ex, looked] = await Promise.all([existingP, lookupP]);
      updateItem(key, (i) => {
        const base = ex && i.existingBookId !== ex.book.id ? applyExisting(i, ex) : i;
        return applyLookup(base, looked.candidate, looked.failed);
      });
    },
    [findExisting, updateItem],
  );

  // 「取得中」の本の取得を始める（グループの読み込みが終わってから。既存の本を確認するため）
  useEffect(() => {
    if (groupLoading) return;
    for (const item of items) {
      if (item.status !== 'loading' || !item.isbn || inflightRef.current.has(item.key)) continue;
      const { key, isbn } = item;
      inflightRef.current.add(key);
      void resolveIsbnItem(key, isbn).finally(() => {
        inflightRef.current.delete(key);
      });
    }
  }, [items, groupLoading, resolveIsbnItem]);

  // ---- 公開する操作 ----

  const addIsbn = useCallback(
    (isbn13: string): AddResult => {
      const isbn = cartIsbn(isbn13);
      if (!isbn) return 'duplicate';
      const dup = findDuplicate(itemsRef.current, { key: isbn, isbn });
      if (dup) {
        // 通信の失敗で取れなかった本を読み直したら、取り直す
        if (dup.status === 'error') updateItem(dup.key, retryLookup);
        return 'duplicate';
      }
      commit((prev) => [...prev, newIsbnItem(isbn)]);
      return 'added';
    },
    [commit, updateItem],
  );

  const addCandidate = useCallback(
    (c: BookCandidate): AddResult => {
      const isbn = cartIsbn(c.isbn);
      if (findDuplicate(itemsRef.current, { isbn, titleWithoutIsbn: isbn ? null : c.title, volume: c.volume })) {
        return 'duplicate';
      }
      const key = isbn ?? randomCartKey();
      const item = itemFromCandidate({ ...c, isbn }, key);
      commit((prev) => [...prev, item]);
      // 既存の本の確認（ISBN なら ID、無ければタイトル完全一致。タイトルの一致は確認画面で外せる）
      void findExisting((gid) => findBookForCandidate(gid, item.candidate ?? c)).then((ex) => {
        if (!ex) return;
        updateItem(key, (i) => applyExisting(i, ex, isbn ? 'isbn' : 'title'));
      });
      return 'added';
    },
    [commit, findExisting, updateItem],
  );

  const addExistingBook = useCallback(
    (book: WithId<Book>): AddResult => {
      const isbn = cartIsbn(book.isbn);
      if (findDuplicate(itemsRef.current, { isbn, bookId: book.id })) return 'duplicate';
      const key = isbn ?? book.id;
      const s = seriesRef.current;
      const knownName = book.seriesId && s.ready ? (s.list.find((x) => x.id === book.seriesId)?.name ?? null) : null;
      commit((prev) => [...prev, itemFromBook(book, knownName, key)]);
      if (book.seriesId && !knownName) {
        // シリーズ一覧の読み込み後に名前を入れる（利用者が入力済みなら上書きしない）
        void seriesNameFor(book.seriesId).then((name) => {
          if (!name) return;
          updateItem(key, (i) => (i.seriesName ? i : applyExisting(i, { book, seriesName: name }, 'chosen')));
        });
      }
      return 'added';
    },
    [commit, seriesNameFor, updateItem],
  );

  const update = useCallback(
    (key: string, patch: CartItemPatch) => {
      updateItem(key, (i) => applyPatch(i, patch));
    },
    [updateItem],
  );

  // 「取得中」に戻すと、上の effect が取得し直す
  const retry = useCallback(
    (key: string) => {
      updateItem(key, retryLookup);
    },
    [updateItem],
  );

  const remove = useCallback(
    (key: string) => {
      commit((prev) => (prev.some((i) => i.key === key) ? prev.filter((i) => i.key !== key) : prev));
    },
    [commit],
  );

  const clear = useCallback(() => {
    commit((prev) => (prev.length === 0 ? prev : []));
  }, [commit]);

  const value = useMemo<BorrowCart>(
    () => ({ items, addIsbn, addCandidate, addExistingBook, update, retry, remove, clear }),
    [items, addIsbn, addCandidate, addExistingBook, update, retry, remove, clear],
  );

  return (
    <BorrowCartContext.Provider value={value}>
      {groupId ? <SeriesListSync onChange={handleSeries} /> : null}
      {children}
    </BorrowCartContext.Provider>
  );
}

export function useBorrowCart(): BorrowCart {
  const ctx = useContext(BorrowCartContext);
  if (!ctx) throw new Error('useBorrowCart は BorrowCartProvider の内側で使ってください');
  return ctx;
}
