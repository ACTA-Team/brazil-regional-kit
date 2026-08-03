'use client';

export function Alert({
  tone = 'error',
  children,
  action,
}: {
  tone?: 'error' | 'warning' | 'success' | 'info';
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const styles = {
    error: 'border-red-500/60 bg-red-500/10 text-red-200',
    warning: 'border-accent-500 bg-accent-500/10 text-accent-300',
    success: 'border-brand-600 bg-brand-700/20 text-brand-200',
    info: 'border-border-subtle bg-surface-inset text-ink-300',
  }[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
