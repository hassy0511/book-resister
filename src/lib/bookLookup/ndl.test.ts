// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import emptyXml from './__fixtures__/ndl-empty.xml?raw';
import onePieceXml from './__fixtures__/ndl-isbn-onepiece.xml?raw';
import zororiXml from './__fixtures__/ndl-isbn-zorori.xml?raw';
import guriXml from './__fixtures__/ndl-title-guri.xml?raw';
import {
  fetchNdlByIsbn,
  ndlIsbnUrl,
  ndlTitleUrl,
  parseNdlOpenSearch,
  pickNdlByIsbn,
  searchNdlByTitle,
} from './ndl';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('URL', () => {
  it('ISBN 検索・タイトル検索（20 件）', () => {
    expect(ndlIsbnUrl('9784834000825')).toBe('https://ndlsearch.ndl.go.jp/api/opensearch?isbn=9784834000825');
    expect(ndlTitleUrl('ぐりとぐら')).toBe(
      'https://ndlsearch.ndl.go.jp/api/opensearch?title=%E3%81%90%E3%82%8A%E3%81%A8%E3%81%90%E3%82%89&cnt=20',
    );
  });
});

describe('parseNdlOpenSearch', () => {
  it('item ごとに読み取る（ISBN-10 は 13 桁に、見出し形の著者名・生年を整える、シリーズと巻次）', () => {
    const items = parseNdlOpenSearch(zororiXml);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      isbn: '9784591025093',
      title: 'かいけつゾロリのドラゴンたいじ',
      authors: ['原ゆたか'],
      publisher: null,
      coverUrl: null,
      seriesName: 'かいけつゾロリシリーズ',
      volume: 1,
      source: 'ndl',
    });
    expect(items[1]).toMatchObject({ authors: ['原ゆたか'], publisher: 'ポプラ社', seriesName: null, volume: null });
  });

  it('dcndl:volume があり、シリーズがレーベル名なら書名をシリーズ名にする', () => {
    expect(parseNdlOpenSearch(onePieceXml)[0]).toEqual({
      isbn: '9784088833132',
      title: 'ONE PIECE 104',
      authors: ['尾田栄一郎'],
      publisher: '集英社',
      coverUrl: null,
      seriesName: 'ONE PIECE',
      volume: 104,
      source: 'ndl',
    });
  });

  it('ISBN の無い雑誌・記事は除き、ISBN の無い図書は残す', () => {
    const items = parseNdlOpenSearch(guriXml);
    expect(items.map((c) => c.title)).toEqual([
      'ぐりとぐら',
      'ぐりとぐら',
      'ぐりとぐらのおきゃくさま',
      'ぐりとぐら [こどものとも 1963年12月号]',
    ]);
    expect(items[0]).toMatchObject({
      isbn: '9784834000825',
      authors: ['なかがわりえこ', 'おおむらゆりこ'],
      publisher: '福音館書店',
      seriesName: null, // 「こどものとも傑作集」はレーベルなのでシリーズにしない
      volume: null,
    });
    expect(items[1].authors).toEqual(['中川李枝子', '大村百合子']);
    expect(items[3]).toMatchObject({ isbn: null, authors: ['中川李枝子'] });
  });

  it('該当なし・壊れた XML・空文字は空配列', () => {
    expect(parseNdlOpenSearch(emptyXml)).toEqual([]);
    expect(parseNdlOpenSearch('<rss><channel><item>')).toEqual([]);
    expect(parseNdlOpenSearch('')).toEqual([]);
    expect(parseNdlOpenSearch('<html><body>Service Unavailable</body></html>')).toEqual([]);
  });

  it('dc:creator が無ければ RSS の author を使う', () => {
    const xml = `<?xml version="1.0"?>
      <rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel><item>
        <title>ハリー・ポッターと賢者の石</title>
        <author>J.K.ローリング 作,松岡佑子 訳,</author>
        <dc:title>ハリー・ポッターと賢者の石</dc:title>
      </item></channel></rss>`;
    expect(parseNdlOpenSearch(xml)[0].authors).toEqual(['J.K.ローリング', '松岡佑子']);
  });

  it('名前空間の接頭辞が違っても URI で読める', () => {
    const xml = `<?xml version="1.0"?>
      <rss xmlns:d="http://purl.org/dc/elements/1.1/" xmlns:n="http://ndl.go.jp/dcndl/terms/"
           xmlns:x="http://www.w3.org/2001/XMLSchema-instance" version="2.0"><channel><item>
        <d:title>ぐりとぐら</d:title>
        <d:creator>なかがわりえこ さく</d:creator>
        <n:volume>2</n:volume>
        <d:identifier x:type="n:ISBN">9784834000825</d:identifier>
      </item></channel></rss>`;
    expect(parseNdlOpenSearch(xml)[0]).toMatchObject({
      isbn: '9784834000825',
      title: 'ぐりとぐら 2',
      authors: ['なかがわりえこ'],
      seriesName: 'ぐりとぐら',
      volume: 2,
    });
  });
});

describe('pickNdlByIsbn', () => {
  it('ISBN が一致する item をまとめる（欠けている出版社を別レコードで補う。セットの ISBN は除く）', () => {
    expect(pickNdlByIsbn(zororiXml, '9784591025093')).toEqual({
      isbn: '9784591025093',
      title: 'かいけつゾロリのドラゴンたいじ',
      authors: ['原ゆたか'],
      publisher: 'ポプラ社',
      coverUrl: null,
      seriesName: 'かいけつゾロリシリーズ',
      volume: 1,
      source: 'ndl',
    });
  });

  it('ISBN-10 で指定しても一致する', () => {
    expect(pickNdlByIsbn(zororiXml, '4-591-02509-8')?.title).toBe('かいけつゾロリのドラゴンたいじ');
  });

  it('一致する item が無ければ null', () => {
    expect(pickNdlByIsbn(zororiXml, '9784834000825')).toBeNull();
    expect(pickNdlByIsbn(emptyXml, '9784834000825')).toBeNull();
    expect(pickNdlByIsbn(zororiXml, 'bad')).toBeNull();
  });
});

describe('fetchNdlByIsbn / searchNdlByTitle', () => {
  it('ISBN で取得する', async () => {
    const fetchMock = vi.fn(async () => new Response(zororiXml, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const c = await fetchNdlByIsbn('9784591025093');
    expect(c?.publisher).toBe('ポプラ社');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ndlsearch.ndl.go.jp/api/opensearch?isbn=9784591025093',
      expect.anything(),
    );
  });

  it('タイトルで検索する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(guriXml, { status: 200 })));
    const list = await searchNdlByTitle('  ぐりとぐら ');
    expect(list).toHaveLength(4);
  });

  it('失敗しても例外を出さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Load failed'))));
    await expect(fetchNdlByIsbn('9784591025093')).resolves.toBeNull();
    await expect(searchNdlByTitle('ぐりとぐら')).resolves.toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(fetchNdlByIsbn('9784591025093')).resolves.toBeNull();
    await expect(searchNdlByTitle('ぐりとぐら')).resolves.toEqual([]);
  });

  it('空の検索語は通信しない', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchNdlByTitle('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
