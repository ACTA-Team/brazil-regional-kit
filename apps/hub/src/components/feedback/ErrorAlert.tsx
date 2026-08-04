'use client';

import { Alert } from '@brk/ramp-ui';
import { friendlyError, isDuplicateOrder } from '@/client/friendly-error';
import { useI18n } from '@/client/i18n';

/**
 * The one way this app shows a failure.
 *
 * Pages hand over whatever they caught — an ApiError, a wallet rejection, a
 * bare string from a fetch — and get back a titled alert that says what
 * happened, what it means for them, and (folded away) exactly what the service
 * returned. No page formats an error itself any more; that is how the same
 * failure ended up phrased four different ways on four screens.
 *
 * `title`/`children` override the mapped copy for the cases a page genuinely
 * knows better than the mapper — the on-ramp's duplicate-order collision is the
 * only one so far.
 */
export function ErrorAlert({
  error,
  tone = 'error',
  title,
  children,
  action,
}: {
  error: unknown;
  tone?: 'error' | 'warning';
  /** Replaces the mapped title. */
  title?: React.ReactNode;
  /** Replaces the mapped body. */
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { t } = useI18n();
  if (!error) return null;

  const friendly = friendlyError(error, t);

  return (
    <Alert
      tone={tone}
      title={title ?? friendly.title}
      detail={friendly.detail}
      detailLabel={t('error.detail')}
      action={action}
    >
      {children ?? friendly.message}
    </Alert>
  );
}

export { isDuplicateOrder };
