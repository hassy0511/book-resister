/*
 * 返却日の通知（/settings/notifications）。F-100〜F-105
 * この端末の通知の状態（getPushState）に応じて表示を切り替える。
 *   needs-install … iPhone で「ホーム画面に追加」する手順（図解）
 *   off           … 「通知をオンにする」（enablePush はクリック処理の中で直接呼ぶ。iOS の許可ダイアログのため）
 *   on            … テスト通知、オフにする
 *   denied        … 設定アプリで許可する手順
 *   unsupported   … 対応していない旨
 * 下に通知の内容（3 日前・前日・延滞中は毎朝、8 時ごろ、家族全員）を説明する。
 * アプリ名は、ホーム画面のアイコンと「設定」>「通知」の一覧に出る名前（HOME_SCREEN_APP_NAME）で案内する。
 */
import { useState, type ReactNode } from 'react';
import { useRequiredGroup } from '../../group/GroupProvider';
import { disablePush, enablePush, isIos, showTestNotification, type PushState } from '../../lib/push';
import { Button, Card, Page, Spinner, useToast } from '../../components/ui';
import { detectInAppBrowser } from '../../components/inAppBrowser';
import {
  AlertIcon,
  BellIcon,
  BellOffIcon,
  BookIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  MoreIcon,
  PlusSquareIcon,
  RefreshIcon,
  SettingsIcon,
  ShareIcon,
  UsersIcon,
} from '../../components/ui/icons';
import { usePushState } from './usePushState';
import styles from './NotificationsPage.module.css';

type Busy = 'enable' | 'disable' | 'test' | null;

/**
 * ホーム画面に追加したときの既定の名前（index.html の apple-mobile-web-app-title、manifest の short_name と同じ）。
 * iPhone の「設定」>「通知」の一覧にもこの名前で出る。正式名（かりた本ノート）とは違うので注意。
 */
const HOME_SCREEN_APP_NAME = 'かりた本';

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function NotificationsPage() {
  const { groupId, uid } = useRequiredGroup();
  const toast = useToast();
  const { state, refresh } = usePushState();
  const [busy, setBusy] = useState<Busy>(null);

  const finish = () => {
    setBusy(null);
    void refresh();
  };

  const handleEnable = () => {
    if (busy) return;
    setBusy('enable');
    // iPhone では許可のダイアログがボタン操作の中でしか出ないため、ここで await を挟まずに呼ぶ
    enablePush(groupId, uid)
      .then(
        () => toast.show('通知をオンにしました。「テスト通知を送る」で届くか確かめられます。', { tone: 'success' }),
        (e: unknown) => {
          console.error(e);
          toast.show(errorText(e, '通知をオンにできませんでした。もう一度お試しください。'), { tone: 'error', duration: 8000 });
        },
      )
      .finally(finish);
  };

  const handleDisable = () => {
    if (busy) return;
    setBusy('disable');
    disablePush(groupId)
      .then(
        () => toast.show('この端末の通知をオフにしました'),
        (e: unknown) => {
          console.error(e);
          toast.show(errorText(e, '通知をオフにできませんでした。もう一度お試しください。'), { tone: 'error' });
        },
      )
      .finally(finish);
  };

  const handleTest = () => {
    if (busy) return;
    setBusy('test');
    showTestNotification()
      .then(
        () =>
          toast.show('テスト通知を送りました。届かないときは、集中モードや設定アプリの通知の設定を確認してください。', {
            duration: 6000,
          }),
        (e: unknown) => {
          console.error(e);
          toast.show(errorText(e, 'テスト通知を送れませんでした。'), { tone: 'error' });
        },
      )
      .finally(finish);
  };

  return (
    <Page title="返却日の通知" back="/settings">
      {state === null ? (
        <Spinner size="lg" center showLabel label="通知の状態を確認しています" />
      ) : (
        <StateSection
          state={state}
          busy={busy}
          onEnable={handleEnable}
          onDisable={handleDisable}
          onTest={handleTest}
          onRecheck={() => void refresh()}
        />
      )}
      <AboutNotifications />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 状態ごとの表示
// ---------------------------------------------------------------------------

type StateSectionProps = {
  state: PushState;
  busy: Busy;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
  onRecheck: () => void;
};

function StatusHead({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className={styles.statusHead}>
      <span className={styles.statusIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.statusText}>
        <h2 className={styles.statusTitle}>{title}</h2>
        {children ? <p className={styles.statusDesc}>{children}</p> : null}
      </div>
    </div>
  );
}

function StateSection({ state, busy, onEnable, onDisable, onTest, onRecheck }: StateSectionProps) {
  switch (state) {
    case 'on':
      return (
        <Card tone="primary" className={styles.statusCard}>
          <StatusHead icon={<BellIcon size={26} />} title="通知はオンです">
            この端末に、返却日のお知らせが届きます。
          </StatusHead>
          <div className={styles.actions}>
            <Button variant="secondary" block icon={<BellIcon />} loading={busy === 'test'} disabled={busy !== null} onClick={onTest}>
              テスト通知を送る
            </Button>
            <Button variant="ghost" block loading={busy === 'disable'} disabled={busy !== null} onClick={onDisable}>
              この端末の通知をオフにする
            </Button>
          </div>
        </Card>
      );

    case 'off':
      return (
        <Card className={styles.statusCard}>
          <StatusHead icon={<BellOffIcon size={26} />} title="通知はオフです">
            オンにすると、返却日が近い本や返却日を過ぎた本をこの端末にお知らせします。
          </StatusHead>
          <div className={styles.actions}>
            <Button size="lg" block icon={<BellIcon />} loading={busy === 'enable'} disabled={busy !== null} onClick={onEnable}>
              通知をオンにする
            </Button>
            <p className={styles.actionHint}>ボタンを押すと通知の許可を求められます。「許可」を選んでください。</p>
          </div>
        </Card>
      );

    case 'needs-install':
      return (
        <>
          <Card tone="warning" className={styles.statusCard}>
            <StatusHead icon={<BellOffIcon size={26} />} title="ホーム画面に追加すると通知を受け取れます">
              iPhone では、Safari から「ホーム画面に追加」したアプリでだけ通知を受け取れます（iOS 16.4 以上）。
            </StatusHead>
            <InAppBrowserHint />
          </Card>
          <InstallGuide />
        </>
      );

    case 'denied':
      return (
        <>
          <Card tone="danger" className={styles.statusCard}>
            <StatusHead icon={<BellOffIcon size={26} />} title="通知がブロックされています">
              {isIos()
                ? 'このアプリからの通知が許可されていません。iPhone の「設定」アプリで許可してください。'
                : 'このサイトからの通知が許可されていません。ブラウザのサイトの設定で、通知を「許可」にしてください。'}
            </StatusHead>
          </Card>
          {isIos() ? <DeniedGuide /> : null}
          <Button variant="secondary" block icon={<RefreshIcon />} onClick={onRecheck} className={styles.recheck}>
            状態を確認し直す
          </Button>
        </>
      );

    case 'unsupported':
    default:
      return (
        <Card className={styles.statusCard}>
          <StatusHead icon={<AlertIcon size={26} />} title="この端末では通知を使えません">
            このブラウザはプッシュ通知に対応していません。iPhone の場合は iOS 16.4 以上に更新し（「設定」→「一般」→「ソフトウェアアップデート」）、Safari
            でホーム画面に追加してください。
          </StatusHead>
        </Card>
      );
  }
}

/** LINE などのアプリ内ブラウザでは共有ボタンが無く「ホーム画面に追加」できないので、先に Safari で開くよう伝える */
function InAppBrowserHint() {
  const [app] = useState(() => detectInAppBrowser());
  if (!app) return null;
  return (
    <p className={styles.inAppHint}>
      いまは {app} の中のブラウザで開いています。ここからはホーム画面に追加できません。先に画面のメニュー（「…」など）から「Safari
      で開く」を選び、Safari で次の手順を行ってください。
    </p>
  );
}

// ---------------------------------------------------------------------------
// ホーム画面に追加する手順（図解）
// ---------------------------------------------------------------------------

function Step({ num, title, children, figure }: { num: number; title: ReactNode; children?: ReactNode; figure?: ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={styles.stepNum} aria-hidden="true">
        {num}
      </span>
      <div className={styles.stepBody}>
        <p className={styles.stepTitle}>{title}</p>
        {children ? <p className={styles.stepText}>{children}</p> : null}
        {figure ? (
          <div className={styles.figure} aria-hidden="true">
            {figure}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function InstallGuide() {
  return (
    <section className={styles.guide} aria-labelledby="install-title">
      <h2 id="install-title" className={styles.sectionTitle}>
        ホーム画面に追加する手順
      </h2>
      <ol className={styles.steps}>
        <Step
          num={1}
          title={
            <>
              Safari で画面下の <ShareIcon size={18} className={styles.inlineIcon} title="共有" /> 共有ボタンをタップ
            </>
          }
          figure={
            <div className={styles.mockToolbar}>
              <ChevronLeftIcon size={22} />
              <ChevronRightIcon size={22} />
              <span className={styles.mockHighlight}>
                <ShareIcon size={22} />
              </span>
              <BookIcon size={22} />
              <CopyIcon size={22} />
            </div>
          }
        >
          四角から矢印が出ているマークです。見つからないときは <MoreIcon size={16} className={styles.inlineIcon} title="その他" />
          （…）をタップしてから「共有」を選びます。
        </Step>
        <Step
          num={2}
          title="「ホーム画面に追加」をタップ"
          figure={
            <div className={styles.mockMenu}>
              <span className={styles.mockMenuRow}>
                <span>ブックマークを追加</span>
              </span>
              <span className={`${styles.mockMenuRow} ${styles.mockMenuActive}`}>
                <span>ホーム画面に追加</span>
                <PlusSquareIcon size={20} />
              </span>
            </div>
          }
        >
          メニューを上にスワイプすると出てきます。見つからないときは「さらに表示」の中を探してください。
        </Step>
        <Step
          num={3}
          title="右上の「追加」をタップ"
          figure={
            <div className={styles.mockSheetHeader}>
              <span className={styles.mockCancel}>キャンセル</span>
              <span className={styles.mockSheetTitle}>ホーム画面に追加</span>
              <span className={styles.mockAdd}>追加</span>
            </div>
          }
        >
          「Web アプリとして開く」が表示されたら、オンのままにします。
        </Step>
        <Step
          num={4}
          title="ホーム画面のアイコンから開く"
          figure={
            <div className={styles.mockHome}>
              <span className={styles.mockAppIcon}>
                <BookIcon size={28} />
              </span>
              <span className={styles.mockAppName}>{HOME_SCREEN_APP_NAME}</span>
            </div>
          }
        >
          ホーム画面のアプリは Safari とは別なので、もう一度ログインしてください。
        </Step>
        <Step num={5} title="「設定」→「返却日の通知」で「通知をオンにする」を押す">
          通知の許可を求められたら「許可」を選びます。
        </Step>
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 通知がブロックされているときの手順（iPhone）
// ---------------------------------------------------------------------------

function DeniedGuide() {
  return (
    <section className={styles.guide} aria-labelledby="denied-title">
      <h2 id="denied-title" className={styles.sectionTitle}>
        iPhone で通知を許可する手順
      </h2>
      <ol className={styles.steps}>
        <Step
          num={1}
          title={
            <>
              ホーム画面から <SettingsIcon size={18} className={styles.inlineIcon} title="設定" />「設定」アプリを開く
            </>
          }
        />
        <Step num={2} title="「通知」をタップ" />
        <Step num={3} title={`一覧から「${HOME_SCREEN_APP_NAME}」をタップ`}>
          ホーム画面のアイコンの下に出ている名前です。追加するときに名前を変えた場合は、その名前を探してください。
        </Step>
        <Step
          num={4}
          title="「通知を許可」をオンにする"
          figure={
            <div className={styles.mockSwitchRow}>
              <span>通知を許可</span>
              <span className={styles.mockSwitch} />
            </div>
          }
        />
        <Step num={5} title="このアプリに戻る">
          戻ると自動で状態を確認します。
        </Step>
      </ol>

      <h3 className={`${styles.sectionTitle} ${styles.troubleTitle}`}>一覧に見つからないとき</h3>
      <ol className={styles.trouble}>
        <li>
          ホーム画面のアイコンの下に出ている名前で探してください（ふつうは「{HOME_SCREEN_APP_NAME}」。追加するときに変えた場合はその名前）。
        </li>
        <li>この画面を Safari ではなく、ホーム画面のアイコンから開いているか確かめてください。</li>
        <li>
          {'それでも見つからないときだけ、ホーム画面のアイコンを削除して、もう一度ホーム画面に追加してください。' +
            '削除するとログインと通知の設定が消えるので、ログインと「通知をオンにする」をやり直す必要があります。' +
            '電波の無いところで登録・返却した内容がまだ送られていないと消えることがあるので、' +
            '先にインターネットにつながる場所でこのアプリを開いてから削除してください。'}
        </li>
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 通知の内容
// ---------------------------------------------------------------------------

function AboutItem({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <li className={styles.aboutItem}>
      <span className={styles.aboutIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className={styles.aboutTitle}>{title}</p>
        {children ? <p className={styles.aboutText}>{children}</p> : null}
      </div>
    </li>
  );
}

function AboutNotifications() {
  return (
    <section className={styles.about} aria-labelledby="about-title">
      <h2 id="about-title" className={styles.sectionTitle}>
        届くお知らせ
      </h2>
      <Card>
        <ul className={styles.aboutList}>
          <AboutItem icon={<CalendarIcon size={22} />} title="返却日の 3 日前と前日">
            「明日返却：〇〇図書館 3冊」のようにお知らせします。
          </AboutItem>
          <AboutItem icon={<AlertIcon size={22} />} title="返却日を過ぎた本は毎朝">
            返却するまで、毎朝お知らせします。返却済みの本はお知らせしません。
          </AboutItem>
          <AboutItem icon={<ClockIcon size={22} />} title="毎朝 8 時ごろ">
            仕組みの都合で、数十分ずれることがあります。同じ日のお知らせは 1 通にまとめます。
          </AboutItem>
          <AboutItem icon={<UsersIcon size={22} />} title="家族全員に届きます">
            誰が借りた本でも、通知をオンにした家族全員の端末に届きます。
          </AboutItem>
          <AboutItem icon={<CheckCircleIcon size={22} />} title="端末ごとに設定します">
            家族それぞれの iPhone で、この画面から通知をオンにしてください。
          </AboutItem>
        </ul>
      </Card>
    </section>
  );
}
