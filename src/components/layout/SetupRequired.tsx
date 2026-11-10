/*
 * Firebase の設定（.env の VITE_FIREBASE_*）が無いときに全画面で出す案内。
 * ルーターの外で表示するので、react-router のフックや Page は使わない。
 */
import styles from './SetupRequired.module.css';

const ENV_LINES = [
  'VITE_FIREBASE_API_KEY=…',
  'VITE_FIREBASE_AUTH_DOMAIN=…',
  'VITE_FIREBASE_PROJECT_ID=…',
  'VITE_FIREBASE_APP_ID=…',
  'VITE_FIREBASE_MESSAGING_SENDER_ID=…',
  'VITE_VAPID_PUBLIC_KEY=…   # 通知を使う場合（npm run gen:vapid で作成）',
];

export function SetupRequired() {
  return (
    <div className={styles.screen}>
      <main className={styles.content}>
        <h1 className={styles.title}>はじめに設定が必要です</h1>
        <p className={styles.lead}>
          このアプリはデータの保存に Firebase（無料の Spark プラン）を使います。
          Firebase の接続情報がまだ設定されていないため、利用を始められません。
          アプリを用意する人が、次の手順で設定してください。
        </p>

        <ol className={styles.steps}>
          <li>
            <h2>Firebase のプロジェクトを作る</h2>
            <p>
              <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">
                Firebase コンソール
              </a>
              に Google アカウントでログインし、プロジェクトを作成します（クレジットカードの登録は不要です）。
            </p>
          </li>
          <li>
            <h2>ログイン方法とデータベースを有効にする</h2>
            <p>
              「Authentication」で「Google」と「メール / パスワード」を有効にします。
              「Firestore Database」でデータベースを作成します。
            </p>
          </li>
          <li>
            <h2>ウェブアプリを追加して設定値をコピーする</h2>
            <p>
              「プロジェクトの設定」→「マイアプリ」でウェブアプリ（&lt;/&gt;）を追加し、表示される
              firebaseConfig の値を控えます。
            </p>
          </li>
          <li>
            <h2>.env に書き込む</h2>
            <p>
              リポジトリ直下の <code>.env.example</code> を <code>.env</code> という名前でコピーし、
              控えた値を書き込みます。
            </p>
            <pre className={styles.code}>
              <code>{ENV_LINES.join('\n')}</code>
            </pre>
          </li>
          <li>
            <h2>アプリを起動し直す</h2>
            <p>
              開発中は <code>npm run dev</code> を起動し直します。公開している場合は、
              設定値はビルド時に埋め込まれるため <code>npm run build</code> からやり直してデプロイします。
            </p>
          </li>
        </ol>

        <p className={styles.note}>
          ローカルの Firebase エミュレータで試す場合は、<code>.env</code> に{' '}
          <code>VITE_USE_EMULATORS=true</code> を書き、<code>npm run emulators</code> を起動してください。
        </p>
      </main>
    </div>
  );
}

export default SetupRequired;
