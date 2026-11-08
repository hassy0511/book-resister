/*
 * シリーズ名と全巻数の編集シート。開くたびに key を変えてマウントし直す前提。
 *   - 同じ名前のシリーズがほかにもあれば（2 台で同時に作った場合など）、そちらにまとめられる（mergeSeries）
 *   - シリーズを削除できる（本があれば、本をシリーズから外して削除。本と貸出の記録は残る）
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Series, WithId } from '../../types';
import { useBooksInSeries } from '../../data/books';
import { deleteSeries, mergeSeries, updateSeries, useSeriesList } from '../../data/series';
import { findMatchingSeries } from '../../lib/series';
import { Button, ConfirmDialog, NumberField, Sheet, TextField, useToast } from '../../components/ui';
import styles from './SeriesDetailPage.module.css';

export type SeriesEditSheetProps = {
  open: boolean;
  onClose: () => void;
  groupId: string;
  series: WithId<Series>;
  /** このシリーズの本の巻数の最大値（全巻数の注意書きに使う。無ければ 0） */
  maxVolume: number;
};

export function SeriesEditSheet({ open, onClose, groupId, series, maxVolume }: SeriesEditSheetProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: allSeries } = useSeriesList();
  const { data: seriesBooks, loading: booksLoading } = useBooksInSeries(series.id);
  const [confirm, setConfirm] = useState<'merge' | 'delete' | null>(null);
  const [name, setName] = useState(series.name);
  const [total, setTotal] = useState<number | null>(series.totalVolumes);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const trimmed = name.trim();
  const nameError = trimmed ? null : 'シリーズ名を入力してください';
  const duplicate = useMemo(
    () => (trimmed ? findMatchingSeries(trimmed, allSeries.filter((s) => s.id !== series.id)) : null),
    [trimmed, allSeries, series.id],
  );
  const dirty = trimmed !== series.name || total !== series.totalVolumes;

  const totalHint =
    total !== null && total < maxVolume
      ? `借りた本に ${maxVolume}巻があるので、${maxVolume}巻までは表示します。`
      : '分からなければ空欄のままで大丈夫です。借りた巻の中で抜けている巻を表示します。';

  const close = () => {
    if (!savingRef.current) onClose();
  };

  const save = async () => {
    if (savingRef.current || nameError || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const patch: Partial<Pick<Series, 'name' | 'totalVolumes'>> = {};
      if (trimmed !== series.name) patch.name = trimmed;
      if (total !== series.totalVolumes) patch.totalVolumes = total;
      await updateSeries(groupId, series.id, patch);
      toast.show('シリーズを保存しました', { tone: 'success' });
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

  /** 同じ名前のシリーズにまとめる（このシリーズの本を移して、このシリーズを削除） */
  const merge = async () => {
    if (!duplicate) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await mergeSeries(groupId, series.id, duplicate.id);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    toast.show(`「${duplicate.name}」にまとめました`, { tone: 'success' });
    setConfirm(null);
    onClose();
    navigate(`/series/${encodeURIComponent(duplicate.id)}`, { replace: true });
  };

  /** シリーズを削除する（本はシリーズから外す） */
  const remove = async () => {
    savingRef.current = true;
    setSaving(true);
    try {
      await deleteSeries(groupId, series.id, { detachBooks: true });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    toast.show(`シリーズ「${series.name}」を削除しました`, { tone: 'success' });
    setConfirm(null);
    onClose();
    navigate('/series', { replace: true });
  };

  const bookCount = seriesBooks.length;

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        title="シリーズを編集"
        dismissible={!saving}
        footer={
          <Button block size="lg" loading={saving} disabled={!dirty || nameError !== null} onClick={() => void save()}>
            保存
          </Button>
        }
      >
        <form className={styles.sheetForm} onSubmit={(e) => e.preventDefault()} noValidate>
          <TextField
            label="シリーズ名"
            value={name}
            onChange={setName}
            required
            error={nameError}
            hint={
              duplicate
                ? `同じ名前のシリーズ「${duplicate.name}」がほかにもあります（このままでは別のシリーズです。下のボタンで 1 つにまとめられます）。`
                : undefined
            }
            disabled={saving}
            autoComplete="off"
          />
          {duplicate ? (
            <Button variant="secondary" block onClick={() => setConfirm('merge')} disabled={saving || booksLoading}>
              このシリーズを「{duplicate.name}」にまとめる
            </Button>
          ) : null}
          <NumberField
            label="全巻数"
            value={total}
            onChange={setTotal}
            min={1}
            max={9999}
            suffix="巻"
            placeholder="分からなければ空欄"
            hint={totalHint}
            disabled={saving}
          />
          <Button variant="ghost" block onClick={() => setConfirm('delete')} disabled={saving || booksLoading}>
            シリーズを削除
          </Button>
        </form>
      </Sheet>
      <ConfirmDialog
        open={confirm === 'merge' && duplicate !== null}
        title={duplicate ? `「${duplicate.name}」にまとめますか？` : ''}
        message={
          bookCount > 0
            ? `このシリーズの本 ${bookCount}冊を「${duplicate?.name ?? ''}」に移し、このシリーズを削除します。本と貸出の記録はそのまま残ります。`
            : 'このシリーズには本がないので、このシリーズを削除します。'
        }
        confirmLabel="まとめる"
        onConfirm={merge}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`シリーズ「${series.name}」を削除しますか？`}
        message={
          bookCount > 0
            ? `このシリーズの本 ${bookCount}冊はシリーズから外れます（本と貸出の記録は残ります）。`
            : 'このシリーズには本がありません。'
        }
        confirmLabel="削除する"
        danger
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
