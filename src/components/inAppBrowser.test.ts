import { describe, expect, it } from 'vitest';
import { detectInAppBrowser } from './inAppBrowser';

const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const LINE_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0';
const LINE_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Line/14.9.1/IAB';
const FACEBOOK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.104;FBBV/123]';
const INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 335.0.0.29.88 (iPhone15,2; iOS 17_5)';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';

describe('detectInAppBrowser', () => {
  it('LINE・Facebook・Instagram のアプリ内ブラウザを判定する', () => {
    expect(detectInAppBrowser(LINE_IOS)).toBe('LINE');
    expect(detectInAppBrowser(LINE_ANDROID)).toBe('LINE');
    expect(detectInAppBrowser(FACEBOOK)).toBe('Facebook');
    expect(detectInAppBrowser(INSTAGRAM)).toBe('Instagram');
  });

  it('普通の Safari・Chrome・ホーム画面のアプリは判定しない', () => {
    expect(detectInAppBrowser(SAFARI)).toBeNull();
    expect(detectInAppBrowser(CHROME_IOS)).toBeNull();
    expect(detectInAppBrowser('Mozilla/5.0 (Macintosh) Inline/1.0 Pipeline/2')).toBeNull();
    expect(detectInAppBrowser('')).toBeNull();
  });
});
