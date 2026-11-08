/**
 * 毎朝の返却日通知（GitHub Actions から日本時間 7:45 ごろに実行）。
 *
 *   npx tsx scripts/notify/index.ts [--dry-run] [--today YYYY-MM-DD]
 *
 * 全グループの貸出中の本を調べ、延滞・明日返却・3日後に返却の本があれば、
 * そのグループのメンバーの全端末に Web Push を 1 通送る。
 * 1 グループの失敗で全体は止めない。失敗が 1 件でもあれば終了コード 1。
 */
import {
  ConfigError,
  parseArgs,
  readAppUrl,
  readFirebaseTarget,
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
import { configureVapid, describeSubscription, sendPush } from './send';
import type { DateString } from '../../src/types';

interface RunSettings {
  options: CliOptions;
  target: FirebaseTarget;
  today: DateString;
  appUrl: string;
  proxy: string | undefined;
}

interface Stats {
  groups: number;
  notifiedGroups: number;
  sent: number;
  removed: number;
  failed: number;
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
  };
}

async function processGroup(ctx: AdminContext, groupId: string, settings: RunSettings, stats: Stats): Promise<void> {
  const label = `[${groupId}]`;
  const data = await loadGroupData(ctx.db, groupId);
  if (data.skippedDocs > 0) {
    console.warn(`${label} 形式が正しくないドキュメントを ${data.skippedDocs} 件読み飛ばしました`);
  }

  const notification = buildGroupNotification(data.loans, data.locationsById, settings.today);
  if (!notification) {
    console.log(`${label} 通知対象なし（貸出中 ${data.loans.length} 冊）`);
    return;
  }
  stats.notifiedGroups++;
  console.log(`${label} 通知内容:\n${indent(notification.body)}`);

  // 退会などでメンバーでなくなった人の端末には送らない
  const targets = data.subscriptions.filter((sub) => data.memberUids.has(sub.uid));
  const skipped = data.subscriptions.length - targets.length;
  if (skipped > 0) console.log(`${label} メンバー以外の購読 ${skipped} 件には送りません`);
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
  const results = await Promise.all(
    targets.map(async (sub) => ({ sub, outcome: await sendPush(sub, payload, { proxy: settings.proxy }) })),
  );
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

  const stats: Stats = { groups: 0, notifiedGroups: 0, sent: 0, removed: 0, failed: 0 };
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
    try {
      groupIds = await listGroupIds(ctx.db);
    } catch (e) {
      console.error(`グループの一覧を読めませんでした: ${errorMessage(e)}`);
      return 1;
    }
    stats.groups = groupIds.length;
    for (const groupId of groupIds) {
      try {
        await processGroup(ctx, groupId, settings, stats);
      } catch (e) {
        stats.failed++;
        console.error(`[${groupId}] 処理に失敗しました: ${errorMessage(e)}`);
      }
    }
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
  if (stats.failed > 0) console.error(`失敗が ${stats.failed} 件ありました`);
  return stats.failed > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error('通知の処理が異常終了しました:', e);
    process.exitCode = 1;
  },
);
