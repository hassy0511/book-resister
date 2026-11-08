/*
 * 本の編集シートのロジック（純粋関数）: 入力値の作成・検証、updateBook に渡す差分の作成。
 */
import type { Book } from '../../types';
import type { BookPatch } from '../../data/books';
import { normalizeSeriesName } from '../../lib/series';

/** 編集中の値（著者は区切り文字入りの 1 行で持つ） */
export interface BookDraft {
  title: string;
  authors: string;
  publisher: string;
  coverUrl: string;
  seriesName: string | null;
  volume: number | null;
}

type EditableBook = Pick<Book, 'title' | 'authors' | 'publisher' | 'coverUrl' | 'seriesId' | 'volume'>;

/** 著者の区切り（カンマ・読点。全角・半角とも） */
const AUTHOR_SEPARATOR = /[,、，､]/;

/** 著者の入力を配列にする（空の要素・重複は除く） */
export function parseAuthors(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(AUTHOR_SEPARATOR)) {
    const name = part.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 著者の配列を入力欄の文字列にする */
export function formatAuthors(authors: readonly string[]): string {
  return authors.join('、');
}

export function draftFromBook(book: EditableBook, seriesName: string | null): BookDraft {
  return {
    title: book.title,
    authors: formatAuthors(book.authors ?? []),
    publisher: book.publisher ?? '',
    coverUrl: book.coverUrl ?? '',
    seriesName,
    volume: book.volume ?? null,
  };
}

export function titleError(title: string): string | null {
  return title.trim() ? null : 'タイトルを入力してください';
}

/** 表紙の URL は空欄か http(s) の URL */
export function coverUrlError(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  if (!/^https?:\/\/\S+$/i.test(value)) return 'http:// または https:// で始まるアドレスを入力してください';
  try {
    new URL(value);
    return null;
  } catch {
    return 'アドレスの形が正しくありません';
  }
}

function seriesKey(name: string | null): string {
  const t = name?.trim() ?? '';
  return t ? normalizeSeriesName(t) : '';
}

/** シリーズ名が変わったか（表記の揺れは同じとみなす） */
export function seriesNameChanged(draft: Pick<BookDraft, 'seriesName'>, initial: Pick<BookDraft, 'seriesName'>): boolean {
  return seriesKey(draft.seriesName) !== seriesKey(initial.seriesName);
}

function trimOrNull(value: string): string | null {
  const t = value.trim();
  return t === '' ? null : t;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 入力が最初の値から変わったか */
export function isDraftDirty(draft: BookDraft, initial: BookDraft): boolean {
  return (
    draft.title.trim() !== initial.title.trim() ||
    !sameList(parseAuthors(draft.authors), parseAuthors(initial.authors)) ||
    trimOrNull(draft.publisher) !== trimOrNull(initial.publisher) ||
    trimOrNull(draft.coverUrl) !== trimOrNull(initial.coverUrl) ||
    seriesNameChanged(draft, initial) ||
    draft.volume !== initial.volume
  );
}

/**
 * updateBook に渡す差分（変わった項目だけ）。
 * seriesId は保存時に決めたシリーズ ID。undefined ならシリーズは変えない。
 */
export function buildBookPatch(book: EditableBook, draft: BookDraft, seriesId: string | null | undefined): BookPatch {
  const patch: BookPatch = {};
  const title = draft.title.trim();
  if (title !== book.title) patch.title = title;
  const authors = parseAuthors(draft.authors);
  if (!sameList(authors, book.authors ?? [])) patch.authors = authors;
  const publisher = trimOrNull(draft.publisher);
  if (publisher !== (book.publisher ?? null)) patch.publisher = publisher;
  const coverUrl = trimOrNull(draft.coverUrl);
  if (coverUrl !== (book.coverUrl ?? null)) patch.coverUrl = coverUrl;
  if (seriesId !== undefined && seriesId !== (book.seriesId ?? null)) patch.seriesId = seriesId;
  if (draft.volume !== (book.volume ?? null)) patch.volume = draft.volume;
  return patch;
}
