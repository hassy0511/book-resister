/*
 * シリーズ名と巻数の入力。既存シリーズを候補から選ぶか、新しい名前を入力する。
 * 既存シリーズの一覧は useSeriesList() で読む（グループ参加済みの画面でのみ使える）。
 * シリーズの作成はしない。保存時に findOrCreateSeries(groupId, seriesName) を呼ぶこと。
 * 使い方:
 *   <SeriesPicker seriesName={item.seriesName} volume={item.volume}
 *                 onChange={({ seriesName, volume }) => update(item.key, { seriesName, volume })} />
 */
import { useMemo } from 'react';
import { useSeriesList } from '../data/series';
import { findMatchingSeries, normalizeSeriesName } from '../lib/series';
import { NumberField } from './ui/NumberField';
import { TextField } from './ui/TextField';
import styles from './SeriesPicker.module.css';

export type SeriesPickerValue = {
  seriesName: string | null;
  volume: number | null;
};

export type SeriesPickerProps = SeriesPickerValue & {
  onChange: (value: SeriesPickerValue) => void;
  disabled?: boolean;
  className?: string;
};

const MAX_SUGGESTIONS = 8;

export function SeriesPicker({ seriesName, volume, onChange, disabled = false, className }: SeriesPickerProps) {
  const { data: seriesList } = useSeriesList();
  const name = seriesName ?? '';
  const trimmed = name.trim();

  const matched = useMemo(
    () => (trimmed ? findMatchingSeries(trimmed, seriesList) : null),
    [trimmed, seriesList],
  );

  const suggestions = useMemo(() => {
    const key = trimmed ? normalizeSeriesName(trimmed) : '';
    const list = key
      ? seriesList.filter((s) => normalizeSeriesName(s.name).includes(key) && s.id !== matched?.id)
      : seriesList;
    return list.slice(0, MAX_SUGGESTIONS);
  }, [trimmed, seriesList, matched]);

  const setName = (value: string) => {
    onChange({ seriesName: value === '' ? null : value, volume });
  };

  return (
    <div className={[styles.picker, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.fields}>
        <div className={styles.name}>
          <TextField
            label="シリーズ名"
            value={name}
            onChange={setName}
            onBlur={() => {
              // 前後の空白だけ整える
              if (name !== trimmed) setName(trimmed);
            }}
            placeholder="例：おしりたんてい"
            clearable
            disabled={disabled}
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        <div className={styles.volume}>
          <NumberField
            label="巻数"
            value={volume}
            onChange={(v) => onChange({ seriesName, volume: v })}
            min={1}
            max={9999}
            suffix="巻"
            placeholder="—"
            disabled={disabled}
          />
        </div>
      </div>

      {trimmed ? (
        <p className={matched ? styles.statusExisting : styles.statusNew} aria-live="polite">
          {matched ? `登録済みのシリーズ「${matched.name}」に入れます` : '新しいシリーズとして登録します'}
        </p>
      ) : null}

      {suggestions.length > 0 && !disabled ? (
        <div className={styles.suggestions} role="group" aria-label="登録済みのシリーズから選ぶ">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.suggestion}
              onClick={() => onChange({ seriesName: s.name, volume })}
            >
              <span className={styles.suggestionLabel}>{s.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
