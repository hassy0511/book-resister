import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './ErrorBoundary';

describe('isChunkLoadError', () => {
  it('画面ファイルの読み込み失敗を見分ける', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true);
    // Safari
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    // Firefox
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  });

  it('それ以外のエラーは false', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
