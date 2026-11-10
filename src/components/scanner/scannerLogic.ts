/*
 * バーコードスキャナの純粋ロジック（DOM・ZXing に依存しない。Vitest でテストする）。
 *   - createDetectionGate: 書籍 EAN だけを通し、同じコードの連続検出を抑制する
 *   - findBookCode: 2 段バーコード（上段 978/979・下段 192）から書籍 EAN を選ぶ読み取り手順
 *   - computeScanBand: 画面上のガイド枠に対応する映像フレーム上の行範囲
 *   - rgbaToLuminance: RGBA 画素 → 輝度
 *   - getCameraSupport / classifyCameraError: カメラの可否とエラーの分類
 */

/** 同じコードの連続検出を抑制する時間（ミリ秒） */
export const DETECT_COOLDOWN_MS = 2500;

export interface DetectionGate {
  /**
   * 検出したコードを onDetect に渡すべきなら true。
   * 書籍以外のコード、または同じコードを直前 cooldownMs 以内に見ていた場合は false。
   * 抑制中に見えた場合も「最後に見た時刻」を更新するので、カメラに映り続けている間は 1 回だけ通る。
   */
  accept(code: string, now: number): boolean;
  reset(): void;
}

export function createDetectionGate(opts: {
  isBook: (code: string) => boolean;
  cooldownMs?: number;
}): DetectionGate {
  const cooldown = opts.cooldownMs ?? DETECT_COOLDOWN_MS;
  const lastSeen = new Map<string, number>();
  return {
    accept(code, now) {
      if (!opts.isBook(code)) return false;
      const prev = lastSeen.get(code);
      lastSeen.set(code, now);
      // 古い記録を掃除（家族規模でも長時間スキャンで膨らまないように）
      for (const [k, t] of lastSeen) {
        if (k !== code && now - t >= cooldown) lastSeen.delete(k);
      }
      return prev === undefined || now - prev >= cooldown;
    },
    reset() {
      lastSeen.clear();
    },
  };
}

/** フレーム上の行範囲（横幅は常にフレーム全体） */
export interface ScanBand {
  top: number;
  height: number;
}

/** 2 段目を探すために帯を分割する最小の高さ（px） */
const MIN_SPLIT_HEIGHT = 24;

/**
 * 帯の中から書籍 EAN を探す。
 *  1. 帯全体を読む。書籍 EAN ならそれを返す。
 *  2. 書籍以外（192 で始まる価格コードなど）が読めた場合は、帯を上側 60%・下側 60% に分けて読み直す。
 *     ZXing は帯の中央の行から外側へ順に読むため、2 段バーコードで下段が中央に近いと
 *     上段（ISBN）にたどり着かない。分割するとそれぞれの中央が変わるので上段も読める。
 * decode は読めなければ null を返す（例外は投げない）。
 */
export function findBookCode<T extends { getText(): string }>(
  decode: (band: ScanBand) => T | null,
  band: ScanBand,
  isBook: (code: string) => boolean,
): T | null {
  const whole = decode(band);
  if (!whole) return null;
  if (isBook(whole.getText())) return whole;
  if (band.height < MIN_SPLIT_HEIGHT) return null;
  const partHeight = Math.round(band.height * 0.6);
  const parts: ScanBand[] = [
    { top: band.top, height: partHeight },
    { top: band.top + band.height - partHeight, height: partHeight },
  ];
  for (const part of parts) {
    const r = decode(part);
    if (r && isBook(r.getText())) return r;
  }
  return null;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * object-fit: cover で表示している映像について、画面上のガイド枠（上下に余白を足したもの）が
 * 映像フレームのどの行に当たるかを求める。求められない場合は null（呼び出し側でフレーム全体を読む）。
 * @param margin ガイド枠の高さに対する上下それぞれの余白の比率
 */
export function computeScanBand(params: {
  frameWidth: number;
  frameHeight: number;
  viewport: RectLike;
  guide: RectLike;
  margin?: number;
}): ScanBand | null {
  const { frameWidth: fw, frameHeight: fh, viewport: vp, guide } = params;
  const margin = params.margin ?? 0.5;
  if (!(fw > 0 && fh > 0 && vp.width > 0 && vp.height > 0 && guide.height > 0)) return null;
  // 表示上の 1 フレーム画素あたりの CSS px
  const scale = Math.max(vp.width / fw, vp.height / fh);
  // 映像の上端の表示位置（cover ではみ出す分は負になる）
  const offsetY = (vp.height - fh * scale) / 2;
  const guideTop = guide.top - vp.top;
  const extra = guide.height * margin;
  const top = Math.max(0, Math.floor((guideTop - extra - offsetY) / scale));
  const bottom = Math.min(fh, Math.ceil((guideTop + guide.height + extra - offsetY) / scale));
  const height = bottom - top;
  if (!Number.isFinite(top) || !Number.isFinite(height) || height < MIN_SPLIT_HEIGHT) return null;
  return { top, height };
}

/**
 * RGBA（canvas の ImageData.data）を輝度（0〜255）に変換する。ZXing の HTMLCanvasElementLuminanceSource と同じ係数。
 */
export function rgbaToLuminance(rgba: Uint8ClampedArray, out?: Uint8ClampedArray): Uint8ClampedArray {
  const size = rgba.length >> 2;
  const lum = out && out.length >= size ? out : new Uint8ClampedArray(size);
  for (let i = 0, j = 0; i < size; i++, j += 4) {
    lum[i] = (306 * rgba[j] + 601 * rgba[j + 1] + 117 * rgba[j + 2] + 0x200) >> 10;
  }
  return lum;
}

/** カメラを使えない理由（使えるなら 'ok'） */
export type CameraSupport = 'ok' | 'insecure' | 'unsupported';

export function getCameraSupport(env: { isSecureContext: boolean; hasGetUserMedia: boolean }): CameraSupport {
  // getUserMedia は https（または localhost）でしか使えない
  if (!env.isSecureContext) return 'insecure';
  if (!env.hasGetUserMedia) return 'unsupported';
  return 'ok';
}

/** カメラ起動失敗の分類 */
export type CameraErrorKind = 'denied' | 'no-camera' | 'in-use' | 'unsupported' | 'error';

export function classifyCameraError(err: unknown): CameraErrorKind {
  const name =
    typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string' ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'no-camera';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'in-use';
    case 'NotSupportedError':
      return 'unsupported';
    default:
      return 'error';
  }
}

/** MediaStreamTrack の capabilities に torch（ライト）があるか */
export function capabilitiesHaveTorch(caps: unknown): boolean {
  if (typeof caps !== 'object' || caps === null || !('torch' in caps)) return false;
  const torch: unknown = caps.torch;
  // Chrome は boolean、仕様上は boolean の配列
  if (Array.isArray(torch)) return torch.includes(true);
  return torch === true;
}
