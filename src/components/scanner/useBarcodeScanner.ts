/*
 * カメラの起動・停止とバーコード読み取りを管理するフック（BarcodeScanner の内部用）。
 *   const scanner = useBarcodeScanner({ active, onDetect, videoRef, getScanBand });
 *   scanner.status          … 'scanning' など（ScannerStatus）
 *   scanner.torch           … { supported, on, toggle }（ライト）
 *   scanner.feedback        … 直近の検出（視覚フィードバック用）
 *   scanner.restart()       … エラー後の再試行
 *
 * - active=false・アンマウント・ページ非表示（visibilitychange / pagehide）でストリームの track.stop() を呼んで止める。
 *   表示に戻れば自動で再開する。
 * - onDetect には書籍 EAN-13（isBookEan）だけを渡し、同じコードは 2.5 秒間抑制する（createDetectionGate）。
 * - ZXing（@zxing/browser）は動的 import する（画面表示を先に行い、カメラ起動と並行して読み込む）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { isBookEan } from '../../lib/isbn';
import type { ScanBandProvider } from './bookBarcodeReader';
import {
  capabilitiesHaveTorch,
  classifyCameraError,
  createDetectionGate,
  getCameraSupport,
  type CameraSupport,
  type DetectionGate,
} from './scannerLogic';

export type ScannerStatus =
  /** 停止中（active=false またはページ非表示） */
  | 'idle'
  | 'starting'
  | 'scanning'
  /** カメラの許可が拒否された */
  | 'denied'
  /** カメラが無い */
  | 'no-camera'
  /** ほかのアプリが使用中などで起動できない */
  | 'in-use'
  /** ブラウザが非対応 */
  | 'unsupported'
  /** https でない */
  | 'insecure'
  /** 使用中にカメラが止まった（ほかのアプリに取られた等） */
  | 'interrupted'
  | 'error';

/** iOS Safari / ホーム画面 PWA で背面カメラを使う設定 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

/** 検出時の枠の点灯時間・読み取り結果の表示時間（ミリ秒） */
const FLASH_MS = 700;
const LABEL_MS = 2000;

export interface ScannerFeedback {
  /** 直近に読み取った ISBN-13 */
  code: string;
  /** 検出のたびに増える（アニメーションの再生用 key） */
  count: number;
  /** 枠を光らせている間 true */
  flashing: boolean;
}

export interface UseBarcodeScannerOptions {
  active: boolean;
  onDetect: (isbn13: string) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 読み取る行範囲（ガイド枠付近）。省略時はフレーム全体 */
  getScanBand?: ScanBandProvider;
}

export interface UseBarcodeScannerResult {
  status: ScannerStatus;
  torch: { supported: boolean; on: boolean; toggle: () => void };
  feedback: ScannerFeedback | null;
  restart: () => void;
}

// ---- ページの表示状態 ----

let pageHidden = false;

function subscribeVisibility(onChange: () => void): () => void {
  const onPageHide = () => {
    pageHidden = true;
    onChange();
  };
  const onPageShow = () => {
    pageHidden = false;
    onChange();
  };
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}

function getPageVisible(): boolean {
  return !pageHidden && document.visibilityState !== 'hidden';
}

/** ページが表示されているか（ホーム画面に戻った・別アプリに切り替えたら false） */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, getPageVisible, () => true);
}

// ---- カメラ ----

function detectSupport(): CameraSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  return getCameraSupport({
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
  });
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** ZXing の controls.stop()（ライト対応端末では Promise を返し、停止済みトラックへの消灯で reject しうる） */
function stopControls(controls: IScannerControls): void {
  try {
    const r: unknown = controls.stop();
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    // 停止時の失敗は無視
  }
}

function trackHasTorch(track: MediaStreamTrack): boolean {
  try {
    return typeof track.getCapabilities === 'function' && capabilitiesHaveTorch(track.getCapabilities());
  } catch {
    return false;
  }
}

async function setTrackTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
  // lib.dom の型に torch が無いので拡張する
  const set: MediaTrackConstraintSet & { torch: boolean } = { torch: on };
  await track.applyConstraints({ advanced: [set] });
}

const TORCH_OFF = { supported: false, on: false };

export function useBarcodeScanner({
  active,
  onDetect,
  videoRef,
  getScanBand,
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const visible = usePageVisible();
  const shouldRun = active && visible;
  const [support] = useState(detectSupport);
  // セッション（1 回のカメラ起動）の状態。停止のたびに 'starting' に戻す
  const [sessionStatus, setSessionStatus] = useState<ScannerStatus>('starting');
  const [restartKey, setRestartKey] = useState(0);
  const [torchState, setTorchState] = useState(TORCH_OFF);
  const [feedback, setFeedback] = useState<ScannerFeedback | null>(null);

  // 毎回の描画で変わりうるコールバックは ref で持つ（変わってもカメラを再起動しない）
  const onDetectRef = useRef(onDetect);
  const scanBandRef = useRef(getScanBand);
  useEffect(() => {
    onDetectRef.current = onDetect;
    scanBandRef.current = getScanBand;
  });

  const gateRef = useRef<DetectionGate | null>(null);
  if (gateRef.current === null) gateRef.current = createDetectionGate({ isBook: isBookEan });

  const trackRef = useRef<MediaStreamTrack | null>(null);
  const timersRef = useRef<{ flash?: ReturnType<typeof setTimeout>; label?: ReturnType<typeof setTimeout> }>({});

  // 検出時の視覚フィードバック（iOS は navigator.vibrate が無いので枠を光らせる）
  const showFeedback = useCallback((code: string) => {
    const timers = timersRef.current;
    clearTimeout(timers.flash);
    clearTimeout(timers.label);
    setFeedback((prev) => ({ code, count: (prev?.count ?? 0) + 1, flashing: true }));
    timers.flash = setTimeout(() => setFeedback((prev) => (prev ? { ...prev, flashing: false } : prev)), FLASH_MS);
    timers.label = setTimeout(() => setFeedback(null), LABEL_MS);
    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(40);
      } catch {
        // 振動できなくても問題ない
      }
    }
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      clearTimeout(timers.flash);
      clearTimeout(timers.label);
    };
  }, []);

  useEffect(() => {
    if (!shouldRun || support !== 'ok') return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    let track: MediaStreamTrack | null = null;

    const release = () => {
      if (track) {
        track.removeEventListener('ended', onEnded);
        track = null;
      }
      trackRef.current = null;
      if (controls) {
        stopControls(controls);
        controls = null;
      }
      if (stream) {
        stopStream(stream);
        if (video.srcObject === stream) video.srcObject = null;
        stream = null;
      }
    };

    // OS やほかのアプリにカメラを取られたとき
    function onEnded() {
      if (cancelled) return;
      release();
      setTorchState(TORCH_OFF);
      setSessionStatus('interrupted');
    }

    setSessionStatus('starting');
    // カメラの許可待ちと並行して ZXing を読み込む
    const readerModule = import('./bookBarcodeReader');
    readerModule.catch(() => undefined);

    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (cancelled) {
          stopStream(s);
          return;
        }
        stream = s;
        const { BookBarcodeReader } = await readerModule;
        if (cancelled) return;
        const reader = new BookBarcodeReader({
          isBook: isBookEan,
          getScanBand: (w, h) => scanBandRef.current?.(w, h) ?? null,
        });
        const gate = gateRef.current;
        const c = await reader.decodeFromStream(s, video, (result) => {
          if (!result || cancelled || !gate) return;
          const code = result.getText();
          if (!gate.accept(code, Date.now())) return;
          showFeedback(code);
          onDetectRef.current(code);
        });
        if (cancelled) {
          stopControls(c);
          return;
        }
        controls = c;
        const t = s.getVideoTracks()[0] ?? null;
        if (t) {
          if (t.readyState === 'ended') {
            onEnded();
            return;
          }
          track = t;
          t.addEventListener('ended', onEnded);
          trackRef.current = t;
        }
        setTorchState({ supported: t ? trackHasTorch(t) : false, on: false });
        setSessionStatus('scanning');
      } catch (e) {
        if (cancelled) return;
        release();
        // getUserMedia が成功した後の失敗（映像を再生できない等）は分類できないので 'error'
        setSessionStatus(classifyCameraError(e));
      }
    })();

    return () => {
      cancelled = true;
      release();
      setTorchState(TORCH_OFF);
      // 次に起動するときは「起動中」から表示する
      setSessionStatus('starting');
    };
  }, [shouldRun, support, restartKey, videoRef, showFeedback]);

  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.readyState !== 'live') return;
    const next = !torchState.on;
    setTrackTorch(track, next).then(
      () => {
        if (trackRef.current === track) setTorchState({ supported: true, on: next });
      },
      () => {
        // 切り替えられない端末ではボタンを消す
        if (trackRef.current === track) setTorchState(TORCH_OFF);
      },
    );
  }, [torchState.on]);

  const restart = useCallback(() => setRestartKey((k) => k + 1), []);

  const status: ScannerStatus = !shouldRun ? 'idle' : support !== 'ok' ? support : sessionStatus;

  return {
    status,
    torch: { supported: status === 'scanning' && torchState.supported, on: torchState.on, toggle: toggleTorch },
    feedback,
    restart,
  };
}
