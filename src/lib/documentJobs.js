// Display helpers for public.document_jobs rows (portal uploads).

export const ACTIVE_JOB_STATUSES = ['pending', 'processing']
export const REVIEW_JOB_STATUSES = ['needs_review', 'failed']

/* ── Admin: raw status, plain words ── */
export const ADMIN_JOB_STATUS = {
  pending:      { label: 'Pending',      tone: 'info' },
  processing:   { label: 'Processing',   tone: 'info' },
  added:        { label: 'Added',        tone: 'success' },
  duplicate:    { label: 'Duplicate',    tone: 'muted' },
  needs_review: { label: 'Needs review', tone: 'warn' },
  failed:       { label: 'Failed',       tone: 'danger' },
  rejected:     { label: 'Rejected',     tone: 'danger' },
}
export const adminJobStatus = (s) => ADMIN_JOB_STATUS[s] || { label: s || '—', tone: 'muted' }

/* ── Customer: friendly words only (never status_reason / checks) ── */
export const CUSTOMER_JOB_LABELS = ['Processing', 'Added', 'Already uploaded', 'Under review', 'Not accepted']

export function customerJobStatus(job) {
  switch (job?.status) {
    case 'pending':
    case 'processing':   return { label: 'Processing', tone: 'info', note: 'We are reading your file…' }
    case 'added':        return { label: 'Added', tone: 'success', note: 'Ready to advance' }
    case 'duplicate':    return { label: 'Already uploaded', tone: 'muted', note: 'This invoice number was uploaded before' }
    case 'needs_review':
    case 'failed':       return { label: 'Under review', tone: 'warn', note: 'Our team is checking this file' }
    case 'rejected':     return { label: 'Not accepted', tone: 'danger', note: job.review_note || '' }
    default:             return { label: job?.status || '—', tone: 'muted', note: '' }
  }
}

export const fmtMoney = (n) => n == null || n === '' || isNaN(Number(n))
  ? '—'
  : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtDateTime = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Name shown for a job's file (upload name, or "Google Sheet link"). */
export const jobFileName = (job) => job?.original_filename
  || (job?.sheet_url ? 'Google Sheet link' : (job?.storage_path || '').split('/').pop() || '—')
