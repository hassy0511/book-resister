/*
 * 既定の貸出期間（日数）の入力。数値入力（−／＋ 付き）とよく使う日数のチップ。
 * 場所の編集画面と、はじめての場所の登録（WelcomePage）で使う。
 */
import { NumberField } from '../../components/ui/NumberField';
import { Chips, type ChipOption } from '../../components/ui/Chips';
import { LOAN_DAY_PRESETS, LOAN_DAYS_MAX, LOAN_DAYS_MIN } from './settingsLogic';
import styles from './LoanDaysField.module.css';

export type LoanDaysFieldProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  error?: string;
  disabled?: boolean;
  label?: string;
};

const PRESET_OPTIONS: ChipOption<string>[] = LOAN_DAY_PRESETS.map((d) => ({
  value: String(d),
  label: d % 7 === 0 ? `${d}日（${d / 7}週間）` : `${d}日`,
}));

export function LoanDaysField({ value, onChange, error, disabled = false, label = '既定の貸出期間' }: LoanDaysFieldProps) {
  const selected = value != null && LOAN_DAY_PRESETS.includes(value) ? String(value) : null;
  return (
    <div className={styles.wrap}>
      <NumberField
        label={label}
        value={value}
        onChange={onChange}
        min={LOAN_DAYS_MIN}
        max={LOAN_DAYS_MAX}
        suffix="日"
        stepper
        required
        disabled={disabled}
        error={error}
        hint="借りた日にこの日数を足して、返却日を自動で計算します（1冊ごとに変更もできます）。"
      />
      <Chips
        ariaLabel="よく使う貸出期間"
        options={PRESET_OPTIONS}
        value={selected}
        // 選択中のチップをもう一度押しても値は変えない
        onChange={(v) => {
          if (v != null && !disabled) onChange(Number(v));
        }}
        wrap
        className={styles.presets}
      />
    </div>
  );
}
