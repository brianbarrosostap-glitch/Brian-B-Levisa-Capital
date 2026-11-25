// Shared between Master (applies the filters) and the Dashboard / Audit To-Do
// (opens Master with filters pre-set).

const todayISO = () => new Date().toISOString().slice(0, 10)

// Status GROUPS used by the Dashboard tiles — same rules as dashboard_metrics()
// (migration 20260619000001). Each applies its filter to a Supabase query;
// `ors` collects or=() fragments so Master can AND them with the search.
// Master's Status chip shows the group name; ✕ clears it.
export const STATUS_GROUPS = {
  'Not yet requested':              (q) => q.in('status', ['Uploaded', 'Eligible']),
  'Requested — awaiting RZR':       (q) => q.in('status', ['Payment Requested', 'Advance Confirmed', 'Ready for Payment']),
  'With Ryder — not acknowledged':  (q) => q.in('status', ['Submitted to Ryder', 'Resubmitted']),
  'Acknowledged — awaiting cheque': (q, ors) => { ors.push(`due_date.is.null,due_date.gte.${todayISO()}`); return q.eq('status', 'Acknowledged') },
  'Overdue with Ryder':             (q) => q.eq('status', 'Acknowledged').not('due_date', 'is', null).lt('due_date', todayISO()),
  'Advanced to RZR':                (q) => q.in('status', ['Advance Paid', 'Submitted to Ryder', 'Acknowledged', 'Resubmitted', 'Paid']),
  'Open — not yet paid':            (q) => q.neq('status', 'Paid'),
}

// Pre-set Master's persisted filters before switching to it. Keys match the
// usePersistentState keys in Master.jsx.
export function presetMasterFilters({ tab = 'active', search = '', status = '' } = {}) {
  try {
    localStorage.setItem('admin.master.tab', JSON.stringify(tab))
    localStorage.setItem('admin.master.search', JSON.stringify(search))
    localStorage.setItem('admin.master.status', JSON.stringify(status))
  } catch { /* storage blocked */ }
}
