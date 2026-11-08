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
  where,
  type Firestore,
} from 'firebase/firestore';
import { PAST, dbOf, newPushSubscription, seed, seedFamilies, setupEnv } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

// endpoint の SHA-256（16 進）を想定した ID
const ALICE_SUB = 'a'.repeat(64);
const BOB_SUB = 'b'.repeat(64);
const NEW_SUB = 'c'.repeat(64);

beforeEach(async () => {
  await env.clearFirestore();
  await seedFamilies(env);
  await seed(env, {
    [`groups/g1/pushSubscriptions/${ALICE_SUB}`]: { ...newPushSubscription('alice'), createdAt: PAST },
    [`groups/g1/pushSubscriptions/${BOB_SUB}`]: {
      ...newPushSubscription('bob', { endpoint: 'https://fcm.googleapis.com/fcm/send/bob' }),
      createdAt: PAST,
    },
  });
});

function as(uid: string): Firestore {
  return dbOf(env.authenticatedContext(uid));
}

function subRef(db: Firestore, id: string) {
  return doc(db, 'groups/g1/pushSubscriptions', id);
}

describe('pushSubscriptions の作成・更新', () => {
  it('メンバーは自分の購読を登録できる', async () => {
    await assertSucceeds(setDoc(subRef(as('bob'), NEW_SUB), newPushSubscription('bob')));
  });

  it('uid が自分でない購読は登録できない', async () => {
    await assertFails(setDoc(subRef(as('bob'), NEW_SUB), newPushSubscription('alice')));
  });

  it('非メンバーは登録できない', async () => {
    await assertFails(setDoc(subRef(as('carol'), NEW_SUB), newPushSubscription('carol')));
    await assertFails(setDoc(subRef(as('dave'), NEW_SUB), newPushSubscription('dave')));
  });

  it('endpoint は https、keys は p256dh と auth、余計なフィールドは不可', async () => {
    const make = (o: Record<string, unknown>) => setDoc(subRef(as('bob'), NEW_SUB), newPushSubscription('bob', o));
    await assertFails(make({ endpoint: 'http://example.com/push' }));
    await assertFails(make({ endpoint: '' }));
    await assertFails(make({ keys: { p256dh: 'x' } }));
    await assertFails(make({ keys: { p256dh: 'x', auth: 'y', extra: 'z' } }));
    await assertFails(make({ keys: { p256dh: '', auth: 'y' } }));
    await assertFails(make({ userAgent: null }));
    await assertFails(make({ createdAt: PAST }));
    await assertFails(make({ groupId: 'g1' }));
  });

  it('送信先は主要なブラウザのプッシュサービスだけ（第三者のサーバーは不可）', async () => {
    const make = (endpoint: string) => setDoc(subRef(as('bob'), NEW_SUB), newPushSubscription('bob', { endpoint }));
    await assertSucceeds(make('https://web.push.apple.com/QGxhYmVsLWZvci10ZXN0'));
    await assertSucceeds(make('https://fcm.googleapis.com/fcm/send/abc:APA91b'));
    await assertSucceeds(make('https://updates.push.services.mozilla.com/wpush/v2/gAAAAA'));
    await assertSucceeds(make('https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB'));
    await assertFails(make('https://attacker.example/x'));
    await assertFails(make('https://victim.example/api/anything?a=1'));
    await assertFails(make('https://127.0.0.1:1/x'));
    await assertFails(make('https://web.push.apple.com.attacker.example/x'));
    await assertFails(make('https://webxpushxapplexcom/x'));
    await assertFails(make('https://web.push.apple.com:8443/x'));
    await assertFails(make('https://web.push.apple.com/'));
  });

  it('鍵の長さ・文字種が正しくなければ登録できない', async () => {
    const valid = newPushSubscription('bob').keys as { p256dh: string; auth: string };
    const make = (keys: Record<string, string>) =>
      setDoc(subRef(as('bob'), NEW_SUB), newPushSubscription('bob', { keys }));
    await assertSucceeds(make({ p256dh: `${valid.p256dh}=`, auth: `${valid.auth}==` }));
    await assertFails(make({ p256dh: 'BPublicKeyForTest', auth: valid.auth }));
    await assertFails(make({ p256dh: valid.p256dh.slice(1), auth: valid.auth }));
    await assertFails(make({ p256dh: `${valid.p256dh.slice(1)}+`, auth: valid.auth }));
    await assertFails(make({ p256dh: valid.p256dh, auth: 'AuthSecret' }));
    await assertFails(make({ p256dh: valid.p256dh, auth: `${valid.auth}A` }));
  });

  it('同じ端末での購読し直し（上書き）ができる', async () => {
    // createdAt を据え置き
    await assertSucceeds(setDoc(subRef(as('alice'), ALICE_SUB), { ...newPushSubscription('alice'), createdAt: PAST }));
    // createdAt を今の時刻に
    await assertSucceeds(setDoc(subRef(as('alice'), ALICE_SUB), newPushSubscription('alice')));
  });

  it('同じ端末を別のメンバーが使う場合は、自分の uid で上書きできる', async () => {
    await assertSucceeds(setDoc(subRef(as('bob'), ALICE_SUB), newPushSubscription('bob')));
  });

  it('他人の uid のままでは上書きできない', async () => {
    await assertFails(
      setDoc(subRef(as('bob'), ALICE_SUB), { ...newPushSubscription('alice'), createdAt: serverTimestamp() }),
    );
  });
});

describe('pushSubscriptions の読み取り・削除', () => {
  it('自分の購読は読める。他人の購読は同じグループでも読めない', async () => {
    await assertSucceeds(getDoc(subRef(as('alice'), ALICE_SUB)));
    await assertFails(getDoc(subRef(as('bob'), ALICE_SUB)));
    await assertFails(getDoc(subRef(as('carol'), ALICE_SUB)));
  });

  it('まだ無い購読（自分の端末の ID）はメンバーなら get できる', async () => {
    await assertSucceeds(getDoc(subRef(as('bob'), NEW_SUB)));
    await assertFails(getDoc(subRef(as('carol'), NEW_SUB)));
  });

  it('一覧は自分の uid で絞ったクエリだけ', async () => {
    const col = collection(as('alice'), 'groups/g1/pushSubscriptions');
    await assertSucceeds(getDocs(query(col, where('uid', '==', 'alice'))));
    await assertFails(getDocs(col));
    await assertFails(getDocs(query(col, where('uid', '==', 'bob'))));
  });

  it('自分の購読は削除できる。他人の購読は削除できない', async () => {
    await assertFails(deleteDoc(subRef(as('bob'), ALICE_SUB)));
    await assertFails(deleteDoc(subRef(as('carol'), ALICE_SUB)));
    await assertSucceeds(deleteDoc(subRef(as('alice'), ALICE_SUB)));
  });

  it('既に無い購読の削除はメンバーならエラーにならない', async () => {
    await assertSucceeds(deleteDoc(subRef(as('bob'), NEW_SUB)));
    await assertFails(deleteDoc(subRef(as('carol'), NEW_SUB)));
  });

  it('グループを抜けた後でも自分の購読は削除できる', async () => {
    await deleteDoc(doc(as('alice'), 'groups/g1/members/alice'));
    await assertSucceeds(deleteDoc(subRef(as('alice'), ALICE_SUB)));
  });
});
