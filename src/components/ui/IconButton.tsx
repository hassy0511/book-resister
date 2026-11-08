/*
 * アイコンだけのボタン（44×44px）。label は必須（aria-label になる）。
 * 使い方:
 *   <IconButton label="閉じる" icon={<CloseIcon />} onClick={onClose} />
 *   <IconButton label="編集" icon={<EditIcon />} variant="filled" />
 *   <IconLinkButton label="設定" icon={<SettingsIcon />} to="/settings" />
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import styles from './IconButton.module.css';

export type IconButtonVariant = 'plain' | 'filled' | 'primary' | 'danger';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** 読み上げ用のラベル（必須） */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: 'md' | 'lg';
};

export type IconLinkButtonProps = Omit<LinkProps, 'children'> & {
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: 'md' | 'lg';
};

function cls(variant: IconButtonVariant, size: 'md' | 'lg', extra?: string) {
  return [styles.iconButton, styles[variant], styles[size], extra ?? ''].filter(Boolean).join(' ');
}

export function IconButton({
  label,
  icon,
  variant = 'plain',
  size = 'md',
  type = 'button',
  className,
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={title ?? label} className={cls(variant, size, className)} {...rest}>
      {icon}
    </button>
  );
}

export function IconLinkButton({ label, icon, variant = 'plain', size = 'md', className, ...rest }: IconLinkButtonProps) {
  return (
    <Link aria-label={label} title={label} className={cls(variant, size, className)} {...rest}>
      {icon}
    </Link>
  );
}
