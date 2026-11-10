import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
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
  EXPIRED_INVITE_CODE,
  OTHER_GROUP_INVITE_CODE,
  PAST,
  VALID_INVITE_CODE,
  daysFromNow,
  dbOf,
  newLocation,
  seed,
  seedFamilies,
  setupEnv,
} from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFamilies(env);
});

function as(uid: string): Firestore {
  return dbOf(env.authenticatedContext(uid));
}

const NEW_CODE = 'NewInviteCode0123456789';

/** invites.ts の createInvite と同じ形 */
function newInvite(uid: string, overrides: DocumentData = {}): DocumentData {
  return {
    groupId: 'g1',
    groupName: '山田家',
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/** GroupProvider.joinGroup と同じ形のバッチ（members + users） */
function joinBatch(db: Firestore, uid: string, gid: string, inviteCode: string | null): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', gid, 'members', uid), {
    displayName: 'だいすけ',
    joinedAt: serverTimestamp(),
    inviteCode,
  });
  batch.set(doc(db, 'users', uid), {
    displayName: 'だいすけ',
    groupId: gid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

describe('invites/{code} の作成', () => {
  it('メンバーは自分のグループの招待を作れる', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'invites', NEW_CODE), newInvite('bob')));
  });

  it('メンバーでないグループの招待は作れない', async () => {
    await assertFails(setDoc(doc(as('carol'), 'invites', NEW_CODE), newInvite('carol')));
    await assertFails(setDoc(doc(as('dave'), 'invites', NEW_CODE), newInvite('dave')));
  });

  it('未ログインでは作れない', async () => {
    await assertFails(setDoc(doc(dbOf(env.unauthenticatedContext()), 'invites', NEW_CODE), newInvite('alice')));
  });

  it('createdBy は自分でなければならない', async () => {
    await assertFails(setDoc(doc(as('bob'), 'invites', NEW_CODE), newInvite('alice')));
  });

  it('有効期限は今より後、かつ 8 日以内', async () => {
    await assertFails(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice', { expiresAt: daysFromNow(-1) })));
    await assertFails(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice', { expiresAt: daysFromNow(30) })));
    await assertFails(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice', { expiresAt: '2099-01-01' })));
  });

  it('createdAt はサーバー時刻', async () => {
    await assertFails(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice', { createdAt: PAST })));
  });

  it('コードが短い・記号を含むものは作れない', async () => {
    await assertFails(setDoc(doc(as('alice'), 'invites', 'abc'), newInvite('alice')));
    await assertFails(setDoc(doc(as('alice'), 'invites', 'Abcdefghij0123456789x!'), newInvite('alice')));
  });

  it('余計なフィールドや空のグループ名は不可', async () => {
    await assertFails(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice', { maxUses: 100 })));
    await assertFails(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice', { groupName: '' })));
  });
});

describe('invites/{code} の読み取り・変更', () => {
  it('ログイン済みならコードを指定して get できる（グループ外の人でも）', async () => {
    await assertSucceeds(getDoc(doc(as('dave'), 'invites', VALID_INVITE_CODE)));
    await assertSucceeds(getDoc(doc(as('carol'), 'invites', VALID_INVITE_CODE)));
    await assertSucceeds(getDoc(doc(as('dave'), 'invites', 'NotExistingCode0123456')));
  });

  it('未ログインでは get できない', async () => {
    await assertFails(getDoc(doc(dbOf(env.unauthenticatedContext()), 'invites', VALID_INVITE_CODE)));
  });

  it('一覧（list）は誰も取れない', async () => {
    await assertFails(getDocs(collection(as('alice'), 'invites')));
    await assertFails(getDocs(query(collection(as('alice'), 'invites'), where('groupId', '==', 'g1'))));
  });

  it('更新はできない', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'invites', VALID_INVITE_CODE), { expiresAt: daysFromNow(5) }));
  });

  it('削除はグループのメンバーだけ', async () => {
    await assertFails(deleteDoc(doc(as('carol'), 'invites', VALID_INVITE_CODE)));
    await assertFails(deleteDoc(doc(as('dave'), 'invites', VALID_INVITE_CODE)));
    await assertSucceeds(deleteDoc(doc(as('bob'), 'invites', VALID_INVITE_CODE)));
  });
});

describe('招待で参加する', () => {
  it('有効な招待コードで members + users を 1 バッチで作れる', async () => {
    await assertSucceeds(joinBatch(as('dave'), 'dave', 'g1', VALID_INVITE_CODE));
  });

  it('参加後はグループのデータを読み書きできる', async () => {
    await seed(env, { 'groups/g1/locations/loc1': { ...newLocation(), createdAt: PAST, updatedAt: PAST } });
    await assertFails(getDoc(doc(as('dave'), 'groups/g1/locations/loc1')));
    await joinBatch(as('dave'), 'dave', 'g1', VALID_INVITE_CODE);
    await assertSucceeds(getDoc(doc(as('dave'), 'groups/g1')));
    await assertSucceeds(getDocs(collection(as('dave'), 'groups/g1/members')));
    await assertSucceeds(getDoc(doc(as('dave'), 'groups/g1/locations/loc1')));
    await assertSucceeds(setDoc(doc(as('dave'), 'groups/g1/locations/loc2'), newLocation({ name: '保育園' })));
  });

  it('期限切れの招待では参加できない', async () => {
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', EXPIRED_INVITE_CODE));
  });

  it('別のグループの招待コードでは参加できない', async () => {
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', OTHER_GROUP_INVITE_CODE));
  });

  it('存在しない招待コードでは参加できない', async () => {
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', 'NotExistingCode0123456'));
  });

  it('招待コードの形式が不正なら参加できない', async () => {
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', 'short'));
  });

  it('削除された招待では参加できない', async () => {
    await deleteDoc(doc(as('alice'), 'invites', VALID_INVITE_CODE));
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', VALID_INVITE_CODE));
  });

  it('「これまでの招待リンクをすべて無効にする」より前に作った招待では参加できない', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'groups/g1'), { invitesValidAfter: serverTimestamp() }));
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', VALID_INVITE_CODE));
    // 他のグループの招待には影響しない
    await assertSucceeds(joinBatch(as('eve'), 'eve', 'g2', OTHER_GROUP_INVITE_CODE));
  });

  it('無効にした後に作った招待では参加できる', async () => {
    await updateDoc(doc(as('alice'), 'groups/g1'), { invitesValidAfter: serverTimestamp() });
    await assertSucceeds(setDoc(doc(as('alice'), 'invites', NEW_CODE), newInvite('alice')));
    await assertSucceeds(joinBatch(as('dave'), 'dave', 'g1', NEW_CODE));
  });

  it('無効にした招待では、members が残っている人の参加し直し（上書き）もできない', async () => {
    await seed(env, { 'groups/g1/members/dave': { displayName: 'だいすけ', joinedAt: PAST, inviteCode: VALID_INVITE_CODE } });
    await updateDoc(doc(as('alice'), 'groups/g1'), { invitesValidAfter: serverTimestamp() });
    await assertFails(joinBatch(as('dave'), 'dave', 'g1', VALID_INVITE_CODE));
  });

  it('members を作らずに users.groupId だけ設定することはできない', async () => {
    await assertFails(
      setDoc(doc(as('dave'), 'users/dave'), {
        displayName: 'だいすけ',
        groupId: 'g1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('別のグループに入っている人も招待で参加できる（users は update）', async () => {
    const db = as('carol');
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups/g1/members/carol'), {
      displayName: 'かおる',
      joinedAt: serverTimestamp(),
      inviteCode: VALID_INVITE_CODE,
    });
    batch.update(doc(db, 'users/carol'), { displayName: 'かおる', groupId: 'g1', updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  it('期限切れ間近（数秒後に切れる）でもまだ有効なら参加できる', async () => {
    await seed(env, {
      'invites/AlmostExpired0123456789': {
        groupId: 'g1',
        groupName: '山田家',
        createdBy: 'alice',
        createdAt: PAST,
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      },
    });
    await assertSucceeds(joinBatch(as('dave'), 'dave', 'g1', 'AlmostExpired0123456789'));
  });
});
