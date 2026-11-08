/**
 * 毎朝の返却日通知（GitHub Actions から日本時間 7:45 ごろに実行）。
 *
 *   npx tsx scripts/notify/index.ts [--dry-run] [--today YYYY-MM-DD]
 *
 * NOTIFY_GROUP_IDS のグループ（未設定なら全グループ）の貸出中の本を調べ、延滞・明日返却・3日後に返却の本があれば、
 * そのグループのメンバーの端末に Web Push を 1 通ずつ送る。
 * 1 グループの失敗・遅れで全体は止めない（グループは GROUP_CONCURRENCY 個ずつ並行に処理し、
 * 1 件の送信には締め切りがある）。失敗が 1 件でもあれば終了コード 1。
 * 送れない購読（対応していない送信先・鍵の形式の誤り）は読み飛ばして警告だけ出す（失敗に数えない）。
 */
import {
  ConfigError,
  parseArgs,
  readAppUrl,
  readFirebaseTarget,
  readGroupAllowlist,
  readProxy,
  readVapidConfig,
  type CliOptions,
  type FirebaseTarget,
} from './config';
import {
  closeFirestore,
  deleteSubscription,
  listGroupIds,
  loadGroupData,
  openFirestore,
  type AdminContext,
} from './firestore';
import { buildGroupNotification, buildPushPayload, tokyoToday } from './messages';
import { configureVapid, describeSubscription, mapWithConcurrency, sendPush } from './send';
import { MAX_SUBSCRIPTIONS_PER_GROUP, selectTargets } from './subscription';
import type { DateString } from '../../src/types';

interface RunSettings {
  options: CliOptions;
  target: FirebaseTarget;
  today: DateString;
  appUrl: string;
  proxy: string | undefined;
  /** 通知するグループ（null なら全グループ） */
  groupAllowlist: string[] | null;
}

/** 同時に処理するグループの数（1 グループの送信が遅れても他のグループを待たせない） */
const GROUP_CONCURRENCY = 4;
/** 1 グループの中で同時に送る数 */
const SEND_CONCURRENCY = 5;

interface Stats {
  groups: number;
  notifiedGroups: number;
  sent: number;
  removed: number;
  failed: number;
  /** 送らずに読み飛ばした購読（対応していない送信先・鍵の誤り・上限超え） */
  skippedSubscriptions: number;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function indent(text: string, prefix = '    '): string {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

/** 引数と環境変数を読む。誤りがあれば ConfigError */
function readSettings(argv: readonly string[], env: NodeJS.ProcessEnv): RunSettings {
  const options = parseArgs(argv);
  const target = readFirebaseTarget(env);
  const appUrl = readAppUrl(env);
  // dry-run では送信しないので VAPID 鍵は不要
  if (!options.dryRun) configureVapid(readVapidConfig(env));
  return {
    options,
    target,
    today: options.today ?? tokyoToday(),
    appUrl,
    proxy: readProxy(env),
    groupAllowlist: readGroupAllowlist(env),
  };
}

/** ログに出す利用者の入力（改行・制御文字を空白にし、長さを抑える） */
function forLog(text: string, max = 50): string {
  const oneLine = text.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function processGroup(ctx: AdminContext, groupId: string, settings: RunSettings, stats: Stats): Promise<void> {
  const label = `[${groupId}]`;
  const data = await loadGroupData(ctx.db, groupId);
  if (!data.exists) {
    stats.failed++;
    console.error(`${label} グループが見つかりません（NOTIFY_GROUP_IDS のグループ ID を確認してください）`);
    return;
  }
  console.log(`${label} グループ「${data.groupName ? forLog(data.groupName) : '（名前なし）'}」`);
  if (data.skippedDocs > 0) {
    console.warn(`${label} 形式が正しくないドキュメントを ${data.skippedDocs} 件読み飛ばしました`);
  }
  if (data.skippedSubscriptions > 0) {
    stats.skippedSubscriptions += data.skippedSubscriptions;
    console.warn(
      `${label} 送れない購読（対応していない送信先・形式の正しくない鍵）を ${data.skippedSubscriptions} 件読み飛ばしました`,
    );
  }

  const notification = buildGroupNotification(data.loans, data.locationsById, settings.today);
  if (!notification) {
    console.log(`${label} 通知対象なし（貸出中 ${data.loans.length} 冊）`);
    return;
  }
  stats.notifiedGroups++;
  console.log(`${label} 通知内容:\n${indent(notification.body)}`);

  // 退会などでメンバーでなくなった人の端末には送らない。数が多すぎるときは新しいものから上限まで
  const { targets, nonMembers, overLimit } = selectTargets(data.subscriptions, data.memberUids);
  if (nonMembers > 0) console.log(`${label} メンバー以外の購読 ${nonMembers} 件には送りません`);
  if (overLimit > 0) {
    stats.skippedSubscriptions += overLimit;
    console.warn(`${label} 購読が多すぎるため、古い ${overLimit} 件には送りません（上限 ${MAX_SUBSCRIPTIONS_PER_GROUP} 件）`);
  }
  if (targets.length === 0) {
    console.log(`${label} 通知を受け取る端末が登録されていません`);
    return;
  }

  if (settings.options.dryRun) {
    console.log(`${label} 送信予定 ${targets.length} 件（dry-run のため送信しません）`);
    for (const sub of targets) console.log(`    - ${describeSubscription(sub)}`);
    return;
  }

  const payload = buildPushPayload(notification, settings.appUrl);
  const results = await mapWithConcurrency(targets, SEND_CONCURRENCY, async (sub) => ({
    sub,
    outcome: await sendPush(sub, payload, { proxy: settings.proxy }),
  }));
  for (const { sub, outcome } of results) {
    const who = describeSubscription(sub);
    switch (outcome.kind) {
      case 'sent':
        stats.sent++;
        console.log(`${label} 送信しました: ${who}`);
        break;
      case 'gone':
        try {
          await deleteSubscription(ctx.db, groupId, sub.id);
          stats.removed++;
          console.log(`${label} 無効な購読を削除しました（HTTP ${outcome.statusCode}）: ${who}`);
        } catch (e) {
          stats.failed++;
          console.error(`${label} 無効な購読の削除に失敗しました: ${who}: ${errorMessage(e)}`);
        }
        break;
      case 'failed':
        stats.failed++;
        console.error(`${label} 送信に失敗しました: ${who}: ${outcome.message}`);
        break;
    }
  }
}

/** NOTIFY_GROUP_IDS が未設定のときの警告（GitHub Actions では実行結果の画面にも出す） */
function warnNoAllowlist(): void {
  const message =
    'NOTIFY_GROUP_IDS が設定されていないため、すべてのグループを処理します。家族以外の人が作ったグループにも送信するので、' +
    'GitHub の Variables に NOTIFY_GROUP_IDS（ログの [ ] 内のグループ ID）を登録してください（docs/setup.md 手順 7）。';
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning::${message}`);
  else console.warn(`警告: ${message}`);
}

async function main(): Promise<number> {
  let settings: RunSettings;
  try {
    settings = readSettings(process.argv.slice(2), process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`設定エラー: ${e.message}`);
      return 1;
    }
    throw e;
  }

  const mode = settings.options.dryRun ? '（dry-run: 送信・削除はしません）' : '';
  const where = settings.target.kind === 'emulator' ? `エミュレータ ${settings.target.host}` : '本番';
  console.log(`返却日の通知: ${settings.today}（日本時間）${mode}`);

  const stats: Stats = { groups: 0, notifiedGroups: 0, sent: 0, removed: 0, failed: 0, skippedSubscriptions: 0 };
  let ctx: AdminContext;
  try {
    ctx = openFirestore(settings.target);
  } catch (e) {
    console.error(`Firebase の初期化に失敗しました（FIREBASE_SERVICE_ACCOUNT の内容を確認してください）: ${errorMessage(e)}`);
    return 1;
  }
  console.log(`Firestore: ${ctx.projectId}（${where}）`);
  try {
    let groupIds: string[];
    if (settings.groupAllowlist) {
      groupIds = settings.groupAllowlist;
      console.log(`通知するグループ: ${groupIds.length} 件（NOTIFY_GROUP_IDS）`);
    } else {
      warnNoAllowlist();
      try {
        groupIds = await listGroupIds(ctx.db);
      } catch (e) {
        console.error(`グループの一覧を読めませんでした: ${errorMessage(e)}`);
        return 1;
      }
    }
    stats.groups = groupIds.length;
    await mapWithConcurrency(groupIds, GROUP_CONCURRENCY, async (groupId) => {
      try {
        await processGroup(ctx, groupId, settings, stats);
      } catch (e) {
        stats.failed++;
        console.error(`[${groupId}] 処理に失敗しました: ${errorMessage(e)}`);
      }
    });
  } finally {
    await closeFirestore(ctx).catch(() => undefined);
  }

  console.log('--- 結果 ---');
  console.log(`グループ: ${stats.groups}（通知対象 ${stats.notifiedGroups}）`);
  if (settings.options.dryRun) {
    console.log('dry-run のため送信していません');
  } else {
    console.log(`送信成功: ${stats.sent} / 削除した購読: ${stats.removed} / 失敗: ${stats.failed}`);
  }
  if (stats.skippedSubscriptions > 0) {
    console.warn(`送らずに読み飛ばした購読: ${stats.skippedSubscriptions}（失敗には数えません）`);
  }
  if (!settings.groupAllowlist) warnNoAllowlist();
  if (stats.failed > 0) console.error(`失敗が ${stats.failed} 件ありました`);
  return stats.failed > 0 ? 1 : 0;
}

/** 終わった後も接続などが残ってプロセスが終わらないときに、強制的に終了するまでの時間 */
const EXIT_GRACE_MS = 5_000;

function finish(code: number): void {
  process.exitCode = code;
  // 通常はこのまま終わる。打ち切った送信の接続などが残っていても、ジョブを止めたままにしない
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
}

main().then(finish, (e: unknown) => {
  console.error('通知の処理が異常終了しました:', e);
  finish(1);
});
