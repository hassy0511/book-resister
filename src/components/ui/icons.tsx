/*
 * インライン SVG アイコン集。色は currentColor、サイズは size（px, 既定 24）。
 * 使い方: <HomeIcon />、<ChevronRightIcon size={18} />
 * 既定は aria-hidden。意味を持たせたい場合は title を渡す（<BellIcon title="通知" />）。
 */
import type { ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number;
  title?: string;
};

function createIcon(displayName: string, children: ReactNode, opts?: { filled?: boolean }) {
  function Icon({ size = 24, title, ...rest }: IconProps) {
    const labelled = Boolean(title);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={opts?.filled ? 'currentColor' : 'none'}
        stroke={opts?.filled ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        role={labelled ? 'img' : undefined}
        focusable="false"
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {children}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/* ---- タブ ---- */
export const HomeIcon = createIcon(
  'HomeIcon',
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </>,
);

export const ScanIcon = createIcon(
  'ScanIcon',
  <>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8v8M10 8v8M13.5 8v8M17 8v8" />
  </>,
);

export const HistoryIcon = createIcon(
  'HistoryIcon',
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
    <path d="M12 7v5l3 2" />
  </>,
);

export const SeriesIcon = createIcon(
  'SeriesIcon',
  <>
    <rect x="3" y="4" width="4" height="16" rx="1" />
    <rect x="9" y="4" width="4" height="16" rx="1" />
    <path d="m15.2 5.3 3.8-1 3 15.4-3.8 1z" />
  </>,
);

export const SettingsIcon = createIcon(
  'SettingsIcon',
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);

/* ---- 矢印・操作 ---- */
export const ChevronLeftIcon = createIcon('ChevronLeftIcon', <path d="m15 18-6-6 6-6" />);
export const ChevronRightIcon = createIcon('ChevronRightIcon', <path d="m9 18 6-6-6-6" />);
export const ChevronDownIcon = createIcon('ChevronDownIcon', <path d="m6 9 6 6 6-6" />);
export const ChevronUpIcon = createIcon('ChevronUpIcon', <path d="m18 15-6-6-6 6" />);
export const CloseIcon = createIcon('CloseIcon', <path d="M18 6 6 18M6 6l12 12" />);
export const PlusIcon = createIcon('PlusIcon', <path d="M12 5v14M5 12h14" />);
export const MinusIcon = createIcon('MinusIcon', <path d="M5 12h14" />);
export const CheckIcon = createIcon('CheckIcon', <path d="M20 6 9 17l-5-5" />);
export const MoreIcon = createIcon(
  'MoreIcon',
  <>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </>,
);

export const SearchIcon = createIcon(
  'SearchIcon',
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);

export const FilterIcon = createIcon('FilterIcon', <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />);

export const EditIcon = createIcon(
  'EditIcon',
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </>,
);

export const TrashIcon = createIcon(
  'TrashIcon',
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </>,
);

export const UndoIcon = createIcon(
  'UndoIcon',
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);

export const ShareIcon = createIcon(
  'ShareIcon',
  <>
    <path d="M12 3v12" />
    <path d="m8 7 4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </>,
);

export const CopyIcon = createIcon(
  'CopyIcon',
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </>,
);

export const LinkIcon = createIcon(
  'LinkIcon',
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);

export const ExternalLinkIcon = createIcon(
  'ExternalLinkIcon',
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </>,
);

export const LogoutIcon = createIcon(
  'LogoutIcon',
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </>,
);

export const RefreshIcon = createIcon(
  'RefreshIcon',
  <>
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5M3 21v-5h5" />
  </>,
);

/* ---- もの ---- */
export const BookIcon = createIcon(
  'BookIcon',
  <>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </>,
);

export const BooksIcon = SeriesIcon;

export const BarcodeIcon = createIcon(
  'BarcodeIcon',
  <path d="M4 5v14M7 5v14M10.5 5v14M13 5v14M16.5 5v14M20 5v14" />,
);

export const CameraIcon = createIcon(
  'CameraIcon',
  <>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </>,
);

export const KeyboardIcon = createIcon(
  'KeyboardIcon',
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </>,
);

export const BellIcon = createIcon(
  'BellIcon',
  <>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>,
);

export const BellOffIcon = createIcon(
  'BellOffIcon',
  <>
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    <path d="M18.6 13A17.9 17.9 0 0 1 18 8" />
    <path d="M6.3 6.3A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14" />
    <path d="M18 8a6 6 0 0 0-9.3-5" />
    <path d="m2 2 20 20" />
  </>,
);

export const UserIcon = createIcon(
  'UserIcon',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
);

export const UsersIcon = createIcon(
  'UsersIcon',
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 20a7 7 0 0 1 14 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
    <path d="M18.5 14a7 7 0 0 1 3.5 6" />
  </>,
);

export const LocationIcon = createIcon(
  'LocationIcon',
  <>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>,
);

export const CalendarIcon = createIcon(
  'CalendarIcon',
  <>
    <rect x="3" y="4.5" width="18" height="17" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </>,
);

export const ClockIcon = createIcon(
  'ClockIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);

export const ReturnIcon = createIcon(
  'ReturnIcon',
  <>
    <path d="M9 10 4 15l5 5" />
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  </>,
);

export const InfoIcon = createIcon(
  'InfoIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);

export const AlertIcon = createIcon(
  'AlertIcon',
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);

export const CheckCircleIcon = createIcon(
  'CheckCircleIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </>,
);

export const CircleIcon = createIcon('CircleIcon', <circle cx="12" cy="12" r="9" />);

export const StarIcon = createIcon(
  'StarIcon',
  <path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z" />,
);

export const StarFilledIcon = createIcon(
  'StarFilledIcon',
  <path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z" />,
  { filled: true },
);

export const SparkleIcon = createIcon(
  'SparkleIcon',
  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
);

export const DownloadIcon = createIcon(
  'DownloadIcon',
  <>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </>,
);

export const PlusSquareIcon = createIcon(
  'PlusSquareIcon',
  <>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </>,
);
