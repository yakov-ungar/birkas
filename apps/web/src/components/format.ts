const dt = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const tm = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
});

export const fmtDate = (iso: string | Date) => dt.format(new Date(iso));
export const fmtTime = (iso: string | Date) => tm.format(new Date(iso));
export const fmtDateTime = (iso: string | Date) => `${fmtDate(iso)} ${fmtTime(iso)}`;

export function hebrewDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jerusalem',
    }).format(d);
  } catch {
    return '';
  }
}
export const weekday = (d: Date) =>
  d.toLocaleDateString('he-IL', { weekday: 'long', timeZone: 'Asia/Jerusalem' });

/** Row props that make a table row a keyboard-operable button, as in the demo (KB). */
export const rowButton = (onOpen: () => void) => ({
  className: 'k',
  tabIndex: 0,
  role: 'button' as const,
  onClick: onOpen,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  },
});
