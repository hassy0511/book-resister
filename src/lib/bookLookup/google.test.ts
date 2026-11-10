import { afterEach, describe, expect, it, vi } from 'vitest';
import emptyRaw from './__fixtures__/google-empty.json?raw';
import onePieceRaw from './__fixtures__/google-isbn-onepiece.json?raw';
import guriRaw from './__fixtures__/google-title-guri.json?raw';
import {
  fetchGoogleByIsbn,
  fetchGoogleByIsbnDetailed,
  googleIsbnUrl,
  googleTitleUrl,
  parseGoogleBooksResponse,
  searchGoogleByTitle,
  searchGoogleByTitleDetailed,
} from './google';

const json = (raw: string): unknown => JSON.parse(raw);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('URL', () => {
  it('ISBN 検索', () => {
    expect(googleIsbnUrl('9784834000825')).toBe('https://www.googleapis.com/books/v1/volumes?q=isbn%3A9784834000825');
  });

  it('API キーがあれば key= を付ける', () => {
    expect(googleIsbnUrl('9784834000825', 'abc')).toBe(
      'https://www.googleapis.com/books/v1/volumes?q=isbn%3A9784834000825&key=abc',
    );
  });

  it('タイトル検索は語ごとに intitle: を付け、20 件・書籍のみ', () => {
    const url = new URL(googleTitleUrl('おしり　たんてい'));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/books/v1/volumes');
    expect(url.searchParams.get('q')).toBe('intitle:おしり intitle:たんてい');
    expect(url.searchParams.get('maxResults')).toBe('20');
    expect(url.searchParams.get('printType')).toBe('books');
    expect(url.searchParams.get('key')).toBeNull();
  });
});

describe('parseGoogleBooksResponse', () => {
  it('volumeInfo から読み取る（表紙は https、edge=curl を外す）', () => {
    expect(parseGoogleBooksResponse(json(onePieceRaw))).toEqual([
      {
        isbn: '9784088833132',
        title: 'ONE PIECE 104',
        authors: ['尾田栄一郎'],
        publisher: '集英社',
        coverUrl:
          'https://books.google.com/books/content?id=Xk2fEAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
        seriesName: null,
        volume: null,
        source: 'google',
      },
    ]);
  });

  it('副題をつなぐ・ISBN_10 しか無くても 13 桁に・ISBN が無ければ null・書名の無いものは除く', () => {
    const list = parseGoogleBooksResponse(json(guriRaw));
    expect(list.map((c) => [c.title, c.isbn])).toEqual([
      ['ぐりとぐら', '9784834000825'],
      ['ぐりとぐらとくるりくら', '9784834016222'],
      ['ぐりとぐら こどものとも 1963年12月号', null],
      ['ぐりとぐらの1ねんかん', '9784834003505'],
    ]);
    expect(list[1]).toMatchObject({ authors: ['なかがわりえこ', 'やまわきゆりこ'], coverUrl: null });
    expect(
      parseGoogleBooksResponse({ items: [{ volumeInfo: { title: 'x', industryIdentifiers: [{ type: 'ISBN_10', identifier: '4834000826' }] } }] })[0]
        .isbn,
    ).toBe('9784834000825');
  });

  it('smallThumbnail しか無ければそれを使う', () => {
    const list = parseGoogleBooksResponse({
      items: [{ volumeInfo: { title: 'x', imageLinks: { smallThumbnail: 'http://books.google.com/a?zoom=5' } } }],
    });
    expect(list[0].coverUrl).toBe('https://books.google.com/a?zoom=5');
  });

  it('0 件・不正な応答は空配列', () => {
    expect(parseGoogleBooksResponse(json(emptyRaw))).toEqual([]);
    expect(parseGoogleBooksResponse(null)).toEqual([]);
    expect(parseGoogleBooksResponse({ error: { code: 429, message: 'Quota exceeded' } })).toEqual([]);
  });
});

describe('fetchGoogleByIsbn', () => {
  it('ISBN が一致するものを返す', async () => {
    const fetchMock = vi.fn(async () => new Response(onePieceRaw, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const c = await fetchGoogleByIsbn('9784088833132', { apiKey: 'k' });
    expect(c?.title).toBe('ONE PIECE 104');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/books/v1/volumes?q=isbn%3A9784088833132&key=k',
      expect.anything(),
    );
  });

  it('別の ISBN の本しか返らなければ null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(onePieceRaw, { status: 200 })));
    await expect(fetchGoogleByIsbn('9784834000825')).resolves.toBeNull();
  });

  it('ISBN 情報の無い結果は該当とみなし、ISBN を補う', async () => {
    const body = JSON.stringify({ items: [{ volumeInfo: { title: 'ぐりとぐら' } }] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    await expect(fetchGoogleByIsbn('9784834000825')).resolves.toMatchObject({ isbn: '9784834000825', title: 'ぐりとぐら' });
  });

  it('0 件・上限超過（429）・通信失敗は null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(emptyRaw, { status: 200 })));
    await expect(fetchGoogleByIsbn('9784088833132')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{}}', { status: 429 })));
    await expect(fetchGoogleByIsbn('9784088833132')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchGoogleByIsbn('9784088833132')).resolves.toBeNull();
  });

  it('Detailed: 0 件は failed: false、上限超過（429）・通信失敗は failed: true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(emptyRaw, { status: 200 })));
    await expect(fetchGoogleByIsbnDetailed('9784088833132')).resolves.toEqual({ value: null, failed: false });
    await expect(searchGoogleByTitleDetailed('ぐりとぐら')).resolves.toEqual({ value: [], failed: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{}}', { status: 429 })));
    await expect(fetchGoogleByIsbnDetailed('9784088833132')).resolves.toEqual({ value: null, failed: true });
    await expect(searchGoogleByTitleDetailed('ぐりとぐら')).resolves.toEqual({ value: [], failed: true });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchGoogleByIsbnDetailed('9784088833132')).resolves.toEqual({ value: null, failed: true });
  });
});

describe('searchGoogleByTitle', () => {
  it('検索結果を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(guriRaw, { status: 200 })));
    await expect(searchGoogleByTitle('ぐりとぐら')).resolves.toHaveLength(4);
  });

  it('空の検索語は通信しない／失敗は空配列', async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new Error('x')));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchGoogleByTitle(' ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(searchGoogleByTitle('ぐりとぐら')).resolves.toEqual([]);
  });
});
