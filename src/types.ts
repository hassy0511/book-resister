/**
 * アプリ全体で共有するデータ型（Firestore のドキュメント構造と 1 対 1 に対応）。
 * 変更する場合は docs/design.md と firestore.rules も合わせて更新すること。
 *
 * 日付の扱い:
 *   - 「日付」（借りた日・返却日など）は端末のローカル日付（日本時間）を 'YYYY-MM-DD' 文字列で持つ。
 *   - 「日時」（作成・更新時刻）は Firestore の Timestamp（serverTimestamp）で持つ。
 */
import type { Timestamp } from 'firebase/firestore';

/** 'YYYY-MM-DD' 形式のローカル日付 */
export type DateString = string;

/** users/{uid} — 本人だけが読み書きする */
export interface UserProfile {
  displayName: string;
  groupId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** groups/{groupId} */
export interface Group {
  name: string;
  createdBy: string;
  createdAt: Timestamp;
  /**
   * これより前に作られた招待では参加できない（「これまでの招待リンクをすべて無効にする」・メンバーを外したときの時刻。F-07）。
   * 一度も無効にしていなければ無い
   */
  invitesValidAfter?: Timestamp;
}

/** groups/{groupId}/members/{uid} */
export interface Member {
  displayName: string;
  joinedAt: Timestamp;
  /** 招待リンクで参加した場合の招待コード（グループ作成者は null） */
  inviteCode: string | null;
}

/** invites/{code} — code は推測されにくいランダム文字列（URL に載せる） */
export interface Invite {
  groupId: string;
  /** 参加前の人に表示するためのグループ名（作成時点の名前） */
  groupName: string;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

/** groups/{groupId}/locations/{locationId} */
export interface Location {
  name: string;
  /** 既定の貸出期間（日数, 1〜365） */
  defaultLoanDays: number;
  memo: string;
  /** 非表示（履歴がある場所は削除せずにこれを true にする） */
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type BookSource = 'openbd' | 'ndl' | 'google' | 'manual';

/**
 * groups/{groupId}/books/{bookId}
 * bookId は ISBN がある本は `isbn-<ISBN13>`、ない本は自動 ID。
 */
export interface Book {
  isbn: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  coverUrl: string | null;
  seriesId: string | null;
  /** 巻数（不明なら null）。小数は使わない */
  volume: number | null;
  source: BookSource;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** groups/{groupId}/series/{seriesId} */
export interface Series {
  name: string;
  /** 全巻数（任意） */
  totalVolumes: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 返却時に選ぶ読書状況。既定は 'read' */
export type ReadStatus = 'read' | 'partial' | 'unread';

/** 貸出記録に複製して持つ本の情報（一覧表示を本ドキュメントの読み込みなしで行うため） */
export interface LoanBookSnapshot {
  title: string;
  authors: string[];
  coverUrl: string | null;
  isbn: string | null;
}

/** groups/{groupId}/loans/{loanId} */
export interface Loan {
  bookId: string;
  book: LoanBookSnapshot;
  locationId: string;
  borrowerUid: string;
  borrowedOn: DateString;
  dueOn: DateString;
  /** 返却した日。貸出中は null */
  returnedOn: DateString | null;
  /** 返却時に設定。貸出中は null */
  readStatus: ReadStatus | null;
  /** 評価 1〜5（任意） */
  rating: number | null;
  /** 感想（任意） */
  review: string | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** groups/{groupId}/pushSubscriptions/{subscriptionId}（ID は endpoint の SHA-256 16 進） */
export interface PushSubscriptionDoc {
  uid: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
  createdAt: Timestamp;
}

/** ドキュメント ID 付きの型 */
export type WithId<T> = T & { id: string };

/** 書誌情報 API の検索結果（まだ Firestore に保存していない本） */
export interface BookCandidate {
  isbn: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  coverUrl: string | null;
  /** API から取得できた、またはタイトルから推定したシリーズ名 */
  seriesName: string | null;
  volume: number | null;
  source: BookSource;
}
