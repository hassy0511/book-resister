import { describe, expect, it } from 'vitest';
import {
  capabilitiesHaveTorch,
  classifyCameraError,
  computeScanBand,
  createDetectionGate,
  DETECT_COOLDOWN_MS,
  findBookCode,
  getCameraSupport,
  rgbaToLuminance,
  type ScanBand,
} from './scannerLogic';

// テスト用の簡易判定（本物は lib/isbn の isBookEan）
const isBook = (code: string) => /^97[89]\d{10}$/.test(code);

const BOOK_A = '9784834000825';
const BOOK_B = '9784061323053';
const PRICE = '1920093012001';

describe('createDetectionGate', () => {
  it('書籍 EAN だけを通す（192 の価格コードは通さない）', () => {
    const gate = createDetectionGate({ isBook });
    expect(gate.accept(PRICE, 0)).toBe(false);
    expect(gate.accept(BOOK_A, 0)).toBe(true);
  });

  it('同じコードは 2.5 秒間抑制し、過ぎれば再び通す', () => {
    const gate = createDetectionGate({ isBook });
    expect(DETECT_COOLDOWN_MS).toBe(2500);
    expect(gate.accept(BOOK_A, 1000)).toBe(true);
    expect(gate.accept(BOOK_A, 1500)).toBe(false);
    expect(gate.accept(BOOK_A, 1500 + 2499)).toBe(false);
    expect(gate.accept(BOOK_A, 1500 + 2499 + 2500)).toBe(true);
  });

  it('映り続けている間（抑制中も見えている）は通さない', () => {
    const gate = createDetectionGate({ isBook });
    expect(gate.accept(BOOK_A, 0)).toBe(true);
    for (let t = 400; t <= 10_000; t += 400) {
      expect(gate.accept(BOOK_A, t)).toBe(false);
    }
  });

  it('別のコードは抑制しない。交互に映っても同じコードは抑制する', () => {
    const gate = createDetectionGate({ isBook });
    expect(gate.accept(BOOK_A, 0)).toBe(true);
    expect(gate.accept(BOOK_B, 100)).toBe(true);
    expect(gate.accept(BOOK_A, 200)).toBe(false);
    expect(gate.accept(BOOK_B, 300)).toBe(false);
  });

  it('価格コードを挟んでも同じ本は抑制される', () => {
    const gate = createDetectionGate({ isBook });
    expect(gate.accept(BOOK_A, 0)).toBe(true);
    expect(gate.accept(PRICE, 100)).toBe(false);
    expect(gate.accept(BOOK_A, 200)).toBe(false);
  });

  it('reset で抑制を解除する', () => {
    const gate = createDetectionGate({ isBook, cooldownMs: 1000 });
    expect(gate.accept(BOOK_A, 0)).toBe(true);
    gate.reset();
    expect(gate.accept(BOOK_A, 10)).toBe(true);
  });
});

describe('findBookCode', () => {
  const res = (text: string) => ({ getText: () => text });

  it('帯全体で書籍 EAN が読めればそれを返す（1 回だけ読む）', () => {
    const calls: ScanBand[] = [];
    const r = findBookCode((b) => (calls.push(b), res(BOOK_A)), { top: 0, height: 300 }, isBook);
    expect(r?.getText()).toBe(BOOK_A);
    expect(calls).toHaveLength(1);
  });

  it('何も読めなければ null（分割はしない）', () => {
    const calls: ScanBand[] = [];
    expect(findBookCode((b) => (calls.push(b), null), { top: 0, height: 300 }, isBook)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('下段の価格コードが読めたら、上下に分けて上段の ISBN を探す', () => {
    // 上段 (0〜140) に ISBN、下段 (160〜300) に価格コード。中央に近い方が先に読まれる想定
    const decode = (b: ScanBand) => {
      const center = b.top + b.height / 2;
      return center < 150 ? res(BOOK_A) : res(PRICE);
    };
    const r = findBookCode(decode, { top: 0, height: 300 }, isBook);
    expect(r?.getText()).toBe(BOOK_A);
  });

  it('分割する帯は上側 60%・下側 60%（重なりあり）', () => {
    const calls: ScanBand[] = [];
    findBookCode((b) => (calls.push(b), res(PRICE)), { top: 100, height: 200 }, isBook);
    expect(calls).toEqual([
      { top: 100, height: 200 },
      { top: 100, height: 120 },
      { top: 180, height: 120 },
    ]);
  });

  it('価格コードしか無ければ null', () => {
    expect(findBookCode(() => res(PRICE), { top: 0, height: 300 }, isBook)).toBeNull();
  });

  it('帯が低すぎるときは分割しない', () => {
    const calls: ScanBand[] = [];
    expect(findBookCode((b) => (calls.push(b), res(PRICE)), { top: 0, height: 10 }, isBook)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('computeScanBand', () => {
  it('縦長の映像（720x1280）を横長の枠に cover 表示したとき、ガイド枠の行に余白を足した範囲を返す', () => {
    // 表示 375x281、scale = max(375/720, 281/1280) = 0.5208…
    const viewport = { left: 0, top: 100, width: 375, height: 281 };
    const scale = 375 / 720;
    // ガイド枠: 300x120 を中央に
    const guide = { left: 37.5, top: 100 + (281 - 120) / 2, width: 300, height: 120 };
    const band = computeScanBand({ frameWidth: 720, frameHeight: 1280, viewport, guide, margin: 0.5 });
    expect(band).not.toBeNull();
    if (!band) return;
    // 中央がフレームの中央（640）に一致し、高さは (120 + 120) / scale ≒ 461
    expect(band.top + band.height / 2).toBeCloseTo(640, -1);
    expect(band.height).toBeGreaterThanOrEqual(Math.floor(240 / scale));
    expect(band.height).toBeLessThanOrEqual(Math.ceil(240 / scale) + 1);
  });

  it('余白 0 ならガイド枠そのもの', () => {
    const viewport = { left: 0, top: 0, width: 400, height: 300 };
    // 映像 1280x720（横長）→ scale = max(400/1280, 300/720) = 0.41667、横がはみ出す
    const guide = { left: 40, top: 100, width: 320, height: 100 };
    const band = computeScanBand({ frameWidth: 1280, frameHeight: 720, viewport, guide, margin: 0 });
    expect(band).toEqual({ top: 240, height: 240 });
  });

  it('フレームの外にはみ出す分は切り詰める', () => {
    const viewport = { left: 0, top: 0, width: 400, height: 300 };
    const guide = { left: 0, top: 0, width: 400, height: 300 };
    const band = computeScanBand({ frameWidth: 1280, frameHeight: 720, viewport, guide, margin: 0.5 });
    expect(band).toEqual({ top: 0, height: 720 });
  });

  it('大きさが分からない（0）ときは null', () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(computeScanBand({ frameWidth: 0, frameHeight: 0, viewport: rect, guide: rect })).toBeNull();
    expect(
      computeScanBand({
        frameWidth: 1280,
        frameHeight: 720,
        viewport: { left: 0, top: 0, width: 400, height: 300 },
        guide: rect,
      }),
    ).toBeNull();
  });
});

describe('rgbaToLuminance', () => {
  it('白は 255、黒は 0、緑は赤より明るい', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    const lum = rgbaToLuminance(rgba);
    expect(Array.from(lum)).toHaveLength(4);
    expect(lum[0]).toBe(255);
    expect(lum[1]).toBe(0);
    expect(lum[3]).toBeGreaterThan(lum[2]);
  });

  it('十分な大きさのバッファを渡せば使い回す', () => {
    const out = new Uint8ClampedArray(2);
    const lum = rgbaToLuminance(new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]), out);
    expect(lum).toBe(out);
    expect(Array.from(out)).toEqual([10, 20]);
  });
});

describe('getCameraSupport', () => {
  it('https でなければ insecure、getUserMedia が無ければ unsupported', () => {
    expect(getCameraSupport({ isSecureContext: false, hasGetUserMedia: true })).toBe('insecure');
    expect(getCameraSupport({ isSecureContext: true, hasGetUserMedia: false })).toBe('unsupported');
    expect(getCameraSupport({ isSecureContext: true, hasGetUserMedia: true })).toBe('ok');
  });
});

describe('classifyCameraError', () => {
  const err = (name: string) => Object.assign(new Error(name), { name });

  it('許可の拒否', () => {
    expect(classifyCameraError(err('NotAllowedError'))).toBe('denied');
    expect(classifyCameraError(err('SecurityError'))).toBe('denied');
  });

  it('カメラが無い', () => {
    expect(classifyCameraError(err('NotFoundError'))).toBe('no-camera');
    expect(classifyCameraError(err('OverconstrainedError'))).toBe('no-camera');
  });

  it('使用中', () => {
    expect(classifyCameraError(err('NotReadableError'))).toBe('in-use');
  });

  it('その他（Error 以外の値も）', () => {
    expect(classifyCameraError(err('TypeError'))).toBe('error');
    expect(classifyCameraError(false)).toBe('error');
    expect(classifyCameraError(undefined)).toBe('error');
  });
});

describe('capabilitiesHaveTorch', () => {
  it('torch: true か [true] なら対応', () => {
    expect(capabilitiesHaveTorch({ torch: true })).toBe(true);
    expect(capabilitiesHaveTorch({ torch: [false, true] })).toBe(true);
  });

  it('無い・false は非対応', () => {
    expect(capabilitiesHaveTorch({})).toBe(false);
    expect(capabilitiesHaveTorch({ torch: false })).toBe(false);
    expect(capabilitiesHaveTorch({ torch: [false] })).toBe(false);
    expect(capabilitiesHaveTorch(null)).toBe(false);
  });
});
