#!/usr/bin/env node
// アプリのアイコン（開いた本＋しおり）を SVG で作り、Playwright（Chromium）で各サイズの PNG に書き出す。
// 使い方: node scripts/generate-icons.mjs
// 出力: public/icons/ の favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png, icon-512-maskable.png
// Playwright は devDependencies に入れていないため、グローバル等にインストール済みの環境で実行する。
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const COLOR = {
  green: '#2f6f5e', // メインカラー（背景）
  cream: '#f7f5f0', // ページ
  pageEdge: '#d9cfb8', // ページの厚み
  ribbon: '#e8a33d', // しおり
};

// 512x512 の座標で描いた、開いた本としおり。中心 (256, 256) から半径 190 程度に収まる
function bookArt() {
  const leftPage = 'M256 178 C214 150 156 144 112 156 L112 352 C156 340 214 346 256 374 Z';
  const rightPage = 'M256 178 C298 150 356 144 400 156 L400 352 C356 340 298 346 256 374 Z';
  const leftLines = [0, 32, 64, 96]
    .map((dy, i) => {
      const x1 = i === 3 ? 168 : 142;
      return `M${x1} ${214 + dy} C170 ${206 + dy} 205 ${208 + dy} 232 ${220 + dy}`;
    })
    .join(' ');
  const rightLines = [0, 32, 64]
    .map((dy) => `M280 ${220 + dy} C307 ${208 + dy} 342 ${206 + dy} 370 ${214 + dy}`)
    .join(' ');
  return `
    <g transform="translate(0 -18)">
      <path d="M300 320 H332 V428 L316 414 L300 428 Z" fill="${COLOR.ribbon}"/>
      <g transform="translate(0 14)" fill="${COLOR.pageEdge}">
        <path d="${leftPage}"/>
        <path d="${rightPage}"/>
      </g>
      <path d="${leftPage}" fill="${COLOR.cream}"/>
      <path d="${rightPage}" fill="${COLOR.cream}"/>
      <path d="M256 180 V372" stroke="${COLOR.green}" stroke-opacity="0.35" stroke-width="6" stroke-linecap="round"/>
      <path d="${leftLines} ${rightLines}" fill="none" stroke="${COLOR.green}" stroke-opacity="0.3"
        stroke-width="10" stroke-linecap="round"/>
    </g>`;
}

/**
 * @param {{ scale: number; rounded: boolean }} opts
 *   scale: 本の拡大率（maskable は安全領域＝中央 80% に収めるため 1）
 *   rounded: 角丸の背景（透明な角）。iOS のホーム画面用は角丸なし（iOS 側で丸められる）
 */
function iconSvg({ scale, rounded }) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="112" fill="${COLOR.green}"/>`
    : `<rect width="512" height="512" fill="${COLOR.green}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${bookArt()}</g></svg>`;
}

const ANY = { scale: 1.18, rounded: true };

const PNG_TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, svg: iconSvg({ scale: 1.18, rounded: false }) },
  { file: 'icon-192.png', size: 192, svg: iconSvg(ANY) },
  { file: 'icon-512.png', size: 512, svg: iconSvg(ANY) },
  { file: 'icon-512-maskable.png', size: 512, svg: iconSvg({ scale: 1, rounded: false }) },
];

function compact(svg) {
  return svg.replace(/\s*\n\s*/g, ' ').replace(/>\s+</g, '><').trim();
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'favicon.svg'), compact(iconSvg(ANY)) + '\n');
console.log('favicon.svg');

const { chromium } = require('playwright');
const browser = await chromium.launch();
try {
  for (const t of PNG_TARGETS) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}` +
        `svg{display:block;width:${t.size}px;height:${t.size}px}</style></head><body>${compact(t.svg)}</body></html>`,
    );
    await page.screenshot({
      path: join(OUT_DIR, t.file),
      omitBackground: true,
      clip: { x: 0, y: 0, width: t.size, height: t.size },
    });
    await page.close();
    console.log(`${t.file} (${t.size}x${t.size})`);
  }
} finally {
  await browser.close();
}
