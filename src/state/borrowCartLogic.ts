/*
 * 借りる予定の本（カート）の純粋ロジック。React・Firebase に依存しない。
 *   - カートの 1 冊（CartItem）の作成
 *   - 重複の判定
 *   - 既存の本・書誌検索の結果の反映（既存の本の情報とシリーズを優先）
 *   - localStorage への保存形式の読み書き
 */
import { normalizeIsbn } from '../lib/isbn';
import { normalizeSeriesName } from '../lib/series';
import type { Book, BookCandidate, BookSource, DateString, WithId } from '../types';

export type CartItemStatus = 'loading' | 'ready' | 'not-found';

/**
 * 既存の本に結び付けたきっかけ。
 *   - 'isbn': ISBN から決まる ID の本があった
 *   - 'title': ISBN が無く、タイトルが同じ本があった（別の本のこともあるので、確認画面で外せる）
 *   - 'chosen': 利用者がグループ内の本を選んだ（もう一度借りる）
 */
export type CartMatch = 'isbn' | 'title' | 'chosen';

/** タイトルで結び付ける前の内容（「別の本として登録」で元に戻すため） */
export type CartItemBeforeMatch = {
  candidate: BookCandidate | null;
  /** タイトルで ISBN のある本に結び付けると、その ISBN が入るため */
  isbn: string | null;
  seriesName: string | null;
  volume: number | null;
};

export type CartItem = {
  /** ISBN があれば isbn13、無ければランダム */
  key: string;
  status: CartItemStatus;
  /** not-found の場合は null（タイトル手入力を促す） */
  candidate: BookCandidate | null;
  isbn: string | null;
  existingBookId: string | null;
  /** existingBookId を設定したきっかけ（未設定・不明なら null） */
  matchedBy: CartMatch | null;
  /** タイトルでの照合をせず、別の本として登録する（確認画面の「別の本として登録」） */
  forceNew: boolean;
  /** タイトルで結び付けた場合の、結び付ける前の内容 */
  beforeMatch: CartItemBeforeMatch | null;
  seriesName: string | null;
  volume: number | null;
  dueOnOverride: DateString | null;
};

export type CartItemPatch = Partial<Pick<CartItem, 'seriesName' | 'volume' | 'dueOnOverride' | 'candidate' | 'forceNew'>> & {
  /** null で既存の本との結び付きを外す（タイトルで結び付ける前の内容に戻す） */
  existingBookId?: null;
};

export type AddResult = 'added' | 'duplicate';

/** 既存の本（グループ内）とそのシリーズ名 */
export type ExistingBookInfo = {
  book: WithId<Book>;
  /** book.seriesId のシリーズ名（シリーズ未設定・不明なら null） */
  seriesName: string | null;
};

// ---------------------------------------------------------------------------
// 作成
// ---------------------------------------------------------------------------

/** ISBN を 13 桁に正規化する。空なら null、正規化できなければ前後の空白を除いたもの */
export function cartIsbn(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  return normalizeIsbn(t) ?? t;
}

/** ISBN の無い本のキー */
export function randomCartKey(): string {
  const c: { randomUUID?: () => string } | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  const id = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `manual-${id}`;
}

/** バーコードで読み取った本（書誌は後から取得する） */
export function newIsbnItem(isbn: string): CartItem {
  return {
    key: isbn,
    status: 'loading',
    candidate: null,
    isbn,
    existingBookId: null,
    matchedBy: null,
    forceNew: false,
    beforeMatch: null,
    seriesName: null,
    volume: null,
    dueOnOverride: null,
  };
}

/** 書誌検索・手入力の結果から作る */
export function itemFromCandidate(c: BookCandidate, key: string): CartItem {
  const isbn = cartIsbn(c.isbn);
  return {
    key,
    status: 'ready',
    candidate: { ...c, isbn, authors: [...c.authors] },
    isbn,
    existingBookId: null,
    matchedBy: null,
    forceNew: false,
    beforeMatch: null,
    seriesName: c.seriesName,
    volume: c.volume,
    dueOnOverride: null,
  };
}

/** 本ドキュメントを候補の形にする */
export function candidateFromBook(book: Book, seriesName: string | null): BookCandidate {
  return {
    isbn: book.isbn,
    title: book.title,
    authors: [...(book.authors ?? [])],
    publisher: book.publisher,
    coverUrl: book.coverUrl,
    seriesName,
    volume: book.volume,
    source: book.source,
  };
}

/** グループ内の既存の本から作る（再度借りる場合） */
export function itemFromBook(book: WithId<Book>, seriesName: string | null, key: string): CartItem {
  return {
    key,
    status: 'ready',
    candidate: candidateFromBook(book, seriesName),
    isbn: cartIsbn(book.isbn),
    existingBookId: book.id,
    matchedBy: 'chosen',
    forceNew: false,
    beforeMatch: null,
    seriesName,
    volume: book.volume,
    dueOnOverride: null,
  };
}

// ---------------------------------------------------------------------------
// 重複
// ---------------------------------------------------------------------------

/** タイトルの比較用（全角半角・空白・大小文字の違いを無視） */
export function titleKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '');
}

export type DuplicateProbe = {
  key?: string | null;
  isbn?: string | null;
  bookId?: string | null;
  /** ISBN の無い本の重複判定に使うタイトル */
  titleWithoutIsbn?: string | null;
  /** ISBN の無い本の巻数（同じタイトルでも巻数が違えば別の本） */
  volume?: number | null;
};

/**
 * すでにカートにある同じ本（同じ ISBN・同じ既存の本・ISBN なしで同じタイトル）を探す。
 * ISBN なしで同じタイトルでも、巻数が両方あって違う場合（月刊絵本の別の号など）と、
 * カートの側が「別の本として登録」にしてある場合は別の本とみなす
 * （登録時のタイトルの照合も巻数の違う本・別の本として登録した本には結び付けないため、貸出が 1 冊に重ならない）。
 */
export function findDuplicate(items: readonly CartItem[], probe: DuplicateProbe): CartItem | null {
  const isbn = cartIsbn(probe.isbn);
  const tKey = probe.titleWithoutIsbn ? titleKey(probe.titleWithoutIsbn) : '';
  const volume = probe.volume ?? null;
  return (
    items.find((i) => {
      if (probe.key && i.key === probe.key) return true;
      if (isbn && (i.isbn === isbn || i.key === isbn)) return true;
      if (probe.bookId && i.existingBookId === probe.bookId) return true;
      if (tKey && !isbn && !i.isbn && i.candidate && titleKey(i.candidate.title) === tKey) {
        if (i.forceNew) return false;
        if (volume !== null && i.volume !== null && volume !== i.volume) return false;
        return true;
      }
      return false;
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// 既存の本・書誌検索の結果の反映
// ---------------------------------------------------------------------------

function blank(s: string | null | undefined): boolean {
  return s == null || s.trim() === '';
}

/** base の空欄（著者・出版社・表紙・シリーズ）だけを extra で補う */
export function fillCandidateBlanks(base: BookCandidate, extra: BookCandidate | null): BookCandidate {
  if (!extra) return base;
  const out: BookCandidate = { ...base, authors: [...base.authors] };
  if (blank(out.title) && !blank(extra.title)) out.title = extra.title;
  if (out.authors.length === 0 && extra.authors.length > 0) out.authors = [...extra.authors];
  if (blank(out.publisher) && !blank(extra.publisher)) out.publisher = extra.publisher;
  if (blank(out.coverUrl) && !blank(extra.coverUrl)) out.coverUrl = extra.coverUrl;
  if (blank(out.isbn) && !blank(extra.isbn)) out.isbn = extra.isbn;
  if (blank(out.seriesName) && !blank(extra.seriesName)) {
    out.seriesName = extra.seriesName;
    if (out.volume == null) out.volume = extra.volume;
  }
  return out;
}

/**
 * 既存の本が見つかったときの反映。本の情報を優先し、空欄は今の候補で補う。
 * シリーズ名・巻数は「既存の本のシリーズ」＞「今の値（候補の推定・利用者の入力）」。
 * matchedBy は見つけたきっかけ（利用者が選んだ本はそのまま 'chosen'）。
 * タイトルで見つけた場合は、結び付ける前の内容を beforeMatch に残す（「別の本として登録」で戻す）。
 * 「別の本として登録」にした項目は、タイトルでは結び付け直さない。
 */
export function applyExisting(item: CartItem, ex: ExistingBookInfo, matchedBy: CartMatch = 'isbn'): CartItem {
  if (matchedBy === 'title' && item.forceNew) return item;
  const { book, seriesName } = ex;
  const hasSeries = book.seriesId != null && !blank(seriesName);
  const candidate = fillCandidateBlanks(candidateFromBook(book, hasSeries ? seriesName : null), item.candidate);
  const sameBook = item.existingBookId === book.id;
  return {
    ...item,
    status: 'ready',
    candidate,
    isbn: item.isbn ?? cartIsbn(book.isbn),
    existingBookId: book.id,
    matchedBy: item.matchedBy === 'chosen' && sameBook ? 'chosen' : matchedBy,
    beforeMatch:
      matchedBy === 'title'
        ? (sameBook ? item.beforeMatch : null) ??
          { candidate: item.candidate, isbn: item.isbn, seriesName: item.seriesName, volume: item.volume }
        : null,
    seriesName: hasSeries ? seriesName : item.seriesName,
    volume: hasSeries ? (book.volume ?? item.volume) : (item.volume ?? book.volume),
  };
}

/**
 * ISBN からの書誌取得が終わったときの反映（既存の本の確認も終わった後に呼ぶ）。
 *   - 既存の本が反映済み → 空欄だけ補う（シリーズ未設定なら推定値を入れる）
 *   - 見つかった → ready
 *   - 見つからない → not-found（タイトル手入力を促す）
 * 取得中でも既存の本の反映済みでもない項目はそのまま返す。
 */
export function applyLookup(item: CartItem, looked: BookCandidate | null): CartItem {
  if (item.existingBookId && item.candidate) {
    let { seriesName, volume } = item;
    if (looked && blank(seriesName) && !blank(looked.seriesName)) {
      seriesName = looked.seriesName;
      volume = volume ?? looked.volume;
    } else if (
      looked &&
      volume == null &&
      !blank(seriesName) &&
      !blank(looked.seriesName) &&
      normalizeSeriesName(seriesName ?? '') === normalizeSeriesName(looked.seriesName ?? '')
    ) {
      volume = looked.volume;
    }
    return { ...item, status: 'ready', candidate: fillCandidateBlanks(item.candidate, looked), seriesName, volume };
  }
  if (item.status !== 'loading') return item;
  if (looked) {
    return {
      ...item,
      status: 'ready',
      candidate: { ...looked, isbn: item.isbn ?? cartIsbn(looked.isbn), authors: [...looked.authors] },
      seriesName: blank(item.seriesName) ? looked.seriesName : item.seriesName,
      volume: item.volume ?? looked.volume,
    };
  }
  return { ...item, status: item.candidate && !blank(item.candidate.title) ? 'ready' : 'not-found' };
}

/** 既存の本との結び付きを外す（タイトルで結び付けた場合は、結び付ける前の内容に戻す） */
function unlinkExisting(item: CartItem): CartItem {
  if (!item.existingBookId) return item;
  const before = item.beforeMatch;
  return {
    ...item,
    existingBookId: null,
    matchedBy: null,
    beforeMatch: null,
    candidate: before ? before.candidate : item.candidate,
    isbn: before ? before.isbn : item.isbn,
    seriesName: before ? before.seriesName : item.seriesName,
    volume: before ? before.volume : item.volume,
  };
}

/** update(key, patch) の反映 */
export function applyPatch(item: CartItem, patch: CartItemPatch): CartItem {
  let next: CartItem = { ...item };
  if (patch.existingBookId === null || patch.forceNew === true) next = unlinkExisting(next);
  if (patch.forceNew !== undefined) next.forceNew = patch.forceNew;
  if (patch.seriesName !== undefined) next.seriesName = blank(patch.seriesName) ? null : patch.seriesName;
  if (patch.volume !== undefined) next.volume = patch.volume;
  if (patch.dueOnOverride !== undefined) next.dueOnOverride = patch.dueOnOverride || null;
  if (patch.candidate !== undefined) next.candidate = patch.candidate;
  return next;
}

// ---------------------------------------------------------------------------
// 状態の判定
// ---------------------------------------------------------------------------

/** 登録できる状態か（取得が終わり、タイトルがある） */
export function isItemResolved(item: CartItem): boolean {
  return item.status !== 'loading' && item.candidate != null && !blank(item.candidate.title);
}

/** 表示用のタイトル（無ければ null） */
export function itemTitle(item: CartItem): string | null {
  const t = item.candidate?.title?.trim();
  return t ? t : null;
}

// ---------------------------------------------------------------------------
// 保存（localStorage）
// ---------------------------------------------------------------------------

export const CART_STORAGE_KEY = 'borrowCart.v1';

export type StoredCart = {
  /** 保存したときのグループ（別のグループに切り替わったら捨てる） */
  groupId: string | null;
  items: CartItem[];
};

const STATUSES: readonly CartItemStatus[] = ['loading', 'ready', 'not-found'];
const MATCHES: readonly CartMatch[] = ['isbn', 'title', 'chosen'];
const SOURCES: readonly BookSource[] = ['openbd', 'ndl', 'google', 'manual'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function parseCandidate(v: unknown): BookCandidate | null {
  if (!isRecord(v) || typeof v.title !== 'string') return null;
  const source = SOURCES.includes(v.source as BookSource) ? (v.source as BookSource) : 'manual';
  return {
    isbn: strOrNull(v.isbn),
    title: v.title,
    authors: Array.isArray(v.authors) ? v.authors.filter((a): a is string => typeof a === 'string') : [],
    publisher: strOrNull(v.publisher),
    coverUrl: strOrNull(v.coverUrl),
    seriesName: strOrNull(v.seriesName),
    volume: intOrNull(v.volume),
    source,
  };
}

function parseBeforeMatch(v: unknown): CartItemBeforeMatch | null {
  if (!isRecord(v)) return null;
  return {
    candidate: parseCandidate(v.candidate),
    isbn: strOrNull(v.isbn),
    seriesName: strOrNull(v.seriesName),
    volume: intOrNull(v.volume),
  };
}

function parseItem(v: unknown): CartItem | null {
  if (!isRecord(v)) return null;
  const key = strOrNull(v.key);
  if (!key) return null;
  const candidate = parseCandidate(v.candidate);
  const isbn = strOrNull(v.isbn);
  let status: CartItemStatus = STATUSES.includes(v.status as CartItemStatus) ? (v.status as CartItemStatus) : 'loading';
  // 書誌が無い ready は取得し直す（ISBN も無ければ手入力に回す）
  if (status === 'ready' && !candidate) status = isbn ? 'loading' : 'not-found';
  if (status === 'loading' && !isbn) status = candidate ? 'ready' : 'not-found';
  const due = typeof v.dueOnOverride === 'string' && DATE_RE.test(v.dueOnOverride) ? v.dueOnOverride : null;
  const existingBookId = strOrNull(v.existingBookId);
  const matchedBy =
    existingBookId && MATCHES.includes(v.matchedBy as CartMatch) ? (v.matchedBy as CartMatch) : null;
  return {
    key,
    status,
    candidate,
    isbn,
    existingBookId,
    matchedBy,
    forceNew: v.forceNew === true,
    beforeMatch: matchedBy === 'title' ? parseBeforeMatch(v.beforeMatch) : null,
    seriesName: strOrNull(v.seriesName),
    volume: intOrNull(v.volume),
    dueOnOverride: due,
  };
}

/** 保存した内容を読む。壊れている部分は捨てる */
export function parseStoredCart(raw: string | null | undefined): StoredCart {
  const empty: StoredCart = { groupId: null, items: [] };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items)) return empty;
  const items: CartItem[] = [];
  const seen = new Set<string>();
  for (const v of parsed.items) {
    const item = parseItem(v);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    items.push(item);
  }
  return { groupId: strOrNull(parsed.groupId), items };
}

export function serializeCart(groupId: string | null, items: readonly CartItem[]): string {
  return JSON.stringify({ version: 1, groupId, items });
}
