/*
 * 家族メンバーと招待（/settings/members）。F-03
 *   - メンバー一覧（自分に「あなた」、グループを作った人に「作成者」）
 *   - 「招待リンクを作る」→ createInvite → 共有シート（navigator.share）。
 *     共有シートが使えなければクリップボードにコピー。それもできなければリンクを選択できる形で表示する。
 *   - 招待リンクの有効期限は 7 日。期限内なら何人でも使える（家族の LINE グループに 1 本送る使い方のため）。
 *   - 誤って家族以外に送ったとき用に（F-07）:
 *     「これまでの招待リンクをすべて無効にする」→ revokeInvites（作ったリンクは一覧できないため、まとめて無効にする）。
 *     他のメンバーの「外す」→ removeMember（同時に招待もすべて無効になり、外した人は手元のリンクで戻れない）。
 *     どちらも確認ダイアログを出す。自分自身は外せない（別のグループの招待で移ると抜ける）。
 *   - 送るリンクには ?openExternalBrowser=1 を付ける（LINE で開いたときに、Google のログインが拒否される
 *     アプリ内ブラウザではなく Safari などで開くため）。文面にも「iPhone では Safari で開いて」と書く。
 */
import { useRef, useState } from 'react';
import type { Member, WithId } from '../../types';
import { useRequiredGroup } from '../../group/GroupProvider';
import { INVITE_VALID_DAYS, createInvite } from '../../data/invites';
import { removeMember, revokeInvites } from '../../data/members';
import { formatDate, todayString } from '../../lib/date';
import { Button, Card, ConfirmDialog, ListGroup, ListRow, Page, useToast } from '../../components/ui';
import { CopyIcon, LinkIcon, ShareIcon } from '../../components/ui/icons';
import { MemberAvatar } from './MemberAvatar';
import { inviteExpiryDate, inviteShareText, shareableInviteUrl } from './settingsLogic';
import styles from './MembersPage.module.css';

type CreatedInvite = { url: string; text: string; expiry: string };

type Delivery = 'shared' | 'copied' | 'cancelled' | 'failed';

function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 参加日（Timestamp）を表示用の日付にする */
function joinedLabel(member: WithId<Member>): string | null {
  const ms = member.joinedAt?.toMillis?.();
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return `${formatDate(todayString(new Date(ms)))}に参加`;
}

export default function MembersPage() {
  const { groupId, uid, group, members } = useRequiredGroup();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  /** 確認ダイアログ: 招待の一括無効化か、外すメンバー */
  const [confirm, setConfirm] = useState<{ kind: 'revoke' } | { kind: 'remove'; member: WithId<Member> } | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  const groupName = group?.name ?? '';

  const selectLink = () => {
    const input = linkRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
  };

  /** 共有シート → コピー → 選択して表示、の順に試す */
  const deliver = async (inv: CreatedInvite, mode: 'auto' | 'share' | 'copy'): Promise<Delivery> => {
    if (mode !== 'copy' && canShare()) {
      try {
        await navigator.share({ title: `${groupName}への招待`, text: inv.text, url: inv.url });
        return 'shared';
      } catch (e) {
        if (isAbortError(e)) return 'cancelled';
        // 時間がたって操作の扱いが切れた（NotAllowedError）など。コピーに切り替える
        console.warn('[invite] 共有シートを開けませんでした', e);
      }
    }
    if (await copyText(inv.url)) {
      toast.show('招待リンクをコピーしました。LINE やメッセージに貼り付けて家族に送ってください。', {
        tone: 'success',
        duration: 5000,
      });
      return 'copied';
    }
    if (mode === 'auto' && canShare()) {
      // 作成を待つ間に操作の扱いが切れて共有シートを開けなかった。ボタンから開き直してもらう
      toast.show('招待リンクを作りました。下の「共有する」から家族に送ってください。', { tone: 'success' });
      return 'failed';
    }
    toast.show('自動でコピーできませんでした。下のリンクを長押ししてコピーしてください。', { tone: 'error' });
    // 描画後に選択する
    setTimeout(selectLink, 50);
    return 'failed';
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createInvite(groupId, groupName, uid);
      const expiry = inviteExpiryDate();
      // LINE で開いたときに Safari などで開くよう openExternalBrowser=1 を付けて送る
      const inv: CreatedInvite = {
        url: shareableInviteUrl(created.url),
        expiry,
        text: inviteShareText(groupName, expiry),
      };
      setInvite(inv);
      await deliver(inv, 'auto');
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message ? err.message : '招待リンクを作れませんでした。もう一度お試しください。';
      toast.show(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const confirmRevoke = async () => {
    await revokeInvites(groupId); // 失敗したら ConfirmDialog がトーストを出して開いたままにする
    setConfirm(null);
    setInvite(null);
    toast.show('これまでの招待リンクを無効にしました。家族を招待するときは新しいリンクを作ってください。', {
      tone: 'success',
      duration: 5000,
    });
  };

  const confirmRemove = async (target: WithId<Member>) => {
    await removeMember(groupId, target.id, uid);
    setConfirm(null);
    setInvite(null);
    toast.show(`${target.displayName}さんをグループから外しました。これまでの招待リンクも無効になりました。`, {
      tone: 'success',
      duration: 5000,
    });
  };

  return (
    <Page title="家族メンバー" back="/settings">
      <ListGroup title={`メンバー（${members.length}人）`}>
        {members.map((m) => {
          const isMe = m.id === uid;
          const isCreator = group?.createdBy === m.id;
          const joined = joinedLabel(m);
          return (
            <ListRow
              key={m.id}
              leading={<MemberAvatar name={m.displayName} />}
              title={
                <span className={styles.memberName}>
                  {m.displayName}
                  {isMe ? <span className={styles.youBadge}>あなた</span> : null}
                </span>
              }
              subtitle={isCreator ? 'グループを作成' : joined ?? undefined}
              to={isMe ? '/settings/profile' : undefined}
              ariaLabel={isMe ? `${m.displayName}（あなた）の表示名を変更` : undefined}
              trailing={
                isMe ? undefined : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirm({ kind: 'remove', member: m })}
                    aria-label={`${m.displayName}さんをグループから外す`}
                  >
                    外す
                  </Button>
                )
              }
            />
          );
        })}
      </ListGroup>

      <section className={styles.inviteSection} aria-labelledby="invite-title">
        <h2 id="invite-title" className={styles.sectionTitle}>
          家族を招待する
        </h2>
        <Card>
          <p className={styles.inviteText}>
            招待リンクを LINE やメッセージで家族に送ります。受け取った人がリンクを開いてログインすると、このグループに参加できます。
          </p>
          <p className={styles.inviteText}>
            受け取った人は、iPhone の Safari で開くようにしてください（LINE などのアプリの中で開くと Google
            でログインできず、ホーム画面にも追加できません）。
          </p>
          <ul className={styles.notes}>
            <li>リンクの有効期限は作成から {INVITE_VALID_DAYS} 日間です。</li>
            <li>リンクを知っている人は誰でも参加できます。家族以外には送らないでください。</li>
            <li>
              誤って家族以外に送ったときは、下の「これまでの招待リンクをすべて無効にする」で使えなくできます。参加してしまった人は、上の一覧の「外す」で外せます。
            </li>
          </ul>
          <Button
            size="lg"
            block
            icon={<LinkIcon />}
            loading={busy}
            onClick={handleCreate}
            className={styles.createButton}
          >
            {invite ? '新しい招待リンクを作る' : '招待リンクを作る'}
          </Button>
        </Card>

        {invite ? (
          <Card tone="primary" className={styles.resultCard}>
            <label htmlFor="invite-link" className={styles.resultLabel}>
              招待リンク（{formatDate(invite.expiry)}まで有効）
            </label>
            <input
              id="invite-link"
              ref={linkRef}
              className={styles.linkInput}
              value={invite.url}
              readOnly
              onFocus={(e) => e.currentTarget.setSelectionRange(0, e.currentTarget.value.length)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className={styles.resultActions}>
              {canShare() ? (
                <Button variant="secondary" block icon={<ShareIcon />} onClick={() => void deliver(invite, 'share')} disabled={busy}>
                  共有する
                </Button>
              ) : null}
              <Button variant="secondary" block icon={<CopyIcon />} onClick={() => void deliver(invite, 'copy')} disabled={busy}>
                コピーする
              </Button>
            </div>
          </Card>
        ) : null}

        <ListGroup>
          <ListRow
            title="これまでの招待リンクをすべて無効にする"
            subtitle="誤って家族以外に送ったときに使います。新しいリンクはこの後も作れます"
            onClick={() => setConfirm({ kind: 'revoke' })}
            chevron={false}
            danger
          />
        </ListGroup>
      </section>

      <section className={styles.inviteSection} aria-labelledby="group-id-title">
        <h2 id="group-id-title" className={styles.sectionTitle}>
          グループ ID
        </h2>
        <Card>
          <p className={styles.inviteText}>
            毎朝の返却日の通知を、このグループに送るための設定に使います（手順書 docs/setup.md の手順 9）。
          </p>
          <p className={styles.groupId} data-testid="group-id">
            {groupId}
          </p>
          <Button
            variant="secondary"
            block
            icon={<CopyIcon />}
            onClick={() =>
              void copyText(groupId).then((ok) =>
                toast.show(ok ? 'グループ ID をコピーしました。' : 'コピーできませんでした。ID を長押しして選んでください。', {
                  tone: ok ? 'success' : 'error',
                }),
              )
            }
          >
            グループ ID をコピーする
          </Button>
        </Card>
      </section>

      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        title="これまでの招待リンクをすべて無効にしますか？"
        message="これまでに作った招待リンク（他の家族が作ったものも含む）では、だれも参加できなくなります。すでに参加している人はそのままです。"
        confirmLabel="無効にする"
        danger
        onConfirm={confirmRevoke}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={confirm?.kind === 'remove' ? `${confirm.member.displayName}さんをグループから外しますか？` : ''}
        message={
          <>
            外すと、この人はグループの本や貸出記録を見られなくなり、返却日の通知も届かなくなります。
            <br />
            また、これまでの招待リンクもすべて無効になります（外した人が同じリンクで戻れないようにするため）。家族を招待するときは新しいリンクを作ってください。
          </>
        }
        confirmLabel="外す"
        danger
        onConfirm={() => (confirm?.kind === 'remove' ? confirmRemove(confirm.member) : undefined)}
        onCancel={() => setConfirm(null)}
      />
    </Page>
  );
}
