import { afterEach, describe, expect, it, vi } from 'vitest';
import harryRaw from './__fixtures__/openbd-harry.json?raw';
import notFoundRaw from './__fixtures__/openbd-notfound.json?raw';
import onePieceRaw from './__fixtures__/openbd-onepiece.json?raw';
import oshiriRaw from './__fixtures__/openbd-oshiri.json?raw';
import { fetchOpenBdByIsbn, fetchOpenBdByIsbnDetailed, openBdUrl, parseOpenBdResponse, splitOpenBdAuthor } from './openbd';

const json = (raw: string): unknown => JSON.parse(raw);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openBdUrl', () => {
  it('ISBN を付けた URL', () => {
    expect(openBdUrl('9784834000825')).toBe('https://api.openbd.jp/v1/get?isbn=9784834000825');
  });
});

describe('parseOpenBdResponse', () => {
  it('summary と ONIX から読み取る（副題・シリーズ・巻次・著者・表紙）', () => {
    expect(parseOpenBdResponse(json(oshiriRaw), '9784591153956')).toEqual({
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

  it('漫画: シリーズがレーベル名だけなら書名をシリーズ名にし、書名に巻次を付ける。表紙が空なら null', () => {
    expect(parseOpenBdResponse(json(onePieceRaw), '9784088833132')).toEqual({
      isbn: '9784088833132',
      title: 'ONE PIECE 104',
      authors: ['尾田栄一郎'],
      publisher: '集英社',
      coverUrl: null,
      seriesName: 'ONE PIECE',
      volume: 104,
      source: 'openbd',
    });
  });

  it('ONIX に著者が無ければ summary.author を分けて使う。上巻は巻数 1。表紙は https にする', () => {
    expect(parseOpenBdResponse(json(harryRaw))).toEqual({
      isbn: '9784915512599',
      title: 'ハリー・ポッターと炎のゴブレット 上',
      authors: ['J.K.ローリング', '松岡佑子'],
      publisher: '静山社',
      coverUrl: 'https://cover.openbd.jp/9784915512599.jpg',
      seriesName: 'ハリー・ポッターと炎のゴブレット',
      volume: 1,
      source: 'openbd',
    });
  });

  it('未登録（[null]）や不正な応答は null', () => {
    expect(parseOpenBdResponse(json(notFoundRaw), '9784834000825')).toBeNull();
    expect(parseOpenBdResponse([], '9784834000825')).toBeNull();
    expect(parseOpenBdResponse({ error: 'x' })).toBeNull();
    expect(parseOpenBdResponse('oops')).toBeNull();
    expect(parseOpenBdResponse([{ summary: { isbn: '9784834000825', title: '' } }])).toBeNull();
  });

  it('summary だけでも読める（ONIX の 1 件だけの項目が配列でない場合も含む）', () => {
    const c = parseOpenBdResponse([
      {
        summary: { isbn: '9784834000825', title: 'ぐりとぐら', publisher: '福音館書店', cover: '', author: '' },
        onix: {
          DescriptiveDetail: {
            Contributor: { SequenceNumber: '1', PersonName: { content: '中川 李枝子' } },
          },
        },
      },
    ]);
    expect(c).toMatchObject({ title: 'ぐりとぐら', authors: ['中川李枝子'], publisher: '福音館書店', coverUrl: null });
  });

  it('著者は SequenceNumber 順', () => {
    const c = parseOpenBdResponse([
      {
        summary: { isbn: '9784834000825', title: 'ぐりとぐら' },
        onix: {
          DescriptiveDetail: {
            Contributor: [
              { SequenceNumber: '2', PersonName: { content: '大村 百合子' } },
              { SequenceNumber: '1', PersonName: { content: '中川 李枝子' } },
            ],
          },
        },
      },
    ]);
    expect(c?.authors).toEqual(['中川李枝子', '大村百合子']);
  });

  it('ISBN が summary に無ければ引数の ISBN を使う', () => {
    expect(parseOpenBdResponse([{ summary: { title: 'ぐりとぐら' } }], '9784834000825')?.isbn).toBe('9784834000825');
  });
});

describe('splitOpenBdAuthor', () => {
  it('「名前／役割」の並びを人ごとに分ける', () => {
    expect(splitOpenBdAuthor('J.K.ローリング／作 松岡佑子／訳')).toEqual(['J.K.ローリング', '松岡佑子']);
    expect(splitOpenBdAuthor('原 ゆたか／さく・え')).toEqual(['原 ゆたか']);
    expect(splitOpenBdAuthor('村上春樹／著 安西水丸')).toEqual(['村上春樹', '安西水丸']);
    expect(splitOpenBdAuthor('村上春樹')).toEqual(['村上春樹']);
    expect(splitOpenBdAuthor('')).toEqual([]);
  });
});

describe('fetchOpenBdByIsbn', () => {
  it('取得して解析する', async () => {
    const fetchMock = vi.fn(async () => new Response(oshiriRaw, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const c = await fetchOpenBdByIsbn('9784591153956');
    expect(c?.title).toContain('おしりたんてい');
    expect(fetchMock).toHaveBeenCalledWith('https://api.openbd.jp/v1/get?isbn=9784591153956', expect.anything());
  });

  it('HTTP エラー・ネットワークエラー・壊れた JSON は null（例外を出さない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    await expect(fetchOpenBdByIsbn('9784591153956')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchOpenBdByIsbn('9784591153956')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', { status: 200 })));
    await expect(fetchOpenBdByIsbn('9784591153956')).resolves.toBeNull();
  });

  it('Detailed: 未登録（[null]）は failed: false、HTTP エラー・ネットワークエラー・壊れた JSON は failed: true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[null]', { status: 200 })));
    await expect(fetchOpenBdByIsbnDetailed('9784591153956')).resolves.toEqual({ value: null, failed: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    await expect(fetchOpenBdByIsbnDetailed('9784591153956')).resolves.toEqual({ value: null, failed: true });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchOpenBdByIsbnDetailed('9784591153956')).resolves.toEqual({ value: null, failed: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', { status: 200 })));
    await expect(fetchOpenBdByIsbnDetailed('9784591153956')).resolves.toEqual({ value: null, failed: true });
  });
});
