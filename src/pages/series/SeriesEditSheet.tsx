/*
 * シリーズ名と全巻数の編集シート。開くたびに key を変えてマウントし直す前提。
 */
import { useMemo, useRef, useState } from 'react';
import type { Series, WithId } from '../../types';
import { updateSeries, useSeriesList } from '../../data/series';
import { findMatchingSeries } from '../../lib/series';
import { Button, NumberField, Sheet, TextField, useToast } from '../../components/ui';
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
  const { data: allSeries } = useSeriesList();
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

  return (
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
          hint={duplicate ? `同じ名前のシリーズ「${duplicate.name}」がほかにもあります（別のシリーズのままです）。` : undefined}
          disabled={saving}
          autoComplete="off"
        />
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
      </form>
    </Sheet>
  );
}
