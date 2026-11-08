/**
 * メンバーを外す・招待をすべて無効にする（F-07）。
 *
 * 招待リンクは期限内なら何人でも使えるため、誤って家族以外に送った・転送された場合に備える。
 * 招待は一覧できない（firestore.rules の invites は list 不可）ので、1 本ずつ消すのではなく
 * groups/{gid}.invitesValidAfter を今の時刻にして、それより前に作られた招待をまとめて無効にする。
 * 他のメンバーを外すときも同じ書き込みで招待を無効にする（外した人が手元のリンクで戻れないように。ルールで必須）。
 */
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { toDataError } from './common';

/** サーバーの応答を待つ最大時間 */
const SERVER_TIMEOUT_MS = 15_000;

export const OFFLINE_MESSAGE =
  '通信できないため、まだ反映されていません。電波の良い場所でこの画面を開き直し、反映されたか確認してください。';

/**
 * 書き込みがサーバーに届くまで待つ（安全のための操作なので、端末に保存しただけでは完了にしない）。
 * 時間内に届かなければ、書き込みは端末に残して後で送られるが、利用者には未反映として知らせる。
 */
async function awaitServer(write: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(OFFLINE_MESSAGE)), timeoutMs);
  });
  try {
    await Promise.race([write, timeout]);
  } catch (e) {
    write.catch(() => undefined);
    throw toDataError(e);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** これまでに作った招待リンクをすべて無効にする（これより後に作ったリンクは使える） */
export async function revokeInvites(gid: string, timeoutMs: number = SERVER_TIMEOUT_MS): Promise<void> {
  await awaitServer(updateDoc(doc(db, 'groups', gid), { invitesValidAfter: serverTimestamp() }), timeoutMs);
}

/**
 * 他のメンバーをグループから外す。同じバッチで招待をすべて無効にする。
 * 外された人はグループのデータを読めなくなり（アプリは未参加の画面に戻る）、通知も届かなくなる
 * （通知スクリプトは members にいる人の購読にだけ送る）。
 * 自分自身は外せない（別のグループの招待で移るときに抜ける＝GroupProvider.joinGroup）。
 */
export async function removeMember(
  gid: string,
  memberUid: string,
  selfUid: string,
  timeoutMs: number = SERVER_TIMEOUT_MS,
): Promise<void> {
  if (memberUid === selfUid) throw new Error('自分自身はここでは外せません。');
  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', gid), { invitesValidAfter: serverTimestamp() });
  batch.delete(doc(db, 'groups', gid, 'members', memberUid));
  await awaitServer(batch.commit(), timeoutMs);
}
