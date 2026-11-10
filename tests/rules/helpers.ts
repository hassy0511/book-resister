/**
 * Firestore セキュリティルールのテスト用ヘルパ。
 * エミュレータは `npm run test:rules`（firebase emulators:exec）で起動される。
 * 起動済みのエミュレータ（npm run emulators）に対して `npx vitest run --config vitest.rules.config.ts` でも実行できる。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, doc, serverTimestamp, setDoc, type DocumentData, type Firestore } from 'firebase/firestore';

export const PROJECT_ID = 'demo-book-resister';

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

/** テスト環境を作る（ルールはリポジトリの firestore.rules を読み込む） */
export function setupEnv(): Promise<RulesTestEnvironment> {
  const fromEnv = process.env.FIRESTORE_EMULATOR_HOST;
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      // emulators:exec 経由なら環境変数から自動で見つかる。直接実行したときは既定のポートを使う
      ...(fromEnv ? {} : { host: '127.0.0.1', port: 8080 }),
    },
  });
}

/** RulesTestContext は compat 版の Firestore を返すが、モジュール版の関数にそのまま渡せる */
export function dbOf(ctx: RulesTestContext): Firestore {
  return ctx.firestore() as unknown as Firestore;
}

/** ルールを無視してドキュメントを用意する（パス → データ） */
export async function seed(env: RulesTestEnvironment, docs: Record<string, DocumentData>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = dbOf(ctx);
    for (const [path, data] of Object.entries(docs)) {
      await setDoc(doc(db, path), data);
    }
  });
}

/** 過去の固定時刻（シード用の createdAt など） */
export const PAST = Timestamp.fromDate(new Date('2026-10-01T00:00:00Z'));

/** 今から days 日後の Timestamp（負なら過去） */
export function daysFromNow(days: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const VALID_INVITE_CODE = 'Abcdefghij0123456789xy';
export const EXPIRED_INVITE_CODE = 'Expired0123456789abcdef';
export const OTHER_GROUP_INVITE_CODE = 'OtherGroup0123456789ab';

/**
 * 基本の状態:
 *   - g1（山田家）: alice が作成、bob が招待で参加
 *   - g2（佐藤家）: carol が作成
 *   - dave: ログイン済みだがグループ未参加（users も未作成）
 *   - 招待: g1 の有効な招待、g1 の期限切れ招待、g2 の有効な招待
 */
export async function seedFamilies(env: RulesTestEnvironment): Promise<void> {
  await seed(env, {
    'groups/g1': { name: '山田家', createdBy: 'alice', createdAt: PAST },
    'groups/g1/members/alice': { displayName: 'ママ', joinedAt: PAST, inviteCode: null },
    'groups/g1/members/bob': { displayName: 'パパ', joinedAt: PAST, inviteCode: VALID_INVITE_CODE },
    'users/alice': { displayName: 'ママ', groupId: 'g1', createdAt: PAST, updatedAt: PAST },
    'users/bob': { displayName: 'パパ', groupId: 'g1', createdAt: PAST, updatedAt: PAST },
    'groups/g2': { name: '佐藤家', createdBy: 'carol', createdAt: PAST },
    'groups/g2/members/carol': { displayName: 'かおる', joinedAt: PAST, inviteCode: null },
    'users/carol': { displayName: 'かおる', groupId: 'g2', createdAt: PAST, updatedAt: PAST },
    [`invites/${VALID_INVITE_CODE}`]: {
      groupId: 'g1',
      groupName: '山田家',
      createdBy: 'alice',
      createdAt: PAST,
      expiresAt: daysFromNow(3),
    },
    [`invites/${EXPIRED_INVITE_CODE}`]: {
      groupId: 'g1',
      groupName: '山田家',
      createdBy: 'alice',
      createdAt: PAST,
      expiresAt: daysFromNow(-1),
    },
    [`invites/${OTHER_GROUP_INVITE_CODE}`]: {
      groupId: 'g2',
      groupName: '佐藤家',
      createdBy: 'carol',
      createdAt: PAST,
      expiresAt: daysFromNow(3),
    },
  });
}

// ---------------------------------------------------------------------------
// 正しい形のデータ（クライアントが書き込む形と同じ）
// ---------------------------------------------------------------------------

export function newLocation(overrides: DocumentData = {}): DocumentData {
  return {
    name: '中央図書館',
    defaultLoanDays: 14,
    memo: '',
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

export const ISBN = '9784834000825';

export function newBook(overrides: DocumentData = {}): DocumentData {
  return {
    isbn: ISBN,
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ', 'おおむらゆりこ'],
    publisher: '福音館書店',
    coverUrl: 'https://cover.openbd.jp/9784834000825.jpg',
    seriesId: null,
    volume: null,
    source: 'openbd',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

export function newSeries(overrides: DocumentData = {}): DocumentData {
  return {
    name: 'おしりたんてい',
    totalVolumes: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

export function loanBookSnapshot(overrides: DocumentData = {}): DocumentData {
  return {
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ'],
    coverUrl: null,
    isbn: ISBN,
    ...overrides,
  };
}

export function newLoan(createdBy: string, overrides: DocumentData = {}): DocumentData {
  return {
    bookId: `isbn-${ISBN}`,
    book: loanBookSnapshot(),
    locationId: 'loc1',
    borrowerUid: createdBy,
    borrowedOn: '2026-11-08',
    dueOn: '2026-11-22',
    returnedOn: null,
    readStatus: null,
    rating: null,
    review: null,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** シード用（serverTimestamp の代わりに固定時刻を入れる） */
export function seeded(data: DocumentData): DocumentData {
  return { ...data, createdAt: PAST, ...('updatedAt' in data ? { updatedAt: PAST } : {}) };
}

export function newPushSubscription(uid: string, overrides: DocumentData = {}): DocumentData {
  return {
    uid,
    endpoint: 'https://web.push.apple.com/QGxhYmVsLWZvci10ZXN0',
    // 実際の形式（p256dh は 65 バイト、auth は 16 バイトの base64url）。ルールで形式を確かめている
    keys: {
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      auth: '5_uHGMO9sKvEahQK3OF5Bw',
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}
