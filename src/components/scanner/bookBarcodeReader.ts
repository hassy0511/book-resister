/*
 * 書籍の EAN-13 だけを読む ZXing リーダー（useBarcodeScanner から動的 import する）。
 * BrowserMultiFormatReader の decodeFromCanvas を差し替えて、
 *   - 画面のガイド枠付近の行（帯）だけを読む（速く、余計なバーコードを拾いにくい）
 *   - 2 段バーコードで下段（192 の価格コード）が読めたら帯を分けて上段（ISBN）を探す
 *   - 書籍以外のコードは NotFoundException 扱いにして、スキャンを続けさせる
 * 読み取りの流れ（カメラ起動・停止）は BrowserCodeReader.decodeFromStream に任せる。
 *
 * 1 枚ごとの解析は MultiFormatReader を通さず EAN13Reader を同じヒント（EAN_13・TRY_HARDER）で直接呼ぶ。
 * @zxing/library 0.23 の MultiFormatReader は読めなかったフレームごとに console.warn（スタック付き）を出すため。
 */
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  BarcodeFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  EAN13Reader,
  FormatException,
  HybridBinarizer,
  NotFoundException,
  RGBLuminanceSource,
  type LuminanceSource,
  type Result,
} from '@zxing/library';
import { findBookCode, rgbaToLuminance, type ScanBand } from './scannerLogic';

/** フレームの大きさから、読む行範囲を返す。null ならフレーム全体を読む */
export type ScanBandProvider = (frameWidth: number, frameHeight: number) => ScanBand | null;

export interface BookBarcodeReaderOptions {
  isBook: (code: string) => boolean;
  getScanBand?: ScanBandProvider;
  /** 読み取りを試す間隔（ミリ秒） */
  intervalMs?: number;
}

/** 帯で見つからなかったとき、何回に 1 回フレーム全体も読むか（ガイド枠の位置計算がずれていた場合の保険） */
const FULL_FRAME_EVERY = 4;

/** 帯をフレーム内に収める（整数化）。収まらなければ null（全体を読む） */
function clampBand(band: ScanBand | null, frameHeight: number): ScanBand | null {
  if (!band) return null;
  const top = Math.max(0, Math.min(frameHeight - 1, Math.floor(band.top)));
  const height = Math.min(frameHeight - top, Math.ceil(band.height));
  if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return null;
  return { top, height };
}

export class BookBarcodeReader extends BrowserMultiFormatReader {
  private readonly isBook: (code: string) => boolean;
  private readonly getScanBand: ScanBandProvider | undefined;
  private missCount = 0;
  private lumBuffer: Uint8ClampedArray | undefined;
  private warned = false;
  private readonly ean13 = new EAN13Reader();

  constructor(opts: BookBarcodeReaderOptions) {
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    super(hints, {
      delayBetweenScanAttempts: opts.intervalMs ?? 120,
      delayBetweenScanSuccess: 300,
      tryPlayVideoTimeout: 8000,
    });
    this.isBook = opts.isBook;
    this.getScanBand = opts.getScanBand;
  }

  /** scan ループから毎フレーム呼ばれる。書籍 EAN が無ければ NotFoundException を投げる（ループは続く） */
  override decodeFromCanvas(canvas: HTMLCanvasElement): Result {
    let result: Result | null = null;
    try {
      result = this.decodeBookFromCanvas(canvas);
    } catch (e) {
      // 想定外の例外でループが止まる（＝カメラが止まる）のを防ぐ
      if (!this.warned) {
        this.warned = true;
        console.warn('バーコードの読み取り中にエラーが発生しました', e);
      }
    }
    if (!result) throw new NotFoundException();
    return result;
  }

  private decodeBookFromCanvas(canvas: HTMLCanvasElement): Result | null {
    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const band = clampBand(this.getScanBand?.(width, height) ?? null, height);
    const isFull = !band || (band.top === 0 && band.height >= height);
    const first = band && !isFull ? band : { top: 0, height };
    const found = this.decodeRegion(ctx, width, first, true);
    if (found) {
      this.missCount = 0;
      return found;
    }
    if (isFull) return null;
    this.missCount += 1;
    if (this.missCount % FULL_FRAME_EVERY !== 0) return null;
    return this.decodeRegion(ctx, width, { top: 0, height }, false);
  }

  /**
   * フレームの region 行だけを輝度にして書籍 EAN を探す。
   * reuseBuffer=true なら毎フレーム同じ大きさの輝度バッファを使い回す（ときどき読む全体用は使い回さない）。
   */
  private decodeRegion(ctx: CanvasRenderingContext2D, width: number, region: ScanBand, reuseBuffer: boolean): Result | null {
    const image = ctx.getImageData(0, region.top, width, region.height);
    const size = width * region.height;
    let buffer: Uint8ClampedArray | undefined;
    if (reuseBuffer) {
      if (!this.lumBuffer || this.lumBuffer.length !== size) this.lumBuffer = new Uint8ClampedArray(size);
      buffer = this.lumBuffer;
    }
    const lum = rgbaToLuminance(image.data, buffer);
    const source = new RGBLuminanceSource(lum, width, region.height);
    // findBookCode には region 内の座標で渡す
    return findBookCode((b) => this.tryDecode(source, width, region.height, b), { top: 0, height: region.height }, this.isBook);
  }

  private tryDecode(source: LuminanceSource, width: number, height: number, b: ScanBand): Result | null {
    const part = b.top === 0 && b.height === height ? source : source.crop(0, b.top, width, b.height);
    try {
      return this.ean13.decode(new BinaryBitmap(new HybridBinarizer(part)), this.hints);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ChecksumException || e instanceof FormatException) return null;
      throw e;
    }
  }
}
