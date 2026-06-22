export const C = {
  primary:  '#007953',
  primDk:   '#005741',
  primLt:   '#eaf4ef',
  primMd:   '#00a870',
  sidebar:  '#072418',
  bg:       '#f2f5f8',
  card:     '#ffffff',
  border:   '#dde4ec',
  borderMd: '#c4cdd8',
  text:     '#0d1b14',
  textB:    '#162414',
  textSm:   '#4a6070',
  textMut:  '#8fa3b0',
  red:      '#dc2626',
  redLt:    '#fee2e2',
  amber:    '#b45309',
  amberLt:  '#fef9c3',
  info:     '#0369a1',
  infoLt:   '#e0f2fe',
};

export const shadow  = '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)';
export const shadowMd = '0 4px 16px rgba(0,0,0,0.09)';

export const STATUS_COLOURS = {
  'Uploaded':            { bg: '#f1f5f9', text: '#475569' },
  'Eligible':            { bg: '#dbeafe', text: '#1e40af' },
  'Payment Requested':   { bg: '#fef9c3', text: '#92400e' },
  'Ready for Payment':   { bg: '#dcfce7', text: '#15803d' },
  'Advance Confirmed':   { bg: '#cffafe', text: '#0e7490' },
  'Advance Agreed':      { bg: '#ccfbf1', text: '#0f766e' },
  'Advance Paid':        { bg: '#d1fae5', text: '#065f46' },
  'Submitted to Ryder':  { bg: '#dbeafe', text: '#1e3a8a' },
  'Acknowledged':        { bg: '#ede9fe', text: '#5b21b6' },
  'Resubmitted':         { bg: '#ffedd5', text: '#7c2d12' },
  'Paid':                { bg: '#d1fae5', text: '#14532d' },
  'Awaiting Confirmation': { bg: '#fef9c3', text: '#92400e' },
  'Confirmed':           { bg: '#cffafe', text: '#0e7490' },
  'Cancelled':           { bg: '#f1f5f9', text: '#475569' },
  'Void':                { bg: '#fee2e2', text: '#991b1b' },
  'Pending':             { bg: '#fef9c3', text: '#92400e' },
  'Pending Approval':    { bg: '#fef9c3', text: '#92400e' },
  'Overdue 60+':         { bg: '#fee2e2', text: '#991b1b' },
  // Customer-facing badge colours
  'Submitted':                 { bg: '#e0e7ff', text: '#3730a3' },
  'Pending Your Confirmation': { bg: '#fef9c3', text: '#92400e' },
};

export const ROW_BG = {
  'Resubmitted':   '#fffbeb',
  'Acknowledged':  '#fffbeb',
  'Paid':          '#f8fffe',
  'Payment Requested': '#fffdf5',
};

// Customer-facing labels — the customer only sees THREE simple states:
//   • "Submitted"               — anything before the confirmation email
//   • "Pending Your Confirmation" — we emailed them; they must confirm the 97%
//   • "Paid"                    — once they've agreed / been paid (and beyond)
// Everything after the advance is between us and Ryder and doesn't concern
// the customer, so it all reads "Paid".
export const CUSTOMER_STATUS_LABEL = {
  'Uploaded':            'Submitted',
  'Eligible':            'Submitted',
  'Payment Requested':   'Submitted',
  'Advance Confirmed':   'Pending Your Confirmation',
  'Advance Agreed':      'Advance Approved',
  'Advance Paid':        'Advance Approved',
  'Submitted to Ryder':  'Paid',
  'Acknowledged':        'Paid',
  'Resubmitted':         'Paid',
  'Paid':                'Paid',
  'Void':                'Cancelled',
  'Cancelled':           'Cancelled',
};

export const customerStatus = (s) => CUSTOMER_STATUS_LABEL[s] || s;

// Admin-facing status labels — friendlier wording matching the invoice
// timeline, shown on status badges across the admin portal. The DB enum
// value is unchanged; this is display only.
export const ADMIN_STATUS_LABEL = {
  'Uploaded':            'Uploaded',
  'Eligible':            'Eligible',
  'Payment Requested':   'Payment Requested',
  'Advance Confirmed':   'Advance Confirmation Email Sent',
  'Advance Agreed':      'Advance Agreed (RZR Replied)',
  'Advance Paid':        'Advance Paid to RZR',
  'Submitted to Ryder':  'Submitted to Ryder',
  'Acknowledged':        'Acknowledged by Ryder',
  'Resubmitted':         'Resubmitted to Ryder',
  'Paid':                'Paid — Cheque Received',
  'Void':                'Void',
  'Cancelled':           'Cancelled',
};

export const adminStatus = (s) => ADMIN_STATUS_LABEL[s] || s;
