import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
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

function anonymous(): Firestore {
  return dbOf(env.unauthenticatedContext());
}

/** GroupProvider.createGroup と同じ形のバッチ（group + members + users） */
function createGroupBatch(
  db: Firestore,
  uid: string,
  gid: string,
  opts: {
    group?: DocumentData;
    member?: DocumentData | null;
    user?: DocumentData | null;
    userExists?: boolean;
  } = {},
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', gid), opts.group ?? { name: '新しい家族', createdBy: uid, createdAt: serverTimestamp() });
  if (opts.member !== null) {
    batch.set(
      doc(db, 'groups', gid, 'members', uid),
      opts.member ?? { displayName: 'たろう', joinedAt: serverTimestamp(), inviteCode: null },
    );
  }
  if (opts.user !== null) {
    if (opts.userExists) {
      batch.update(doc(db, 'users', uid), opts.user ?? { displayName: 'たろう', groupId: gid, updatedAt: serverTimestamp() });
    } else {
      batch.set(
        doc(db, 'users', uid),
        opts.user ?? { displayName: 'たろう', groupId: gid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      );
    }
  }
  return batch.commit();
}

/** 他のメンバーを外す（招待の一括無効化と同じバッチ。data/members.ts の removeMember と同じ形） */
function removeMemberBatch(db: Firestore, gid: string, memberUid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', gid), { invitesValidAfter: serverTimestamp() });
  batch.delete(doc(db, 'groups', gid, 'members', memberUid));
  return batch.commit();
}

/** 招待で参加する（GroupProvider.joinGroup と同じ形。users は既にある前提で update） */
function joinWithInvite(db: Firestore, uid: string, gid: string, inviteCode: string | null): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', gid, 'members', uid), { displayName: 'なまえ', joinedAt: serverTimestamp(), inviteCode });
  batch.update(doc(db, 'users', uid), { displayName: 'なまえ', groupId: gid, updatedAt: serverTimestamp() });
  return batch.commit();
}

describe('グループの作成（1 バッチ）', () => {
  it('グループ未参加の人が group + members + users をまとめて作れる', async () => {
    await assertSucceeds(createGroupBatch(as('dave'), 'dave', 'g3'));
    // 作成後はメンバーとして読める
    await assertSucceeds(getDoc(doc(as('dave'), 'groups/g3')));
  });

  it('すでに users がある人も新しいグループを作れる（users は update）', async () => {
    await assertSucceeds(createGroupBatch(as('alice'), 'alice', 'g3', { userExists: true }));
  });

  it('未ログインでは作れない', async () => {
    await assertFails(createGroupBatch(anonymous(), 'dave', 'g3'));
  });

  it('自分の members を同じバッチで作らないと作れない', async () => {
    await assertFails(createGroupBatch(as('dave'), 'dave', 'g3', { member: null, user: null }));
  });

  it('createdBy が自分でなければ作れない', async () => {
    await assertFails(
      createGroupBatch(as('dave'), 'dave', 'g3', {
        group: { name: '新しい家族', createdBy: 'alice', createdAt: serverTimestamp() },
      }),
    );
  });

  it('グループ名が空・空白のみ・51 文字以上なら作れない', async () => {
    for (const name of ['', '   ', 'あ'.repeat(51)]) {
      await assertFails(
        createGroupBatch(as('dave'), 'dave', 'g3', { group: { name, createdBy: 'dave', createdAt: serverTimestamp() } }),
      );
    }
    await assertSucceeds(
      createGroupBatch(as('dave'), 'dave', 'g3', {
        group: { name: 'あ'.repeat(50), createdBy: 'dave', createdAt: serverTimestamp() },
      }),
    );
  });

  it('余計なフィールドや createdAt が今でないグループは作れない', async () => {
    await assertFails(
      createGroupBatch(as('dave'), 'dave', 'g3', {
        group: { name: '家族', createdBy: 'dave', createdAt: serverTimestamp(), admin: true },
      }),
    );
    await assertFails(
      createGroupBatch(as('dave'), 'dave', 'g3', { group: { name: '家族', createdBy: 'dave', createdAt: PAST } }),
    );
  });

  it('既存のグループは作り直せない（乗っ取り不可）', async () => {
    await assertFails(
      createGroupBatch(as('dave'), 'dave', 'g1', {
        group: { name: '乗っ取り', createdBy: 'dave', createdAt: serverTimestamp() },
      }),
    );
  });

  it('作成者としての members には inviteCode を入れられない', async () => {
    await assertFails(
      createGroupBatch(as('dave'), 'dave', 'g3', {
        member: { displayName: 'たろう', joinedAt: serverTimestamp(), inviteCode: VALID_INVITE_CODE },
      }),
    );
  });
});

describe('users/{uid}', () => {
  it('本人は読める。他人と未ログインは読めない', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice')));
    await assertFails(getDoc(doc(anonymous(), 'users/alice')));
  });

  it('同じグループのメンバーでも他人の users は書けない', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'users/alice'), { displayName: 'x', updatedAt: serverTimestamp() }));
  });

  it('groupId: null で作れる（未参加の状態）', async () => {
    await assertSucceeds(
      setDoc(doc(as('dave'), 'users/dave'), {
        displayName: 'だいすけ',
        groupId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('自分がメンバーでないグループを groupId にできない', async () => {
    await assertFails(
      setDoc(doc(as('dave'), 'users/dave'), {
        displayName: 'だいすけ',
        groupId: 'g1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(doc(as('alice'), 'users/alice'), { groupId: 'g2', updatedAt: serverTimestamp() }));
  });

  it('表示名だけの更新はできる（groupId はそのまま）', async () => {
    await assertSucceeds(
      updateDoc(doc(as('alice'), 'users/alice'), { displayName: 'おかあさん', updatedAt: serverTimestamp() }),
    );
  });

  it('表示名は 1〜50 文字', async () => {
    for (const displayName of ['', '  ', 'あ'.repeat(51), 123]) {
      await assertFails(updateDoc(doc(as('alice'), 'users/alice'), { displayName, updatedAt: serverTimestamp() }));
    }
    await assertSucceeds(
      updateDoc(doc(as('alice'), 'users/alice'), { displayName: 'あ'.repeat(50), updatedAt: serverTimestamp() }),
    );
  });

  it('updatedAt はサーバー時刻、createdAt は変更不可、余計なフィールド不可', async () => {
    const ref = doc(as('alice'), 'users/alice');
    await assertFails(updateDoc(ref, { displayName: 'x', updatedAt: PAST }));
    await assertFails(updateDoc(ref, { displayName: 'x' }));
    await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { isAdmin: true, updatedAt: serverTimestamp() }));
  });

  it('グループを抜けた後も groupId を変えずに表示名を更新できる', async () => {
    await assertSucceeds(deleteDoc(doc(as('bob'), 'groups/g1/members/bob')));
    await assertSucceeds(updateDoc(doc(as('bob'), 'users/bob'), { displayName: 'ぱぱ', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('bob'), 'users/bob'), { groupId: null, updatedAt: serverTimestamp() }));
  });

  it('削除はできない', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'users/alice')));
  });
});

describe('groups/{gid}', () => {
  it('メンバーは読める。非メンバー・未ログインは読めない', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'groups/g1')));
    await assertSucceeds(getDoc(doc(as('bob'), 'groups/g1')));
    await assertFails(getDoc(doc(as('carol'), 'groups/g1')));
    await assertFails(getDoc(doc(as('dave'), 'groups/g1')));
    await assertFails(getDoc(doc(anonymous(), 'groups/g1')));
  });

  it('グループの一覧（list）は取れない', async () => {
    await assertFails(getDocs(collection(as('alice'), 'groups')));
  });

  it('メンバーは名前だけ変更できる', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'groups/g1'), { name: '山田ファミリー' }));
    await assertFails(updateDoc(doc(as('bob'), 'groups/g1'), { name: '' }));
    await assertFails(updateDoc(doc(as('bob'), 'groups/g1'), { name: 'あ'.repeat(51) }));
    await assertFails(updateDoc(doc(as('bob'), 'groups/g1'), { createdBy: 'bob' }));
    await assertFails(updateDoc(doc(as('bob'), 'groups/g1'), { name: '山田', extra: 1 }));
  });

  it('非メンバーは変更できない', async () => {
    await assertFails(updateDoc(doc(as('carol'), 'groups/g1'), { name: '乗っ取り' }));
    await assertFails(updateDoc(doc(as('carol'), 'groups/g1'), { invitesValidAfter: serverTimestamp() }));
  });

  it('メンバーは招待をすべて無効にできる（invitesValidAfter は今の時刻だけ）', async () => {
    const ref = doc(as('bob'), 'groups/g1');
    await assertFails(updateDoc(ref, { invitesValidAfter: PAST }));
    await assertFails(updateDoc(ref, { invitesValidAfter: '2026-11-08' }));
    await assertSucceeds(updateDoc(ref, { invitesValidAfter: serverTimestamp() }));
    // 2 回目も可。名前の変更も引き続きできる
    await assertSucceeds(updateDoc(ref, { invitesValidAfter: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { name: '山田ファミリー' }));
    // 消して元に戻すことはできない
    await assertFails(updateDoc(ref, { invitesValidAfter: deleteField() }));
  });

  it('削除はできない', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'groups/g1')));
  });
});

describe('groups/{gid}/members/{uid}', () => {
  it('メンバーはメンバー一覧を読める。非メンバーは読めない', async () => {
    await assertSucceeds(getDocs(collection(as('bob'), 'groups/g1/members')));
    await assertSucceeds(getDoc(doc(as('bob'), 'groups/g1/members/alice')));
    await assertFails(getDocs(collection(as('carol'), 'groups/g1/members')));
    await assertFails(getDoc(doc(as('carol'), 'groups/g1/members/alice')));
  });

  it('参加前の本人は自分のメンバー情報を get できる（存在しなくても可）', async () => {
    await assertSucceeds(getDoc(doc(as('dave'), 'groups/g1/members/dave')));
    await assertFails(getDoc(doc(as('dave'), 'groups/g1/members/alice')));
  });

  it('作成者でも招待コードも無しに既存グループには参加できない', async () => {
    await assertFails(
      setDoc(doc(as('dave'), 'groups/g1/members/dave'), {
        displayName: 'だいすけ',
        joinedAt: serverTimestamp(),
        inviteCode: null,
      }),
    );
  });

  it('他人の members は作れない', async () => {
    await assertFails(
      setDoc(doc(as('alice'), 'groups/g1/members/dave'), {
        displayName: 'だいすけ',
        joinedAt: serverTimestamp(),
        inviteCode: null,
      }),
    );
  });

  it('グループを作った本人は抜けた後に作り直せる（招待なし）', async () => {
    await assertSucceeds(deleteDoc(doc(as('alice'), 'groups/g1/members/alice')));
    await assertSucceeds(
      setDoc(doc(as('alice'), 'groups/g1/members/alice'), {
        displayName: 'ママ',
        joinedAt: serverTimestamp(),
        inviteCode: null,
      }),
    );
  });

  it('本人は表示名だけ変更できる', async () => {
    const ref = doc(as('bob'), 'groups/g1/members/bob');
    await assertSucceeds(updateDoc(ref, { displayName: 'おとうさん' }));
    await assertFails(updateDoc(ref, { displayName: '' }));
    await assertFails(updateDoc(ref, { displayName: 'あ'.repeat(51) }));
    await assertFails(updateDoc(ref, { inviteCode: null }));
    await assertFails(updateDoc(ref, { joinedAt: serverTimestamp(), inviteCode: EXPIRED_INVITE_CODE }));
    await assertFails(updateDoc(ref, { displayName: 'x', extra: true }));
  });

  it('members が残っている人は、有効な招待で参加し直せる（setDoc の上書き）', async () => {
    await seed(env, { 'groups/g1/members/carol': { displayName: 'かおる', joinedAt: PAST, inviteCode: null } });
    const db = as('carol');
    const rejoin = (inviteCode: string) => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'groups/g1/members/carol'), { displayName: 'かおる', joinedAt: serverTimestamp(), inviteCode });
      batch.update(doc(db, 'users/carol'), { displayName: 'かおる', groupId: 'g1', updatedAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(rejoin(EXPIRED_INVITE_CODE));
    await assertFails(rejoin(OTHER_GROUP_INVITE_CODE));
    await assertSucceeds(rejoin(VALID_INVITE_CODE));
  });

  it('別のグループの人が招待で移るとき、前のグループの members 削除を同じバッチで行える（GroupProvider.joinGroup）', async () => {
    const db = as('carol');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'groups/g2/members/carol'));
    batch.set(doc(db, 'groups/g1/members/carol'), {
      displayName: 'かおる',
      joinedAt: serverTimestamp(),
      inviteCode: VALID_INVITE_CODE,
    });
    batch.update(doc(db, 'users/carol'), { displayName: 'かおる', groupId: 'g1', updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
    // 前のグループは読めなくなり、新しいグループは読める
    await assertFails(getDoc(doc(as('carol'), 'groups/g2')));
    await assertSucceeds(getDoc(doc(as('carol'), 'groups/g1')));
  });

  it('他人の members を招待コードで上書きすることはできない', async () => {
    await assertFails(
      setDoc(doc(as('dave'), 'groups/g1/members/bob'), {
        displayName: 'なりすまし',
        joinedAt: serverTimestamp(),
        inviteCode: VALID_INVITE_CODE,
      }),
    );
  });

  it('表示名の変更は users と members を 1 バッチで更新できる', async () => {
    const db = as('bob');
    const batch = writeBatch(db);
    batch.update(doc(db, 'users/bob'), { displayName: 'おとうさん', updatedAt: serverTimestamp() });
    batch.update(doc(db, 'groups/g1/members/bob'), { displayName: 'おとうさん' });
    await assertSucceeds(batch.commit());
  });

  it('他のメンバーの情報は変更できない', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'groups/g1/members/bob'), { displayName: 'x' }));
  });

  it('本人は抜けられる（削除）。抜けた後はグループを読めない', async () => {
    await assertSucceeds(deleteDoc(doc(as('bob'), 'groups/g1/members/bob')));
    await assertFails(getDoc(doc(as('bob'), 'groups/g1')));
  });
});

describe('メンバーを外す（F-07）', () => {
  it('メンバーは他のメンバーを外せる（招待の一括無効化と同じバッチ）。作成者でなくても可（F-05）', async () => {
    await assertSucceeds(removeMemberBatch(as('bob'), 'g1', 'alice'));
  });

  it('招待を無効にしないまま他のメンバーだけを消すことはできない', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'groups/g1/members/bob')));
    // 名前の変更だけでは代わりにならない
    const db = as('alice');
    const batch = writeBatch(db);
    batch.update(doc(db, 'groups/g1'), { name: '山田ファミリー' });
    batch.delete(doc(db, 'groups/g1/members/bob'));
    await assertFails(batch.commit());
  });

  it('非メンバー・未ログインは外せない', async () => {
    await assertFails(removeMemberBatch(as('carol'), 'g1', 'bob'));
    await assertFails(removeMemberBatch(as('dave'), 'g1', 'bob'));
    await assertFails(removeMemberBatch(anonymous(), 'g1', 'bob'));
  });

  it('外された人はグループのデータを読めない', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'groups/g1')));
    await removeMemberBatch(as('alice'), 'g1', 'bob');
    await assertFails(getDoc(doc(as('bob'), 'groups/g1')));
    await assertFails(getDocs(collection(as('bob'), 'groups/g1/members')));
    await assertFails(getDocs(collection(as('bob'), 'groups/g1/loans')));
  });

  it('外された人は、手元の招待リンク（参加に使ったもの・自分で作ったもの）では戻れない', async () => {
    // bob が外される前に自分で招待を作っておく
    const ownCode = 'BobsOwnInvite0123456789';
    await assertSucceeds(
      setDoc(doc(as('bob'), 'invites', ownCode), {
        groupId: 'g1',
        groupName: '山田家',
        createdBy: 'bob',
        createdAt: serverTimestamp(),
        expiresAt: daysFromNow(7),
      }),
    );
    await removeMemberBatch(as('alice'), 'g1', 'bob');
    await assertFails(joinWithInvite(as('bob'), 'bob', 'g1', VALID_INVITE_CODE));
    await assertFails(joinWithInvite(as('bob'), 'bob', 'g1', ownCode));
    await assertFails(joinWithInvite(as('bob'), 'bob', 'g1', null));
  });

  it('外した後に作った招待なら参加できる', async () => {
    await removeMemberBatch(as('alice'), 'g1', 'bob');
    const code = 'AfterRemoval0123456789ab';
    await assertSucceeds(
      setDoc(doc(as('alice'), 'invites', code), {
        groupId: 'g1',
        groupName: '山田家',
        createdBy: 'alice',
        createdAt: serverTimestamp(),
        expiresAt: daysFromNow(7),
      }),
    );
    await assertSucceeds(joinWithInvite(as('bob'), 'bob', 'g1', code));
  });

  it('グループを作った人は外されても招待なしで戻れる', async () => {
    await assertSucceeds(removeMemberBatch(as('bob'), 'g1', 'alice'));
    await assertFails(getDoc(doc(as('alice'), 'groups/g1')));
    await assertSucceeds(joinWithInvite(as('alice'), 'alice', 'g1', null));
    await assertSucceeds(getDoc(doc(as('alice'), 'groups/g1')));
  });
});
