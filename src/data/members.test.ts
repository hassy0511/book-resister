import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  ops: [] as unknown[][],
  commit: vi.fn<() => Promise<void>>(),
  updateDoc: vi.fn<(ref: unknown, data: unknown) => Promise<void>>(),
}));

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  serverTimestamp: () => 'SERVER_TIME',
  updateDoc: fs.updateDoc,
  writeBatch: () => ({
    update: (ref: unknown, data: unknown) => fs.ops.push(['update', ref, data]),
    delete: (ref: unknown) => fs.ops.push(['delete', ref]),
    commit: fs.commit,
  }),
}));

const { OFFLINE_MESSAGE, removeMember, revokeInvites } = await import('./members');

beforeEach(() => {
  fs.ops = [];
  fs.commit.mockReset();
  fs.updateDoc.mockReset();
});

describe('removeMember', () => {
  it('メンバーの削除と招待の一括無効化を 1 バッチで書く', async () => {
    fs.commit.mockResolvedValue();
    await removeMember('g1', 'u2', 'u1');
    expect(fs.ops).toEqual([
      ['update', 'groups/g1', { invitesValidAfter: 'SERVER_TIME' }],
      ['delete', 'groups/g1/members/u2'],
    ]);
    expect(fs.commit).toHaveBeenCalledTimes(1);
  });

  it('自分自身は外せない', async () => {
    await expect(removeMember('g1', 'u1', 'u1')).rejects.toThrow('自分自身');
    expect(fs.commit).not.toHaveBeenCalled();
  });

  it('権限が無ければ日本語のエラーにする', async () => {
    fs.commit.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(removeMember('g1', 'u2', 'u1')).rejects.toThrow('権限がありません');
  });

  it('サーバーに届かなければ「まだ反映されていない」と知らせる', async () => {
    fs.commit.mockReturnValue(new Promise<void>(() => undefined));
    await expect(removeMember('g1', 'u2', 'u1', 10)).rejects.toThrow(OFFLINE_MESSAGE);
  });
});

describe('revokeInvites', () => {
  it('groups/{gid}.invitesValidAfter をサーバーの時刻にする', async () => {
    fs.updateDoc.mockResolvedValue();
    await revokeInvites('g1');
    expect(fs.updateDoc).toHaveBeenCalledWith('groups/g1', { invitesValidAfter: 'SERVER_TIME' });
  });

  it('サーバーに届かなければエラーにする', async () => {
    fs.updateDoc.mockReturnValue(new Promise<void>(() => undefined));
    await expect(revokeInvites('g1', 10)).rejects.toThrow(OFFLINE_MESSAGE);
  });
});
