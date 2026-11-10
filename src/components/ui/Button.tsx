/*
 * ボタン。タップ領域は 44px 以上。type の既定は "button"。
 * 使い方:
 *   <Button onClick={save}>保存</Button>
 *   <Button variant="secondary" size="sm" icon={<PlusIcon />}>追加</Button>
 *   <Button variant="danger" block loading={busy}>削除する</Button>
 *   <LinkButton to="/scan?mode=borrow" block>本を借りる</LinkButton>   // 見た目がボタンのリンク
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 横幅いっぱい */
  block?: boolean;
  /** 左側に置くアイコン */
  icon?: ReactNode;
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  CommonProps & {
    /** 処理中（スピナーを出して押せなくする） */
    loading?: boolean;
  };

export type LinkButtonProps = LinkProps & CommonProps;

function classNames(variant: ButtonVariant, size: ButtonSize, block: boolean, extra?: string): string {
  return [styles.button, styles[variant], styles[size], block ? styles.block : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  icon,
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" label="処理中" className={styles.spinner} />
      ) : icon ? (
        <span className={styles.icon}>{icon}</span>
      ) : null}
      {children != null && children !== false ? <span className={styles.label}>{children}</span> : null}
    </button>
  );
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  block = false,
  icon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={classNames(variant, size, block, className)} {...rest}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{children}</span>
    </Link>
  );
}
