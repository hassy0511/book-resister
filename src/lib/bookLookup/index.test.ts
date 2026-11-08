// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import googleEmpty from './__fixtures__/google-empty.json?raw';
import googleOnePiece from './__fixtures__/google-isbn-onepiece.json?raw';
import googleZorori from './__fixtures__/google-isbn-zorori.json?raw';
import googleGuri from './__fixtures__/google-title-guri.json?raw';
import ndlEmpty from './__fixtures__/ndl-empty.xml?raw';
import ndlOnePiece from './__fixtures__/ndl-isbn-onepiece.xml?raw';
import ndlZorori from './__fixtures__/ndl-isbn-zorori.xml?raw';
import ndlGuri from './__fixtures__/ndl-title-guri.xml?raw';
import openbdNotFound from './__fixtures__/openbd-notfound.json?raw';
import openbdOnePiece from './__fixtures__/openbd-onepiece.json?raw';
import openbdOshiri from './__fixtures__/openbd-oshiri.json?raw';
import { lookupByIsbn, lookupByIsbnDetailed, searchByTitle, searchByTitleDetailed } from './index';

const ZORORI_ISBN = '9784591082331';

/** openBD の応答（表紙あり。series はレーベル名だけ・空・巻次なしなど） */
function openbdZorori(series: string): string {
  return JSON.stringify([
    {
      summary: {
        isbn: ZORORI_ISBN,
        title: 'かいけつゾロリのきょうふのエイリアン',
        volume: '',
        series,
        publisher: 'ポプラ社',
        cover: 'https://cover.openbd.jp/9784591082331.jpg',
        author: '原ゆたか／さく・え',
      },
    },
  ]);
}

/** NDL の ISBN 検索の応答（dcndl:seriesTitle 付き） */
function ndlWithSeries(isbn: string, title: string, seriesTitle: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <item>
      <title>${title}</title>
      <category>図書</category>
      <dc:title>${title}</dc:title>
      <dc:creator>原, ゆたか, 1953-</dc:creator>
      <dc:publisher>ポプラ社</dc:publisher>
      <dcndl:seriesTitle>${seriesTitle}</dcndl:seriesTitle>
      <dc:identifier xsi:type="dcndl:ISBN">${isbn}</dc:identifier>
    </item>
  </channel>
</rss>`;
}

/** 応答の指定: 本文（200）、HTTP ステータス、通信失敗、応答しない（タイムアウトまで） */
type Reply = string | number | 'network-error' | 'hang';
type Routes = { openbd?: Reply; ndl?: Reply; google?: Reply };

function apiOf(url: string): keyof Routes {
  if (url.startsWith('https://api.openbd.jp/')) return 'openbd';
  if (url.startsWith('https://ndlsearch.ndl.go.jp/')) return 'ndl';
  if (url.startsWith('https://www.googleapis.com/')) return 'google';
  throw new Error(`想定外の URL: ${url}`);
}

function mockApis(routes: Routes) {
  const calls: string[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const reply = routes[apiOf(url)] ?? 404;
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (typeof reply === 'number') return Promise.resolve(new Response('error', { status: reply }));
    return Promise.resolve(new Response(reply, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, apis: () => calls.map(apiOf), fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('lookupByIsbn', () => {
  it('openBD で表紙まで揃えば後続の API は呼ばない', async () => {
    const m = mockApis({ openbd: openbdOshiri });
    const c = await lookupByIsbn('9784591153956');
    expect(m.apis()).toEqual(['openbd']);
    expect(c).toEqual({
      isbn: '9784591153956',
      title: 'おしりたんてい ププッ ゆきやまの しろいかいぶつ！？',
      authors: ['トロル'],
      publisher: 'ポプラ社',
      coverUrl: 'https://cover.openbd.jp/9784591153956.jpg',
      seriesName: 'おしりたんてい',
      volume: 5,
      source: 'openbd',
    });
  });

  it('openBD に表紙が無ければ、表紙を持たない NDL は飛ばして Google Books で補う', async () => {
    const m = mockApis({ openbd: openbdOnePiece, ndl: ndlOnePiece, google: googleOnePiece });
    const c = await lookupByIsbn('9784088833132');
    expect(m.apis()).toEqual(['openbd', 'google']);
    expect(c).toEqual({
      isbn: '9784088833132',
      title: 'ONE PIECE 104',
      authors: ['尾田栄一郎'],
      publisher: '集英社',
      coverUrl:
        'https://books.google.com/books/content?id=Xk2fEAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
      seriesName: 'ONE PIECE',
      volume: 104,
      source: 'openbd',
    });
  });

  it('openBD に無ければ NDL を基にし、表紙を Google Books で補う', async () => {
    const m = mockApis({ openbd: openbdNotFound, ndl: ndlZorori, google: googleZorori });
    const c = await lookupByIsbn('9784591025093');
    expect(m.apis()).toEqual(['openbd', 'ndl', 'google']);
    expect(c).toEqual({
      isbn: '9784591025093',
      title: 'かいけつゾロリのドラゴンたいじ',
      authors: ['原ゆたか'],
      publisher: 'ポプラ社',
      coverUrl:
        'https://books.google.com/books/content?id=zR0rAAAACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
      seriesName: 'かいけつゾロリシリーズ',
      volume: 1,
      source: 'ndl',
    });
  });

  it('どの API にも表紙が無ければ NDL の書影 URL を入れる', async () => {
    mockApis({ openbd: openbdNotFound, ndl: ndlZorori, google: googleEmpty });
    const c = await lookupByIsbn('9784591025093');
    expect(c?.coverUrl).toBe('https://ndlsearch.ndl.go.jp/thumbnail/9784591025093.jpg');
    expect(c?.source).toBe('ndl');
  });

  it('openBD に著者が無ければ NDL で補い、揃えば Google Books は呼ばない', async () => {
    const noAuthor = JSON.stringify([
      {
        summary: {
          isbn: '9784591025093',
          title: 'かいけつゾロリのドラゴンたいじ',
          publisher: 'ポプラ社',
          cover: 'https://cover.openbd.jp/9784591025093.jpg',
          author: '',
        },
      },
    ]);
    const m = mockApis({ openbd: noAuthor, ndl: ndlZorori, google: googleZorori });
    const c = await lookupByIsbn('9784591025093');
    expect(m.apis()).toEqual(['openbd', 'ndl']);
    expect(c).toMatchObject({
      authors: ['原ゆたか'],
      coverUrl: 'https://cover.openbd.jp/9784591025093.jpg',
      seriesName: 'かいけつゾロリシリーズ', // 後続の API のシリーズ情報も使う
      volume: 1,
      source: 'openbd',
    });
  });

  it('API が失敗・タイムアウト（8 秒）しても例外を出さず次へ進む。シリーズはタイトルから推定', async () => {
    vi.useFakeTimers();
    const m = mockApis({ openbd: 'network-error', ndl: 'hang', google: googleOnePiece });
    const p = lookupByIsbn('9784088833132');
    await vi.advanceTimersByTimeAsync(8000);
    const c = await p;
    expect(m.apis()).toEqual(['openbd', 'ndl', 'google']);
    expect(c).toMatchObject({ title: 'ONE PIECE 104', seriesName: 'ONE PIECE', volume: 104, source: 'google' });
  });

  it('すべて失敗なら null。Detailed では failed: true（見つからないのではなく、確かめられなかった）', async () => {
    mockApis({ openbd: 500, ndl: 'network-error', google: 429 });
    await expect(lookupByIsbn('9784834000825')).resolves.toBeNull();
    await expect(lookupByIsbnDetailed('9784834000825')).resolves.toEqual({ candidate: null, failed: true });
  });

  it('すべて該当なしなら null。Detailed では failed: false', async () => {
    mockApis({ openbd: openbdNotFound, ndl: ndlEmpty, google: googleEmpty });
    await expect(lookupByIsbn('9784834000825')).resolves.toBeNull();
    await expect(lookupByIsbnDetailed('9784834000825')).resolves.toEqual({ candidate: null, failed: false });
  });

  it('1 つでも失敗して見つからなければ failed: true（キー無しの Google の 429 だけでも）', async () => {
    mockApis({ openbd: openbdNotFound, ndl: ndlEmpty, google: 429 });
    await expect(lookupByIsbnDetailed('9784834000825')).resolves.toEqual({ candidate: null, failed: true });
    vi.useFakeTimers();
    mockApis({ openbd: 'hang', ndl: ndlEmpty, google: googleEmpty });
    const p = lookupByIsbnDetailed('9784834000825');
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toEqual({ candidate: null, failed: true });
  });

  it('見つかれば、途中の API が失敗していても failed: false', async () => {
    mockApis({ openbd: 'network-error', ndl: ndlZorori, google: googleZorori });
    const r = await lookupByIsbnDetailed('9784591025093');
    expect(r.failed).toBe(false);
    expect(r.candidate?.title).toBe('かいけつゾロリのドラゴンたいじ');
  });

  it('呼び出し側の中断は失敗に数えない', async () => {
    mockApis({ openbd: 'hang' });
    const ctrl = new AbortController();
    const p = lookupByIsbnDetailed('9784591025093', { signal: ctrl.signal });
    await Promise.resolve();
    ctrl.abort();
    await expect(p).resolves.toEqual({ candidate: null, failed: false });
  });

  describe('シリーズ名・巻数が定まらなければ NDL も呼ぶ', () => {
    const ndlZorori36 = ndlWithSeries(
      ZORORI_ISBN,
      'かいけつゾロリのきょうふのエイリアン',
      'ポプラ社の新・小さな童話 ; 205. かいけつゾロリシリーズ ; 36',
    );

    it.each([
      ['レーベル名だけ', 'ポプラ社の新・小さな童話'],
      ['空', ''],
      ['巻次なし', 'かいけつゾロリシリーズ'],
    ])('openBD のシリーズが%sなら、表紙があっても NDL のシリーズ・巻数を使う', async (_label, series) => {
      const m = mockApis({ openbd: openbdZorori(series), ndl: ndlZorori36, google: googleZorori });
      const c = await lookupByIsbn(ZORORI_ISBN);
      expect(m.apis()).toEqual(['openbd', 'ndl']);
      expect(c).toMatchObject({
        title: 'かいけつゾロリのきょうふのエイリアン',
        authors: ['原ゆたか'],
        coverUrl: 'https://cover.openbd.jp/9784591082331.jpg',
        seriesName: 'かいけつゾロリシリーズ',
        volume: 36,
        source: 'openbd',
      });
    });

    it('openBD が揃っていて NDL が失敗・タイムアウトしたら、openBD の結果をそのまま返す（failed にしない）', async () => {
      const expected = {
        isbn: ZORORI_ISBN,
        title: 'かいけつゾロリのきょうふのエイリアン',
        authors: ['原ゆたか'],
        publisher: 'ポプラ社',
        coverUrl: 'https://cover.openbd.jp/9784591082331.jpg',
        seriesName: null,
        volume: null,
        source: 'openbd',
      };
      const m = mockApis({ openbd: openbdZorori(''), ndl: 'network-error' });
      await expect(lookupByIsbnDetailed(ZORORI_ISBN)).resolves.toEqual({ candidate: expected, failed: false });
      expect(m.apis()).toEqual(['openbd', 'ndl']);

      vi.useFakeTimers();
      mockApis({ openbd: openbdZorori(''), ndl: 'hang' });
      const p = lookupByIsbnDetailed(ZORORI_ISBN);
      await vi.advanceTimersByTimeAsync(8000);
      await expect(p).resolves.toEqual({ candidate: expected, failed: false });
    });

    it('シリーズのためだけに呼んだ NDL のシリーズに巻数が無ければ使わない（レーベル・叢書名のことが多い）', async () => {
      const ndlLabel = ndlWithSeries(ZORORI_ISBN, 'かいけつゾロリのきょうふのエイリアン', 'たのしいどうわのほん');
      mockApis({ openbd: openbdZorori(''), ndl: ndlLabel });
      const c = await lookupByIsbn(ZORORI_ISBN);
      expect(c).toMatchObject({ seriesName: null, volume: null });
    });

    it('シリーズも巻数もタイトルから分かる本は NDL を呼ばない（おしりたんてい・ONE PIECE は上のテスト）', async () => {
      const body = JSON.stringify([
        {
          summary: {
            isbn: '9784591153956',
            title: 'おしりたんてい (3)',
            publisher: 'ポプラ社',
            cover: 'https://cover.openbd.jp/9784591153956.jpg',
            author: 'トロル／さく・え',
          },
        },
      ]);
      const m = mockApis({ openbd: body, ndl: ndlEmpty });
      const c = await lookupByIsbn('9784591153956');
      expect(m.apis()).toEqual(['openbd']);
      expect(c).toMatchObject({ seriesName: 'おしりたんてい', volume: 3 });
    });
  });

  it('不正な ISBN は通信せず null', async () => {
    const m = mockApis({});
    await expect(lookupByIsbn('1920193012002')).resolves.toBeNull();
    await expect(lookupByIsbn('9784834000826')).resolves.toBeNull();
    expect(m.calls).toEqual([]);
  });

  it('ISBN-10・ハイフン付きも 13 桁にして問い合わせる', async () => {
    const m = mockApis({ openbd: openbdOshiri });
    const c = await lookupByIsbn('4-591-15395-9');
    expect(m.calls).toEqual(['https://api.openbd.jp/v1/get?isbn=9784591153956']);
    expect(c?.isbn).toBe('9784591153956');
    await lookupByIsbn('978-4-591-15395-6');
    expect(m.calls[1]).toBe('https://api.openbd.jp/v1/get?isbn=9784591153956');
  });

  it('呼び出し側の signal で中断したら後続を呼ばずに null', async () => {
    const m = mockApis({ openbd: 'hang', ndl: ndlZorori, google: googleZorori });
    const ctrl = new AbortController();
    const p = lookupByIsbn('9784591025093', { signal: ctrl.signal });
    await Promise.resolve();
    ctrl.abort();
    await expect(p).resolves.toBeNull();
    expect(m.apis()).toEqual(['openbd']);
  });

  it('VITE_GOOGLE_BOOKS_API_KEY があれば key= を付ける', async () => {
    vi.stubEnv('VITE_GOOGLE_BOOKS_API_KEY', 'TESTKEY');
    const m = mockApis({ openbd: openbdNotFound, ndl: ndlEmpty, google: googleOnePiece });
    await lookupByIsbn('9784088833132');
    expect(m.calls[2]).toBe('https://www.googleapis.com/books/v1/volumes?q=isbn%3A9784088833132&key=TESTKEY');
  });
});

describe('searchByTitle', () => {
  it('NDL と Google Books を並行で呼び、ISBN／タイトル＋著者で重複を除く', async () => {
    const m = mockApis({ ndl: ndlGuri, google: googleGuri });
    const list = await searchByTitle('ぐりとぐら');
    expect(m.apis().sort()).toEqual(['google', 'ndl']);
    expect(m.calls).toContain('https://ndlsearch.ndl.go.jp/api/opensearch?title=%E3%81%90%E3%82%8A%E3%81%A8%E3%81%90%E3%82%89&cnt=50');
    expect(list.map((c) => [c.title, c.isbn])).toEqual([
      ['ぐりとぐら', '9784834000825'],
      ['ぐりとぐらとくるりくら', '9784834016222'],
      ['ぐりとぐらのおきゃくさま', '9784834001600'],
      ['ぐりとぐら こどものとも 1963年12月号', null],
      ['ぐりとぐらの1ねんかん', '9784834003505'],
    ]);
    // NDL の結果に Google Books の表紙を補う
    expect(list[0]).toMatchObject({
      authors: ['なかがわりえこ', 'おおむらゆりこ'],
      publisher: '福音館書店',
      coverUrl: 'https://books.google.com/books/content?id=G1aaAAAACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
      source: 'ndl',
    });
    // 表紙の無い ISBN 付きの本は NDL の書影、ISBN も無ければ null
    expect(list[1].coverUrl).toBe('https://ndlsearch.ndl.go.jp/thumbnail/9784834016222.jpg');
    expect(list[3].coverUrl).toBeNull();
  });

  it('2 つの API を並行で呼ぶ（一方が応答しなくても、もう一方は呼ばれている）', async () => {
    vi.useFakeTimers();
    const m = mockApis({ ndl: 'hang', google: googleGuri });
    const p = searchByTitle('ぐりとぐら');
    await vi.advanceTimersByTimeAsync(0);
    expect(m.apis().sort()).toEqual(['google', 'ndl']);
    await vi.advanceTimersByTimeAsync(8000);
    const list = await p;
    expect(list.map((c) => c.source)).toEqual(['google', 'google', 'google', 'google']);
  });

  it('片方が失敗してももう片方の結果を返す', async () => {
    mockApis({ ndl: ndlGuri, google: 403 });
    const list = await searchByTitle('ぐりとぐら');
    expect(list.map((c) => c.source)).toEqual(['ndl', 'ndl', 'ndl']);
  });

  it('タイトルからシリーズを推定する', async () => {
    const body = JSON.stringify({ items: [{ volumeInfo: { title: 'おしりたんてい（3）' } }] });
    mockApis({ ndl: ndlEmpty, google: body });
    const list = await searchByTitle('おしりたんてい');
    expect(list[0]).toMatchObject({ seriesName: 'おしりたんてい', volume: 3 });
  });

  it('最大 20 件', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ volumeInfo: { title: `本 その${i + 1}`, authors: ['a'] } }));
    mockApis({ ndl: ndlEmpty, google: JSON.stringify({ items }) });
    await expect(searchByTitle('本')).resolves.toHaveLength(20);
  });

  it('空の検索語は通信せず空配列', async () => {
    const m = mockApis({});
    await expect(searchByTitle('　 ')).resolves.toEqual([]);
    expect(m.calls).toEqual([]);
  });

  it('ISBN が入力されたら ISBN で引く', async () => {
    const m = mockApis({ openbd: openbdOshiri });
    const list = await searchByTitle('978-4-591-15395-6');
    expect(m.apis()).toEqual(['openbd']);
    expect(list).toHaveLength(1);
    expect(list[0].isbn).toBe('9784591153956');
  });

  it.each([
    ['ISBN978-4-591-15395-6'],
    ['ISBN 978-4-591-15395-6'],
    ['978‐4‐591‐15395‐6'], // U+2010
    ['ISBN：９７８－４－５９１－１５３９５－６'],
  ])('「%s」も ISBN で引く（タイトルとして検索しない）', async (q) => {
    const m = mockApis({ openbd: openbdOshiri });
    const list = await searchByTitle(q);
    expect(m.calls).toEqual(['https://api.openbd.jp/v1/get?isbn=9784591153956']);
    expect(list.map((c) => c.isbn)).toEqual(['9784591153956']);
  });

  it('全角Ｘの ISBN-10 も ISBN で引く', async () => {
    const m = mockApis({ openbd: openbdNotFound, ndl: ndlEmpty, google: googleEmpty });
    await searchByTitle('０８０４４２９５７Ｘ');
    expect(m.apis()).toEqual(['openbd', 'ndl', 'google']);
    expect(m.calls[0]).toBe('https://api.openbd.jp/v1/get?isbn=9780804429573');
  });

  it('すべて失敗しても例外を出さない。Detailed では failed: true', async () => {
    mockApis({ ndl: 'network-error', google: 'network-error' });
    await expect(searchByTitle('ぐりとぐら')).resolves.toEqual([]);
    await expect(searchByTitleDetailed('ぐりとぐら')).resolves.toEqual({ candidates: [], failed: true });
  });

  it('Detailed: 0 件で一方が失敗（NDL の失敗と Google の 429）なら failed: true、どちらも該当なしなら false', async () => {
    mockApis({ ndl: 503, google: googleEmpty });
    await expect(searchByTitleDetailed('ぐりとぐら')).resolves.toEqual({ candidates: [], failed: true });
    mockApis({ ndl: ndlEmpty, google: 429 });
    await expect(searchByTitleDetailed('ぐりとぐら')).resolves.toEqual({ candidates: [], failed: true });
    mockApis({ ndl: ndlEmpty, google: googleEmpty });
    await expect(searchByTitleDetailed('ぐりとぐら')).resolves.toEqual({ candidates: [], failed: false });
  });

  it('Detailed: 結果があれば一方が失敗していても failed: false', async () => {
    mockApis({ ndl: ndlGuri, google: 429 });
    const r = await searchByTitleDetailed('ぐりとぐら');
    expect(r.failed).toBe(false);
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('Detailed: ISBN の入力で通信に失敗したら failed: true', async () => {
    mockApis({ openbd: 'network-error', ndl: 'network-error', google: 429 });
    await expect(searchByTitleDetailed('978-4-591-15395-6')).resolves.toEqual({ candidates: [], failed: true });
  });
});
