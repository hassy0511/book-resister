/**
 * 所属グループの提供（useGroup / useRequiredGroup）。AuthProvider の内側に置く。
 * users/{uid} を購読し、groupId があれば groups/{gid} とメンバー一覧を購読する。
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { useAuth } from '../auth/AuthProvider';
import {
  EMPTY_LIST,
  compareJa,
  docSubscriber,
  isPermissionDenied,
  noopSubscriber,
  querySubscriber,
  settleWrite,
  toDataError,
  useSubscription,
} from '../data/common';
import { getInvite } from '../data/invites';
import { db } from '../firebase';
import type { Group, Member, UserProfile, WithId } from '../types';

export interface GroupContextValue {
  loading: boolean;
  profile: UserProfile | null;
  groupId: string | null;
  group: WithId<Group> | null;
  members: WithId<Member>[];
  /** 読み込みエラー（日本語メッセージ）。無ければ null */
  error: Error | null;
  /** 不明なら '（不明）' */
  memberName(uid: string): string;
  /** group + member + users を 1 バッチで書き、グループ ID を返す */
  createGroup(groupName: string, displayName: string): Promise<string>;
  /** member + users を 1 バッチで書く */
  joinGroup(code: string, displayName: string): Promise<void>;
  /** users と members の両方を更新 */
  updateDisplayName(displayName: string): Promise<void>;
  updateGroupName(name: string): Promise<void>;
}

export type RequiredGroupValue = GroupContextValue & { groupId: string; uid: string };

const GroupContext = createContext<GroupContextValue | null>(null);

const UNKNOWN_MEMBER = '（不明）';

function cleanDisplayName(name: string): string {
  const t = name.trim();
  if (!t) throw new Error('表示名を入力してください');
  if (t.length > 50) throw new Error('表示名は 50 文字以内にしてください');
  return t;
}

function cleanGroupName(name: string): string {
  const t = name.trim();
  if (!t) throw new Error('グループ名を入力してください');
  if (t.length > 50) throw new Error('グループ名は 50 文字以内にしてください');
  return t;
}

/** メンバーは参加順（同時なら名前順） */
function sortMembers(list: readonly WithId<Member>[]): WithId<Member>[] {
  return [...list].sort((a, b) => {
    const at = a.joinedAt?.toMillis?.() ?? 0;
    const bt = b.joinedAt?.toMillis?.() ?? 0;
    return at - bt || compareJa(a.displayName, b.displayName);
  });
}

/** users/{uid} の作成または更新をバッチに積む（作成時だけ createdAt を入れる） */
async function putUserProfile(batch: WriteBatch, uid: string, displayName: string, groupId: string): Promise<void> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    batch.update(ref, { displayName, groupId, updatedAt: serverTimestamp() });
  } else {
    batch.set(ref, { displayName, groupId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

export function GroupProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;

  const profileResult = useSubscription(
    uid ? `user/${uid}` : null,
    uid ? docSubscriber<UserProfile>(doc(db, 'users', uid)) : noopSubscriber,
    null,
  );
  const profile: UserProfile | null = profileResult.data;
  const profileGroupId = profile?.groupId ?? null;

  const groupResult = useSubscription(
    profileGroupId ? `group/${profileGroupId}` : null,
    profileGroupId ? docSubscriber<Group>(doc(db, 'groups', profileGroupId)) : noopSubscriber,
    null,
  );
  const membersResult = useSubscription(
    profileGroupId ? `members/${profileGroupId}` : null,
    profileGroupId ? querySubscriber<Member>(collection(db, 'groups', profileGroupId, 'members')) : noopSubscriber,
    EMPTY_LIST,
  );

  // メンバーでなくなった（読み取りを拒否された）グループは未参加として扱う
  const groupId = isPermissionDenied(groupResult.error) ? null : profileGroupId;

  const members = useMemo(() => (groupId ? sortMembers(membersResult.data) : EMPTY_LIST), [groupId, membersResult.data]);
  const group = groupId ? groupResult.data : null;

  const loading =
    authLoading ||
    (uid !== null && profileResult.loading) ||
    (groupId !== null && (groupResult.loading || membersResult.loading));

  const error = profileResult.error ?? groupResult.error ?? membersResult.error ?? null;

  const memberName = useCallback(
    (memberUid: string) => members.find((m) => m.id === memberUid)?.displayName ?? UNKNOWN_MEMBER,
    [members],
  );

  const requireUid = useCallback((): string => {
    if (!uid) throw new Error('ログインしてください');
    return uid;
  }, [uid]);

  const createGroup = useCallback(
    async (groupName: string, displayName: string): Promise<string> => {
      const me = requireUid();
      const name = cleanGroupName(groupName);
      const dn = cleanDisplayName(displayName);
      try {
        const groupRef = doc(collection(db, 'groups'));
        const batch = writeBatch(db);
        batch.set(groupRef, { name, createdBy: me, createdAt: serverTimestamp() });
        batch.set(doc(db, 'groups', groupRef.id, 'members', me), {
          displayName: dn,
          joinedAt: serverTimestamp(),
          inviteCode: null,
        });
        await putUserProfile(batch, me, dn, groupRef.id);
        await batch.commit();
        return groupRef.id;
      } catch (e) {
        throw toDataError(e);
      }
    },
    [requireUid],
  );

  const joinGroup = useCallback(
    async (code: string, displayName: string): Promise<void> => {
      const me = requireUid();
      const dn = cleanDisplayName(displayName);
      const invite = await getInvite(code);
      if (!invite) {
        throw new Error('招待リンクが無効か、有効期限が切れています。家族に新しい招待リンクを発行してもらってください。');
      }
      // すでに同じグループに参加している
      if (groupId === invite.groupId) return;
      try {
        const batch = writeBatch(db);
        // 1 人 1 グループ（F-06）。前のグループのメンバー情報を消し、そのグループのデータと通知から外れる
        const previousGroupId = profile?.groupId ?? null;
        if (previousGroupId && previousGroupId !== invite.groupId) {
          batch.delete(doc(db, 'groups', previousGroupId, 'members', me));
        }
        batch.set(doc(db, 'groups', invite.groupId, 'members', me), {
          displayName: dn,
          joinedAt: serverTimestamp(),
          inviteCode: invite.id,
        });
        await putUserProfile(batch, me, dn, invite.groupId);
        await batch.commit();
      } catch (e) {
        throw toDataError(e);
      }
    },
    [requireUid, groupId, profile?.groupId],
  );

  const updateDisplayName = useCallback(
    async (displayName: string): Promise<void> => {
      const me = requireUid();
      const dn = cleanDisplayName(displayName);
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', me), { displayName: dn, updatedAt: serverTimestamp() });
      if (groupId) batch.update(doc(db, 'groups', groupId, 'members', me), { displayName: dn });
      await settleWrite(batch.commit());
    },
    [requireUid, groupId],
  );

  const updateGroupName = useCallback(
    async (name: string): Promise<void> => {
      if (!groupId) throw new Error('グループに参加していません');
      const cleaned = cleanGroupName(name);
      await settleWrite(updateDoc(doc(db, 'groups', groupId), { name: cleaned }));
    },
    [groupId],
  );

  const value = useMemo<GroupContextValue>(
    () => ({
      loading,
      profile,
      groupId,
      group,
      members,
      error,
      memberName,
      createGroup,
      joinGroup,
      updateDisplayName,
      updateGroupName,
    }),
    [loading, profile, groupId, group, members, error, memberName, createGroup, joinGroup, updateDisplayName, updateGroupName],
  );

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup(): GroupContextValue {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error('useGroup は GroupProvider の内側で使ってください');
  return ctx;
}

/** グループ参加済みの画面用。未ログイン・未参加なら例外 */
export function useRequiredGroup(): RequiredGroupValue {
  const ctx = useGroup();
  const { user } = useAuth();
  if (!user) throw new Error('ログインしていません');
  if (!ctx.groupId) throw new Error('グループに参加していません');
  return { ...ctx, groupId: ctx.groupId, uid: user.uid };
}
