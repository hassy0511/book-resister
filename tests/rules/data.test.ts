import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import {
  ISBN,
  PAST,
  dbOf,
  loanBookSnapshot,
  newBook,
  newLoan,
  newLocation,
  newSeries,
  seed,
  seedFamilies,
  seeded,
  setupEnv,
} from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

const BOOK_ID = `isbn-${ISBN}`;

beforeEach(async () => {
  await env.clearFirestore();
  await seedFamilies(env);
  await seed(env, {
    'groups/g1/locations/loc1': seeded(newLocation()),
    [`groups/g1/books/${BOOK_ID}`]: seeded(newBook()),
    'groups/g1/series/s1': seeded(newSeries()),
    'groups/g1/loans/loan1': seeded(newLoan('alice')),
    'groups/g1/loans/loan2': seeded(newLoan('bob', { borrowerUid: 'bob', dueOn: '2026-11-10' })),
  });
});

function as(uid: string): Firestore {
  return dbOf(env.authenticatedContext(uid));
}

/** 各コレクションの読み書きに共通の確認 */
describe.each([
  ['locations', 'loc1', newLocation],
  ['books', BOOK_ID, newBook],
  ['series', 's1', newSeries],
  ['loans', 'loan1', (o: DocumentData = {}) => newLoan('bob', o)],
] as const)('%s: メンバーだけが読み書きできる', (col, existingId, factory) => {
  it('メンバーは読める（get と list）', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'groups/g1', col, existingId)));
    await assertSucceeds(getDocs(collection(as('bob'), 'groups/g1', col)));
  });

  it('非メンバー・未ログインは読めない', async () => {
    await assertFails(getDoc(doc(as('carol'), 'groups/g1', col, existingId)));
    await assertFails(getDocs(collection(as('carol'), 'groups/g1', col)));
    await assertFails(getDoc(doc(as('dave'), 'groups/g1', col, existingId)));
    await assertFails(getDoc(doc(dbOf(env.unauthenticatedContext()), 'groups/g1', col, existingId)));
  });

  it('非メンバーは作成・更新・削除できない', async () => {
    const carol = as('carol');
    const newId = col === 'books' ? 'manual-1' : 'new1';
    const data = col === 'books' ? newBook({ isbn: null, source: 'manual' }) : factory();
    if (col === 'loans') Object.assign(data, { createdBy: 'carol', borrowerUid: 'carol' });
    await assertFails(setDoc(doc(carol, 'groups/g1', col, newId), data));
    await assertFails(updateDoc(doc(carol, 'groups/g1', col, existingId), { updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(carol, 'groups/g1', col, existingId)));
  });

  it('メンバーは削除できる', async () => {
    await assertSucceeds(deleteDoc(doc(as('bob'), 'groups/g1', col, existingId)));
  });

  it('createdAt はサーバー時刻でないと作れず、更新で変えられない', async () => {
    const newId = col === 'books' ? 'manual-1' : 'new1';
    const base = col === 'books' ? newBook({ isbn: null, source: 'manual' }) : factory();
    await assertFails(setDoc(doc(as('bob'), 'groups/g1', col, newId), { ...base, createdAt: PAST }));
    await assertFails(setDoc(doc(as('bob'), 'groups/g1', col, newId), { ...base, updatedAt: PAST }));
    await assertFails(
      updateDoc(doc(as('bob'), 'groups/g1', col, existingId), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    // updatedAt を付けない更新も不可
    const ref = doc(as('bob'), 'groups/g1', col, existingId);
    const patch: Record<typeof col, DocumentData> = {
      locations: { name: '新しい名前' },
      books: { title: '新しいタイトル' },
      series: { name: '新しい名前' },
      loans: { dueOn: '2026-12-01' },
    };
    await assertFails(updateDoc(ref, patch[col]));
    await assertSucceeds(updateDoc(ref, { ...patch[col], updatedAt: serverTimestamp() }));
  });

  it('余計なフィールドは付けられない', async () => {
    const newId = col === 'books' ? 'manual-1' : 'new1';
    const base = col === 'books' ? newBook({ isbn: null, source: 'manual' }) : factory();
    await assertFails(setDoc(doc(as('bob'), 'groups/g1', col, newId), { ...base, extra: 'x' }));
    await assertFails(
      updateDoc(doc(as('bob'), 'groups/g1', col, existingId), { extra: 'x', updatedAt: serverTimestamp() }),
    );
  });

  it('必須フィールドが欠けていると作れない', async () => {
    const newId = col === 'books' ? 'manual-1' : 'new1';
    const base = col === 'books' ? newBook({ isbn: null, source: 'manual' }) : factory();
    const [firstKey] = Object.keys(base);
    const missing = { ...base };
    delete missing[firstKey];
    await assertFails(setDoc(doc(as('bob'), 'groups/g1', col, newId), missing));
  });
});

describe('locations', () => {
  const ref = (db: Firestore, id = 'new1') => doc(db, 'groups/g1/locations', id);

  it('正しい場所を登録できる', async () => {
    await assertSucceeds(setDoc(ref(as('bob')), newLocation({ memo: '駅前。水曜休館' })));
  });

  it('既定の貸出期間は 1〜365 の整数', async () => {
    for (const defaultLoanDays of [0, 366, -1, 1.5, '14', null]) {
      await assertFails(setDoc(ref(as('bob')), newLocation({ defaultLoanDays })));
    }
    await assertSucceeds(setDoc(ref(as('bob'), 'a'), newLocation({ defaultLoanDays: 1 })));
    await assertSucceeds(setDoc(ref(as('bob'), 'b'), newLocation({ defaultLoanDays: 365 })));
  });

  it('名前は 1〜100 文字、メモは 1000 文字まで、archived は真偽値', async () => {
    await assertFails(setDoc(ref(as('bob')), newLocation({ name: '' })));
    await assertFails(setDoc(ref(as('bob')), newLocation({ name: ' ' })));
    await assertFails(setDoc(ref(as('bob')), newLocation({ name: 'あ'.repeat(101) })));
    await assertFails(setDoc(ref(as('bob')), newLocation({ memo: 'あ'.repeat(1001) })));
    await assertFails(setDoc(ref(as('bob')), newLocation({ memo: null })));
    await assertFails(setDoc(ref(as('bob')), newLocation({ archived: 'true' })));
  });

  it('名前・期間・メモ・非表示を更新できる', async () => {
    await assertSucceeds(
      updateDoc(ref(as('bob'), 'loc1'), {
        name: '中央図書館（本館）',
        defaultLoanDays: 21,
        memo: 'メモ',
        archived: true,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(ref(as('bob'), 'loc1'), { defaultLoanDays: 400, updatedAt: serverTimestamp() }));
  });
});

describe('books', () => {
  it('ISBN のある本は isbn-<ISBN13> の ID で登録できる', async () => {
    const isbn = '9784591124420';
    await assertSucceeds(setDoc(doc(as('bob'), 'groups/g1/books', `isbn-${isbn}`), newBook({ isbn })));
  });

  it('ID と ISBN が一致しないと登録できない', async () => {
    await assertFails(setDoc(doc(as('bob'), 'groups/g1/books/randomId'), newBook({ isbn: '9784591124420' })));
    await assertFails(
      setDoc(doc(as('bob'), 'groups/g1/books/isbn-9784591124420'), newBook({ isbn: '9784834000825' })),
    );
  });

  it('ISBN が無い本は自動 ID で登録できる', async () => {
    await assertSucceeds(
      setDoc(
        doc(as('bob'), 'groups/g1/books/autoId123'),
        newBook({ isbn: null, authors: [], publisher: null, coverUrl: null, source: 'manual' }),
      ),
    );
  });

  it('ISBN は 978/979 で始まる 13 桁', async () => {
    for (const isbn of ['4834000826', '1920193008001', '978483400082X', 9784834000825]) {
      await assertFails(setDoc(doc(as('bob'), 'groups/g1/books', `isbn-${isbn}`), newBook({ isbn })));
    }
  });

  it('タイトルは 1〜300 文字', async () => {
    const make = (title: unknown) => setDoc(doc(as('bob'), 'groups/g1/books/m1'), newBook({ isbn: null, title }));
    await assertFails(make(''));
    await assertFails(make('   '));
    await assertFails(make('あ'.repeat(301)));
    await assertFails(make(null));
    await assertSucceeds(make('あ'.repeat(300)));
  });

  it('著者は文字列のリスト（50 件まで、空文字なし、1 人 200 文字まで）', async () => {
    let n = 0;
    const make = (authors: unknown) =>
      setDoc(doc(as('bob'), 'groups/g1/books', `m${++n}`), newBook({ isbn: null, authors }));
    await assertFails(make('なかがわりえこ'));
    await assertFails(make(['なかがわりえこ', 1]));
    await assertFails(make(['なかがわりえこ', null]));
    await assertFails(make(['なかがわりえこ', { name: 'x' }]));
    await assertFails(make([...Array.from({ length: 9 }, (_, i) => `著者${i}`), 10]));
    await assertFails(make(['']));
    await assertFails(make(['  ']));
    await assertFails(make(['あ'.repeat(201)]));
    await assertFails(make(Array.from({ length: 51 }, (_, i) => `著者${i}`)));
    await assertFails(make(Array.from({ length: 20 }, () => 'あ'.repeat(150))));
    await assertSucceeds(make(Array.from({ length: 50 }, (_, i) => `著者${i}`)));
    await assertSucceeds(make([]));
  });

  it('出版社・表紙 URL・シリーズ・巻数・取得元の型と範囲', async () => {
    const make = (o: DocumentData) => setDoc(doc(as('bob'), 'groups/g1/books/m1'), newBook({ isbn: null, ...o }));
    await assertFails(make({ publisher: '' }));
    await assertFails(make({ publisher: 'あ'.repeat(201) }));
    await assertFails(make({ coverUrl: 'javascript:alert(1)' }));
    await assertFails(make({ coverUrl: 'ftp://example.com/a.jpg' }));
    await assertFails(make({ seriesId: '' }));
    await assertFails(make({ seriesId: 'a/b' }));
    await assertFails(make({ volume: -1 }));
    await assertFails(make({ volume: 1.5 }));
    await assertFails(make({ volume: '3' }));
    await assertFails(make({ source: 'amazon' }));
    await assertSucceeds(make({ coverUrl: 'http://books.google.com/books/content?id=x', seriesId: 's1', volume: 0 }));
  });

  it('タイトル等の更新と、本と貸出記録の book を 1 バッチで更新できる（updateBook）', async () => {
    const db = as('bob');
    const batch = writeBatch(db);
    batch.update(doc(db, 'groups/g1/books', BOOK_ID), {
      title: 'ぐりとぐら（新版）',
      authors: ['なかがわりえこ'],
      seriesId: 's1',
      volume: 1,
      updatedAt: serverTimestamp(),
    });
    for (const id of ['loan1', 'loan2']) {
      batch.update(doc(db, 'groups/g1/loans', id), {
        'book.title': 'ぐりとぐら（新版）',
        'book.authors': ['なかがわりえこ'],
        updatedAt: serverTimestamp(),
      });
    }
    await assertSucceeds(batch.commit());
  });

  it('ISBN は後から変えられない', async () => {
    await assertFails(
      updateDoc(doc(as('bob'), 'groups/g1/books', BOOK_ID), { isbn: '9784591124420', updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(as('bob'), 'groups/g1/books', BOOK_ID), { isbn: null, updatedAt: serverTimestamp() }));
  });
});

describe('series', () => {
  it('シリーズを登録・全巻数を更新できる', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'groups/g1/series/new1'), newSeries({ totalVolumes: 12 })));
    await assertSucceeds(
      updateDoc(doc(as('bob'), 'groups/g1/series/s1'), { totalVolumes: 20, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(doc(as('bob'), 'groups/g1/series/s1'), { totalVolumes: null, updatedAt: serverTimestamp() }),
    );
  });

  it('名前は 1〜200 文字、全巻数は null か 1〜9999 の整数', async () => {
    const make = (o: DocumentData) => setDoc(doc(as('bob'), 'groups/g1/series/new1'), newSeries(o));
    await assertFails(make({ name: '' }));
    await assertFails(make({ name: 'あ'.repeat(201) }));
    await assertFails(make({ totalVolumes: 0 }));
    await assertFails(make({ totalVolumes: 10000 }));
    await assertFails(make({ totalVolumes: 2.5 }));
    await assertFails(make({ totalVolumes: '10' }));
  });
});

describe('loans', () => {
  const loanRef = (db: Firestore, id: string) => doc(db, 'groups/g1/loans', id);

  it('借りる（作成）ことができる。createdBy は自分', async () => {
    await assertSucceeds(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob')));
    // 借りた人は他のメンバーでもよい
    await assertSucceeds(setDoc(loanRef(as('bob'), 'new2'), newLoan('bob', { borrowerUid: 'alice' })));
    await assertFails(setDoc(loanRef(as('bob'), 'new3'), newLoan('alice')));
  });

  it('連続スキャンでまとめて登録できる（30 冊を 1 バッチ）', async () => {
    const db = as('bob');
    const batch = writeBatch(db);
    for (let i = 0; i < 30; i++) {
      batch.set(doc(collection(db, 'groups/g1/loans')), newLoan('bob', { book: loanBookSnapshot({ title: `本${i}` }) }));
    }
    await assertSucceeds(batch.commit());
  });

  it('作成時は貸出中（returnedOn・readStatus が null）でも返却済みでも作れる', async () => {
    await assertSucceeds(
      setDoc(
        loanRef(as('bob'), 'new1'),
        newLoan('bob', { returnedOn: '2026-11-20', readStatus: 'read', rating: 5, review: 'おもしろかった' }),
      ),
    );
  });

  it('日付は YYYY-MM-DD', async () => {
    for (const borrowedOn of ['2026/11/08', '2026-13-01', '2026-11-32', '2026-1-8', '20261108', '', null, 20261108]) {
      await assertFails(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', { borrowedOn })));
    }
    for (const dueOn of ['2026-00-10', '2026-11-00', 'tomorrow', null]) {
      await assertFails(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', { dueOn })));
    }
    await assertFails(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', { returnedOn: '2026-11-8' })));
  });

  it('読書状況は null か read / partial / unread', async () => {
    await assertFails(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', { readStatus: 'finished' })));
    await assertFails(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', { readStatus: true })));
    for (const readStatus of ['read', 'partial', 'unread']) {
      await assertSucceeds(updateDoc(loanRef(as('bob'), 'loan1'), { readStatus, updatedAt: serverTimestamp() }));
    }
  });

  it('評価は null か 1〜5 の整数', async () => {
    for (const rating of [0, 6, 3.5, '5', -1]) {
      await assertFails(updateDoc(loanRef(as('bob'), 'loan1'), { rating, updatedAt: serverTimestamp() }));
    }
    for (const rating of [1, 5, null]) {
      await assertSucceeds(updateDoc(loanRef(as('bob'), 'loan1'), { rating, updatedAt: serverTimestamp() }));
    }
  });

  it('感想は null か 2000 文字までの文字列', async () => {
    await assertFails(
      updateDoc(loanRef(as('bob'), 'loan1'), { review: 'あ'.repeat(2001), updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(loanRef(as('bob'), 'loan1'), { review: 123, updatedAt: serverTimestamp() }));
    await assertSucceeds(
      updateDoc(loanRef(as('bob'), 'loan1'), { review: 'あ'.repeat(2000), updatedAt: serverTimestamp() }),
    );
  });

  it('本のスナップショットは title / authors / coverUrl / isbn だけ', async () => {
    const make = (book: unknown) => setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', { book }));
    await assertFails(make(loanBookSnapshot({ publisher: 'x' })));
    await assertFails(make({ title: 'ぐりとぐら', authors: [], coverUrl: null }));
    await assertFails(make(loanBookSnapshot({ title: '' })));
    await assertFails(make(loanBookSnapshot({ title: 'あ'.repeat(301) })));
    await assertFails(make(loanBookSnapshot({ isbn: '123' })));
    await assertFails(make(loanBookSnapshot({ coverUrl: 'data:image/png;base64,xx' })));
    await assertFails(make('ぐりとぐら'));
    await assertSucceeds(make(loanBookSnapshot({ isbn: null, authors: [], coverUrl: 'https://example.com/c.jpg' })));
  });

  it('ID 系のフィールドは空でない文字列', async () => {
    for (const o of [{ bookId: '' }, { locationId: '' }, { borrowerUid: '' }, { locationId: 1 }, { bookId: 'a/b' }]) {
      await assertFails(setDoc(loanRef(as('bob'), 'new1'), newLoan('bob', o)));
    }
  });

  it('延長（返却日の変更）や場所・借りた人の変更ができる', async () => {
    await assertSucceeds(
      updateDoc(loanRef(as('alice'), 'loan2'), {
        dueOn: '2026-12-06',
        locationId: 'loc2',
        borrowerUid: 'alice',
        borrowedOn: '2026-11-07',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('まとめて返却（1 バッチ）と返却の取り消しができる', async () => {
    const db = as('alice');
    const batch = writeBatch(db);
    batch.update(loanRef(db, 'loan1'), {
      returnedOn: '2026-11-20',
      readStatus: 'read',
      rating: 4,
      review: 'また借りたい',
      updatedAt: serverTimestamp(),
    });
    batch.update(loanRef(db, 'loan2'), {
      returnedOn: '2026-11-20',
      readStatus: 'partial',
      rating: null,
      review: null,
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
    await assertSucceeds(
      updateDoc(loanRef(db, 'loan1'), { returnedOn: null, readStatus: null, updatedAt: serverTimestamp() }),
    );
  });

  it('createdBy と bookId は変更できない', async () => {
    await assertFails(updateDoc(loanRef(as('alice'), 'loan1'), { createdBy: 'bob', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(loanRef(as('alice'), 'loan1'), { bookId: 'other', updatedAt: serverTimestamp() }));
  });

  it('メンバーなら他の人が登録した貸出記録も編集・削除できる', async () => {
    await assertSucceeds(updateDoc(loanRef(as('bob'), 'loan1'), { dueOn: '2026-12-01', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(loanRef(as('bob'), 'loan1')));
  });

  it('アプリと同じ単一フィールドのクエリを実行できる', async () => {
    const db = as('bob');
    await assertSucceeds(getDocs(query(collection(db, 'groups/g1/loans'), where('returnedOn', '==', null))));
    await assertSucceeds(getDocs(query(collection(db, 'groups/g1/loans'), where('bookId', '==', BOOK_ID))));
    await assertSucceeds(getDocs(query(collection(db, 'groups/g1/loans'), where('bookId', 'in', [BOOK_ID, 'x']))));
    await assertSucceeds(getDocs(query(collection(db, 'groups/g1/books'), where('seriesId', '==', 's1'))));
  });

  it('他のグループのデータには、メンバーでも触れない', async () => {
    await seed(env, { 'groups/g2/loans/l9': seeded(newLoan('carol')) });
    await assertFails(getDoc(doc(as('alice'), 'groups/g2/loans/l9')));
    await assertFails(setDoc(doc(as('alice'), 'groups/g2/loans/l10'), newLoan('alice')));
    await assertSucceeds(getDoc(doc(as('carol'), 'groups/g2/loans/l9')));
  });
});

describe('その他のパス', () => {
  it('定義していないコレクションには読み書きできない', async () => {
    await assertFails(getDoc(doc(as('alice'), 'secrets/x')));
    await assertFails(setDoc(doc(as('alice'), 'groups/g1/other/x'), { a: 1 }));
    await assertFails(getDocs(collection(as('alice'), 'groups/g1/other')));
  });
});
