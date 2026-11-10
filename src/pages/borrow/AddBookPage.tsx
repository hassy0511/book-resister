/*
 * バーコードがない本の追加（F-23）。
 *   - タイトル（＋著者）で書誌を検索し、タップで借りる本のリストに追加する。
 *     検索はタイトルだけで行い、著者は一致するものを先に並べるのに使う（書誌 API が書名での検索のため）。
 *   - グループ内の本（以前に登録した本）も、タイトルの部分一致で上に出す（もう一度借りる場合）。
 *   - 見つからない場合は手入力（タイトル必須、著者・出版社・シリーズ名・巻数）。シリーズはタイトルから推定する。
 *   - 検索欄に ISBN（奥付の番号など）を入れて見つからなかった場合は、手入力ではなく「ISBN で追加する」
 *     （cart.addIsbn。バーコードを読んだときと同じ扱いで、タイトルは確認画面で入力）にして ISBN を捨てない。
 *     ISBN を付けておけば、あとでバーコードを読んだときに同じ本として見つかる。
 *   - 追加したら「借りる内容の確認へ」か「続けて追加」を選ぶ。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '../../components/BookCover';
import { SeriesPicker, type SeriesPickerValue } from '../../components/SeriesPicker';
import {
  Button,
  Card,
  EmptyState,
  LinkButton,
  Page,
  Sheet,
  Spinner,
  TextField,
} from '../../components/ui';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EditIcon,
  HistoryIcon,
  PlusIcon,
  SearchIcon,
} from '../../components/ui/icons';
import { useBooks } from '../../data/books';
import { searchByTitleDetailed } from '../../lib/bookLookup';
import { formatIsbn } from '../../lib/isbn';
import { guessSeries } from '../../lib/series';
import { useBorrowCart } from '../../state/borrowCart';
import { findDuplicate } from '../../state/borrowCartLogic';
import type { Book, BookCandidate, WithId } from '../../types';
import {
  isbnFromSearchQuery,
  matchExistingBooks,
  matchesAuthor,
  normalizeForSearch,
  rankByAuthor,
  splitAuthors,
} from './borrowLogic';
import styles from './AddBookPage.module.css';

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | {
      status: 'done';
      query: string;
      author: string;
      results: BookCandidate[];
      /** 検索語が ISBN として読めたときの ISBN-13 */
      isbn: string | null;
      /** 0 件で、検索サービスとの通信に失敗した（見つからないのか確かめられなかった） */
      failed: boolean;
    };

type AddedState = { title: string; result: 'added' | 'duplicate'; note?: string };

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export default function AddBookPage() {
  const navigate = useNavigate();
  const cart = useBorrowCart();
  const booksQuery = useBooks();

  // ---- 検索 ----
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runSearch = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = title.trim();
    if (!q) {
      setTitleError('タイトルを入力してください');
      return;
    }
    setTitleError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearch({ status: 'loading', query: q });
    // キーボードを閉じて結果を見やすくする
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    let results: BookCandidate[] = [];
    let failed = false;
    try {
      const res = await searchByTitleDetailed(q, { signal: controller.signal });
      results = res.candidates;
      failed = res.failed;
    } catch {
      results = [];
      failed = true;
    }
    if (controller.signal.aborted) return;
    setSearch({
      status: 'done',
      query: q,
      author: author.trim(),
      results: rankByAuthor(results, author),
      isbn: isbnFromSearchQuery(q),
      failed: failed || isOffline(),
    });
  };

  // グループ内の本（タイトルの部分一致）
  const existingMatches = useMemo(
    () => matchExistingBooks(booksQuery.data, title, author),
    [booksQuery.data, title, author],
  );

  // ---- 追加後の確認 ----
  const [added, setAdded] = useState<AddedState | null>(null);
  const [addedOpen, setAddedOpen] = useState(false);

  const showAdded = (state: AddedState) => {
    setAdded(state);
    setAddedOpen(true);
  };

  const addCandidate = (c: BookCandidate): boolean => {
    const result = cart.addCandidate(c);
    showAdded({ title: c.title, result });
    return result === 'added';
  };

  const addExisting = (book: WithId<Book>) => {
    const result = cart.addExistingBook(book);
    showAdded({ title: book.title, result });
  };

  /** 見つからなかった ISBN を、バーコードを読んだときと同じ扱いで追加する（タイトルは確認画面で入力） */
  const addIsbn = (isbn: string) => {
    const result = cart.addIsbn(isbn);
    showAdded({
      title: `ISBN ${formatIsbn(isbn)}`,
      result,
      note: result === 'added' ? '本の情報が見つからなければ、借りる内容の確認画面でタイトルを入力してください。' : undefined,
    });
  };

  const inCartCandidate = (c: BookCandidate) =>
    findDuplicate(cart.items, { isbn: c.isbn, titleWithoutIsbn: c.isbn ? null : c.title }) !== null;
  const inCartBook = (b: WithId<Book>) => findDuplicate(cart.items, { isbn: b.isbn, bookId: b.id }) !== null;

  // ---- 手入力 ----
  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState('');
  const [mAuthor, setMAuthor] = useState('');
  const [mPublisher, setMPublisher] = useState('');
  const [mTitleError, setMTitleError] = useState<string | null>(null);
  const [mSeries, setMSeries] = useState<SeriesPickerValue>({ seriesName: null, volume: null });
  const [seriesTouched, setSeriesTouched] = useState(false);
  const manualRef = useRef<HTMLDivElement | null>(null);

  // シリーズ名・巻数は、手で直すまではタイトルから推定した値を使う
  const guessed = useMemo(() => guessSeries(mTitle), [mTitle]);
  const seriesValue: SeriesPickerValue = seriesTouched ? mSeries : guessed;

  const openManual = () => {
    // ISBN の数字はタイトルとして写さない（ISBN を残すには「ISBN で追加する」を使う）
    if (!mTitle.trim() && title.trim() && !isbnFromSearchQuery(title)) setMTitle(title.trim());
    if (!mAuthor.trim() && author.trim()) setMAuthor(author.trim());
    setManualOpen(true);
    window.setTimeout(() => manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const resetManual = () => {
    setMTitle('');
    setMAuthor('');
    setMPublisher('');
    setMTitleError(null);
    setMSeries({ seriesName: null, volume: null });
    setSeriesTouched(false);
  };

  const submitManual = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const t = mTitle.trim();
    if (!t) {
      setMTitleError('タイトルを入力してください');
      return;
    }
    const candidate: BookCandidate = {
      isbn: null,
      title: t,
      authors: splitAuthors(mAuthor),
      publisher: mPublisher.trim() || null,
      coverUrl: null,
      seriesName: seriesValue.seriesName?.trim() || null,
      volume: seriesValue.volume,
      source: 'manual',
    };
    if (addCandidate(candidate)) resetManual();
  };

  // ---- 表示 ----
  const count = cart.items.length;

  let resultsView = null;
  if (search.status === 'loading') {
    resultsView = <Spinner center size="lg" showLabel label="図書館などの情報から探しています…" />;
  } else if (search.status === 'done') {
    const authorHits = search.author ? search.results.filter((c) => matchesAuthor(c.authors, search.author)).length : 0;
    const notFoundIsbn = search.isbn;
    resultsView =
      search.results.length === 0 && notFoundIsbn ? (
        <EmptyState
          icon={<SearchIcon />}
          title={search.failed ? '検索サービスにつながりませんでした' : `「${search.query}」は見つかりませんでした`}
          description={
            <>
              {search.failed
                ? '電波のよい場所でもう一度検索できます。'
                : '図書館などの情報にまだ無い本のようです。'}
              ISBN の本として追加すると、タイトルは借りる内容の確認画面で入力できます（本の情報の再取得もできます）。ISBN
              を付けておくと、あとでバーコードを読んだときに同じ本として見つかります。
            </>
          }
          action={
            <Button variant="secondary" icon={<PlusIcon />} onClick={() => addIsbn(notFoundIsbn)}>
              ISBN で追加する（タイトルは確認画面で入力）
            </Button>
          }
          compact
        />
      ) : search.results.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={search.failed ? '検索サービスにつながりませんでした' : `「${search.query}」は見つかりませんでした`}
          description={
            search.failed
              ? `「${search.query}」を検索できませんでした（通信の失敗・混雑）。電波のよい場所でもう一度検索するか、手入力で追加してください。`
              : 'ひらがな・カタカナを変えたり、短いことばにしたりして検索し直すか、手入力で追加してください。'
          }
          action={
            <Button variant="secondary" icon={<EditIcon />} onClick={openManual}>
              手入力で追加する
            </Button>
          }
          compact
        />
      ) : (
        <section className={styles.section} aria-labelledby="add-results">
          <h2 id="add-results" className={styles.sectionTitle}>
            検索結果 <span className={styles.sectionCount}>{search.results.length}件</span>
          </h2>
          {search.author && authorHits === 0 ? (
            <p className={styles.note}>著者「{search.author}」に一致する本は無かったので、タイトルが近い本を表示しています。</p>
          ) : null}
          <ul className={styles.list}>
            {search.results.map((c, i) => {
              const inCart = inCartCandidate(c);
              const meta = [c.authors.join('、'), c.publisher].filter(Boolean).join(' · ');
              return (
                <li key={`${c.isbn ?? normalizeForSearch(c.title)}-${i}`}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => addCandidate(c)}
                    aria-label={`${c.title}${inCart ? '（追加済み）' : 'を追加'}`}
                  >
                    <BookCover title={c.title} coverUrl={c.coverUrl} size="sm" />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{c.title}</span>
                      {meta ? <span className={styles.rowMeta}>{meta}</span> : null}
                      {c.volume != null && c.seriesName ? (
                        <span className={styles.rowSub}>
                          {c.seriesName} {c.volume}巻
                        </span>
                      ) : null}
                    </span>
                    {inCart ? (
                      <span className={styles.rowAdded}>
                        <CheckIcon size={16} strokeWidth={3} />
                        追加済み
                      </span>
                    ) : (
                      <span className={styles.rowAdd} aria-hidden="true">
                        <PlusIcon size={22} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      );
  }

  return (
    <Page
      title="バーコードがない本"
      back="/scan?mode=borrow"
      hideTabBar
      footer={
        count > 0 ? (
          <LinkButton to="/borrow/confirm" block size="lg">
            借りる内容の確認へ（{count}冊）
          </LinkButton>
        ) : undefined
      }
    >
      <div className={styles.content}>
        <form className={styles.searchForm} onSubmit={runSearch} role="search" noValidate>
          <TextField
            label="タイトル"
            type="search"
            value={title}
            onChange={(v) => {
              setTitle(v);
              if (titleError) setTitleError(null);
            }}
            placeholder="例：ぐりとぐら"
            leading={<SearchIcon size={20} />}
            clearable
            autoComplete="off"
            enterKeyHint="search"
            error={titleError}
          />
          <TextField
            label="著者（任意）"
            value={author}
            onChange={setAuthor}
            placeholder="例：なかがわりえこ"
            autoComplete="off"
            enterKeyHint="search"
          />
          <Button type="submit" block icon={<SearchIcon />} loading={search.status === 'loading'}>
            検索する
          </Button>
        </form>

        {existingMatches.length > 0 ? (
          <section className={styles.section} aria-labelledby="add-existing">
            <h2 id="add-existing" className={styles.sectionTitle}>
              <HistoryIcon size={18} className={styles.sectionIcon} />
              以前に登録した本（もう一度借りる）
            </h2>
            <ul className={styles.list}>
              {existingMatches.map((b) => {
                const inCart = inCartBook(b);
                const meta = [b.authors.join('、'), b.publisher].filter(Boolean).join(' · ');
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => addExisting(b)}
                      aria-label={`${b.title}${inCart ? '（追加済み）' : 'を追加'}`}
                    >
                      <BookCover title={b.title} coverUrl={b.coverUrl} size="sm" />
                      <span className={styles.rowMain}>
                        <span className={styles.rowTitle}>{b.title}</span>
                        {meta ? <span className={styles.rowMeta}>{meta}</span> : null}
                      </span>
                      {inCart ? (
                        <span className={styles.rowAdded}>
                          <CheckIcon size={16} strokeWidth={3} />
                          追加済み
                        </span>
                      ) : (
                        <span className={styles.rowAdd} aria-hidden="true">
                          <PlusIcon size={22} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {resultsView}

        {search.status === 'idle' && existingMatches.length === 0 ? (
          <p className={styles.help}>
            月刊絵本や古い本、図書館のシールでバーコードが隠れた本は、タイトルで検索するか手入力で追加できます。
          </p>
        ) : null}

        <div ref={manualRef} className={styles.manual}>
          <button
            type="button"
            className={styles.manualToggle}
            aria-expanded={manualOpen}
            onClick={() => (manualOpen ? setManualOpen(false) : openManual())}
          >
            <EditIcon size={20} />
            <span className={styles.manualToggleLabel}>見つからない場合は手入力</span>
            {manualOpen ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
          </button>
          {manualOpen ? (
            <Card>
              <form className={styles.manualForm} onSubmit={submitManual} noValidate>
                <TextField
                  label="タイトル"
                  required
                  value={mTitle}
                  onChange={(v) => {
                    setMTitle(v);
                    if (mTitleError) setMTitleError(null);
                  }}
                  error={mTitleError}
                  autoComplete="off"
                  enterKeyHint="next"
                />
                <TextField
                  label="著者"
                  value={mAuthor}
                  onChange={setMAuthor}
                  hint="複数いる場合は「、」で区切ります"
                  autoComplete="off"
                />
                <TextField label="出版社" value={mPublisher} onChange={setMPublisher} autoComplete="off" />
                <SeriesPicker
                  seriesName={seriesValue.seriesName}
                  volume={seriesValue.volume}
                  onChange={(v) => {
                    setSeriesTouched(true);
                    setMSeries(v);
                  }}
                />
                {!seriesTouched && guessed.seriesName ? (
                  <p className={styles.note}>シリーズ名と巻数はタイトルから推定しました。違っていたら直してください。</p>
                ) : null}
                <Button type="submit" block icon={<PlusIcon />}>
                  この内容で追加する
                </Button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>

      <Sheet
        open={addedOpen}
        onClose={() => setAddedOpen(false)}
        title={added?.result === 'duplicate' ? 'すでに追加済みです' : '追加しました'}
        footer={
          <div className={styles.sheetActions}>
            <Button block size="lg" onClick={() => navigate('/borrow/confirm')}>
              借りる内容の確認へ（{count}冊）
            </Button>
            <Button block variant="secondary" icon={<PlusIcon />} onClick={() => setAddedOpen(false)}>
              続けて追加
            </Button>
          </div>
        }
      >
        {added ? (
          <p className={styles.sheetMessage}>
            「{added.title}」
            {added.result === 'duplicate' ? 'は、すでに借りる本のリストに入っています。' : 'を借りる本のリストに追加しました。'}
            {added.note ? (
              <>
                <br />
                {added.note}
              </>
            ) : null}
          </p>
        ) : null}
      </Sheet>
    </Page>
  );
}
