/*
 * 返却時の読書状況の選択（読んだ／途中まで／読んでいない）。既定値は呼び出し側で 'read' にする。
 * 使い方:
 *   const [status, setStatus] = useState<ReadStatus>('read');
 *   <ReadStatusPicker value={status} onChange={setStatus} />
 */
import type { ReadStatus } from '../types';
import { SegmentedControl, type SegmentOption } from './ui/SegmentedControl';

/** 読書状況の表示名 */
export const READ_STATUS_TEXT: Record<ReadStatus, string> = {
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
};

export const DEFAULT_READ_STATUS: ReadStatus = 'read';

const OPTIONS: SegmentOption<ReadStatus>[] = [
  { value: 'read', label: READ_STATUS_TEXT.read },
  { value: 'partial', label: READ_STATUS_TEXT.partial },
  { value: 'unread', label: READ_STATUS_TEXT.unread },
];

export type ReadStatusPickerProps = {
  value: ReadStatus;
  onChange: (value: ReadStatus) => void;
  /** 読み上げ用ラベル（既定「読書状況」）。本のタイトルを含めると複数冊の画面で分かりやすい */
  ariaLabel?: string;
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
};

export function ReadStatusPicker({
  value,
  onChange,
  ariaLabel = '読書状況',
  size = 'md',
  disabled,
  className,
}: ReadStatusPickerProps) {
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={OPTIONS}
      size={size}
      tone="primary"
      disabled={disabled}
      className={className}
    />
  );
}
