/*
 * 本の表紙。coverUrl が無い・読み込みに失敗した場合はタイトルの頭文字入りのプレースホルダを出す。
 * 画像は loading="lazy"。http の URL は https に直して読み込む。
 * 使い方:
 *   <BookCover title={loan.book.title} coverUrl={loan.book.coverUrl} size="sm" />
 *   <BookCover title={book.title} coverUrl={book.coverUrl} size="lg" alt={`${book.title}の表紙`} />
 * サイズ: sm 44×64（一覧）、md 64×92（カード）、lg 112×160（詳細）
 */
import { useState } from 'react';
import styles from './BookCover.module.css';

export type BookCoverSize = 'sm' | 'md' | 'lg';

export type BookCoverProps = {
  title: string;
  coverUrl: string | null | undefined;
  size?: BookCoverSize;
  /** 代替テキスト。既定は空（横にタイトルがある前提の装飾画像） */
  alt?: string;
  className?: string;
};

/** プレースホルダの背景色（落ち着いた色から、タイトルで決める） */
const PLACEHOLDER_COLORS = ['#5b8a72', '#7a6a9b', '#b0745a', '#4f7a99', '#9a7b3f', '#8a5a6e', '#5f7f5a', '#6d6f9a'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** タイトルの頭文字（括弧や記号を飛ばす） */
export function coverInitial(title: string): string {
  const chars = Array.from(title.trim().replace(/^[\s「『（(【［[〈《"'“‘・]+/u, ''));
  return chars[0] ?? '本';
}

function secureUrl(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

export function BookCover({ title, coverUrl, size = 'md', alt = '', className }: BookCoverProps) {
  const url = coverUrl ? secureUrl(coverUrl) : null;
  // 失敗した URL を覚えておく（URL が変われば再挑戦する）
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;

  const cls = [styles.cover, styles[size], className ?? ''].filter(Boolean).join(' ');

  if (!showImage) {
    const color = PLACEHOLDER_COLORS[hashString(title) % PLACEHOLDER_COLORS.length];
    return (
      <div
        className={`${cls} ${styles.placeholder}`}
        style={{ backgroundColor: color }}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
      >
        <span className={styles.initial}>{coverInitial(title)}</span>
      </div>
    );
  }

  return (
    <div className={cls}>
      <img
        className={styles.image}
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        onLoad={(e) => {
          // 「画像なし」を 1×1 などの小さな画像で返すサービスがあるので、それも失敗扱い
          const img = e.currentTarget;
          if (img.naturalWidth <= 2 || img.naturalHeight <= 2) setFailedUrl(url);
        }}
      />
    </div>
  );
}
