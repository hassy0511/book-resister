/*
 * 本の情報の編集シート（タイトル・著者・出版社・表紙 URL・シリーズと巻数）。
 * 開くたびに key を変えてマウントし直す前提（入力の初期値は props から作る）。
 * 保存時、シリーズ名が変わっていれば findOrCreateSeries でシリーズを決めてから updateBook する。
 */
import { useRef, useState } from 'react';
import type { Book, WithId } from '../../types';
import { updateBook } from '../../data/books';
import { findOrCreateSeries } from '../../data/series';
import { BookCover } from '../../components/BookCover';
import { SeriesPicker } from '../../components/SeriesPicker';
import { Button, Sheet, TextField, useToast } from '../../components/ui';
import {
  buildBookPatch,
  coverUrlError,
  draftFromBook,
  isDraftDirty,
  seriesNameChanged,
  titleError,
  type BookDraft,
} from './bookEditLogic';
import styles from './BookEditSheet.module.css';

export type BookEditSheetProps = {
  open: boolean;
  onClose: () => void;
  groupId: string;
  book: WithId<Book>;
  /** 今のシリーズ名（シリーズ未設定なら null） */
  seriesName: string | null;
};

export function BookEditSheet({ open, onClose, groupId, book, seriesName }: BookEditSheetProps) {
  const toast = useToast();
  const [initial] = useState<BookDraft>(() => draftFromBook(book, seriesName));
  const [draft, setDraft] = useState<BookDraft>(initial);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const set = <K extends keyof BookDraft>(key: K, value: BookDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const errors = {
    title: titleError(draft.title),
    coverUrl: coverUrlError(draft.coverUrl),
  };
  const hasError = errors.title !== null || errors.coverUrl !== null;
  const dirty = isDraftDirty(draft, initial);

  const close = () => {
    if (!savingRef.current) onClose();
  };

  const save = async () => {
    if (savingRef.current || hasError || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    try {
      let seriesId: string | null | undefined;
      if (seriesNameChanged(draft, initial)) {
        const name = draft.seriesName?.trim() ?? '';
        seriesId = name ? await findOrCreateSeries(groupId, name) : null;
      }
      const patch = buildBookPatch(book, draft, seriesId);
      if (Object.keys(patch).length > 0) await updateBook(groupId, book.id, patch);
      toast.show('本の情報を保存しました', { tone: 'success' });
      savingRef.current = false;
      setSaving(false);
      onClose();
    } catch (e) {
      console.error(e);
      toast.show(e instanceof Error && e.message ? e.message : '保存できませんでした', { tone: 'error' });
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="本の情報を編集"
      dismissible={!saving}
      footer={
        <Button block size="lg" loading={saving} disabled={!dirty || hasError} onClick={() => void save()}>
          保存
        </Button>
      }
    >
      <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
        <TextField
          label="タイトル"
          value={draft.title}
          onChange={(v) => set('title', v)}
          required
          error={errors.title}
          disabled={saving}
          autoComplete="off"
        />
        <TextField
          label="著者"
          value={draft.authors}
          onChange={(v) => set('authors', v)}
          hint="複数のときは「、」か「,」で区切ります"
          disabled={saving}
          autoComplete="off"
        />
        <TextField
          label="出版社"
          value={draft.publisher}
          onChange={(v) => set('publisher', v)}
          disabled={saving}
          autoComplete="off"
        />
        <div className={styles.coverRow}>
          <TextField
            label="表紙の画像のアドレス（URL）"
            type="url"
            inputMode="url"
            value={draft.coverUrl}
            onChange={(v) => set('coverUrl', v)}
            placeholder="https://"
            hint="空欄にすると表紙なし（タイトルの頭文字）で表示します"
            error={errors.coverUrl}
            clearable
            disabled={saving}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={styles.coverField}
          />
          <BookCover
            title={draft.title || book.title}
            coverUrl={errors.coverUrl ? null : draft.coverUrl.trim() || null}
            size="sm"
            alt="表紙の見本"
            className={styles.coverPreview}
          />
        </div>

        <fieldset className={styles.fieldset} disabled={saving}>
          <legend className={styles.legend}>シリーズ</legend>
          <SeriesPicker
            seriesName={draft.seriesName}
            volume={draft.volume}
            onChange={({ seriesName: name, volume }) => setDraft((d) => ({ ...d, seriesName: name, volume }))}
            disabled={saving}
          />
          <p className={styles.note}>シリーズ名を空欄にすると、シリーズから外します。</p>
        </fieldset>
      </form>
    </Sheet>
  );
}
