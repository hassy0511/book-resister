/*
 * LINE などのアプリ内ブラウザ（埋め込みの WebView）の判定（純粋関数）。
 * アプリ内ブラウザでは Google のログインが「403 disallowed_useragent」で拒否され、
 * Safari ともホーム画面のアプリとも保存場所が別で、「ホーム画面に追加」もできない。
 * 普通の Safari を誤って判定しないよう、UA に必ず入る目印だけで狭く判定する。
 */

export type InAppBrowserName = 'LINE' | 'Facebook' | 'Instagram';

const RULES: { name: InAppBrowserName; pattern: RegExp }[] = [
  { name: 'LINE', pattern: /\bLine\/\d/ },
  { name: 'Facebook', pattern: /\bFBAN\/|\bFBAV\// },
  { name: 'Instagram', pattern: /\bInstagram\s\d/ },
];

function currentUserAgent(): string {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  } catch {
    return '';
  }
}

/** アプリ内ブラウザならアプリ名、それ以外は null */
export function detectInAppBrowser(userAgent: string = currentUserAgent()): InAppBrowserName | null {
  for (const rule of RULES) if (rule.pattern.test(userAgent)) return rule.name;
  return null;
}
