// @vitest-environment jsdom
/* 汎用 UI 部品の振る舞いのテスト */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Chips } from './Chips';
import { NumberField } from './NumberField';
import { Sheet } from './Sheet';
import { StarRating } from './StarRating';
import { ToastProvider, useToast } from './ToastProvider';
import { BookCover } from '../BookCover';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Sheet', () => {
  it('Esc と背景タップで閉じ、表示中は body のスクロールを止める', () => {
    const onClose = vi.fn();
    const view = render(
      <Sheet open onClose={onClose} title="返却日を変更">
        <p>中身</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: '返却日を変更' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = document.querySelector('[aria-hidden="true"]');
    if (!backdrop) throw new Error('背景が無い');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);

    view.rerender(
      <Sheet open={false} onClose={onClose} title="返却日を変更">
        <p>中身</p>
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('dismissible=false なら Esc では閉じない', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="処理中" dismissible={false}>
        <p>中身</p>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull();
  });
});

describe('StarRating', () => {
  it('★を押すと評価、同じ★をもう一度押すと解除', () => {
    const onChange = vi.fn();
    const view = render(<StarRating value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '★3' }));
    expect(onChange).toHaveBeenLastCalledWith(3);

    view.rerender(<StarRating value={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '★3' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('onChange が無ければ表示のみ', () => {
    render(<StarRating value={4} />);
    expect(screen.getByRole('img', { name: '評価 4 / 5' })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('NumberField', () => {
  function Harness({ onValue }: { onValue: (v: number | null) => void }) {
    const [value, setValue] = useState<number | null>(14);
    return (
      <NumberField
        label="貸出期間"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue(v);
        }}
        min={1}
        max={365}
        suffix="日"
        stepper
      />
    );
  }

  it('全角数字も受け付け、空欄は null、離れたときに範囲内に丸める', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('貸出期間') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '２１' } });
    expect(onValue).toHaveBeenLastCalledWith(21);
    expect(input.value).toBe('21');

    fireEvent.change(input, { target: { value: '' } });
    expect(onValue).toHaveBeenLastCalledWith(null);

    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(onValue).toHaveBeenLastCalledWith(365);
    expect(input.value).toBe('365');
  });

  it('−／＋ ボタンで増減する', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: '1 増やす' }));
    expect(onValue).toHaveBeenLastCalledWith(15);
    fireEvent.click(screen.getByRole('button', { name: '1 減らす' }));
    expect(onValue).toHaveBeenLastCalledWith(14);
  });
});

describe('Chips', () => {
  it('選択中をもう一度押すと解除、「すべて」で null', () => {
    const onChange = vi.fn();
    const options = [
      { value: 'a', label: '中央図書館' },
      { value: 'b', label: '保育園' },
    ];
    const view = render(<Chips ariaLabel="場所" allLabel="すべて" options={options} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '中央図書館' }));
    expect(onChange).toHaveBeenLastCalledWith('a');

    view.rerender(<Chips ariaLabel="場所" allLabel="すべて" options={options} value="a" onChange={onChange} />);
    expect(screen.getByRole('button', { name: '中央図書館' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '中央図書館' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('ToastProvider', () => {
  function Trigger({ onUndo }: { onUndo: () => void }) {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.show('返却しました', { action: { label: '取り消す', onClick: onUndo } })}>
        出す
      </button>
    );
  }

  it('メッセージと操作ボタンを出し、時間が経つと消える', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '出す' }));
    expect(screen.getByText('返却しました')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText('返却しました')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '出す' }));
    expect(screen.getByText('返却しました')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('返却しました')).toBeNull();
  });
});

describe('BookCover', () => {
  it('表紙が無ければ頭文字のプレースホルダ', () => {
    const { container } = render(<BookCover title="ぐりとぐら" coverUrl={null} size="sm" />);
    expect(container.textContent).toBe('ぐ');
    expect(container.querySelector('img')).toBeNull();
  });

  it('読み込みに失敗したらプレースホルダに切り替え、http は https にする', () => {
    const { container } = render(<BookCover title="ぐりとぐら" coverUrl="http://example.com/a.jpg" />);
    const img = container.querySelector('img');
    if (!img) throw new Error('img が無い');
    expect(img.getAttribute('src')).toBe('https://example.com/a.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('ぐ');
  });
});
