// Shared mock data

export const ADMIN_INVOICES = [
  { id: 'inv-1', date: '10/10/2025', invoice: '2215-5964', unit: '248,773', amount: 2082.17, advance: 2019.70, status: 'Paid' },
  { id: 'inv-2', date: '12/5/2025',  invoice: '2715-6407', unit: '777,769', amount: 1897.41, advance: 1837.49, status: 'Resubmitted' },
  { id: 'inv-3', date: '11/20/2025', invoice: '2215-6030', unit: '785,737', amount: 521.22,  advance: 505.58,  status: 'Acknowledged' },
  { id: 'inv-4', date: '2/21/2026',  invoice: '2715-6315', unit: '234,019', amount: 922.32,  advance: 894.65,  status: 'Submitted to Ryder' },
  { id: 'inv-5', date: '3/15/2026',  invoice: '2215-7002', unit: '501,338', amount: 1450.00, advance: 1406.50, status: 'Acknowledged' },
  { id: 'inv-6', date: '5/1/2026',   invoice: '2215-7055', unit: '678,912', amount: 3200.00, advance: 3104.00, status: 'Advance Paid' },
  { id: 'inv-7', date: '5/28/2026',  invoice: '2215-7102', unit: '312,450', amount: 3150.00, advance: 3055.50, status: 'Payment Requested', batchId: 'REQ-2026-014' },
  { id: 'inv-8', date: '5/30/2026',  invoice: '2215-7108', unit: '398,221', amount: 1820.75, advance: 1766.13, status: 'Payment Requested', batchId: 'REQ-2026-014' },
];

export const PENDING_REQUEST = {
  id: 'REQ-2026-014',
  client: 'RZR Inc',
  submittedDate: 'Jun 5, 2026',
  submittedTime: '8:14 AM',
  invoices: [
    { invoice: '2215-7102', unit: '372,450', amount: 3150.00, advance: 3055.50 },
    { invoice: '2215-7108', unit: '388,221', amount: 1820.75, advance: 1766.13 },
  ],
};

export const NEEDS_ATTENTION = [
  {
    type: 'amber',
    title: 'Confirmation Number Match',
    detail: 'Invoice 2215-6030 — Ryder email (conf. #11042301) could not be auto-matched to this invoice.',
    action: 'Match Now',
    invoice: '2215-6030',
    confNum: '11042301',
    amount: 521.22,
    unit: '785,737',
    status: 'Acknowledged',
  },
  {
    type: 'red',
    title: 'Check Unreadable',
    detail: 'Invoice 2215-7055 — Check #4471 scanned but invoice ID is unreadable.',
    action: 'Enter Manually',
    invoice: '2215-7055',
  },
];

export const INVOICE_DETAIL = {
  invoice: '2215-7002',
  status: 'Acknowledged',
  client: 'RZR Inc',
  debtor: 'Ryder Systems',
  unit: '501,338',
  invoicedDate: '3/15/2026',
  amount: 1450.00,
  advancePct: 97,
  advance: 1406.50,
  dueDate: '4/29/2026',
  factoringFee: 43.50,
  submittedDate: '3/15/2026',
  confirmDate: '3/13/2026',
  paidDate: null,
  ryderSubmitted: '3/15/2026',
  ryderConf: '10040022',
  daysOut: 90,
  contact: 'Sarah Mitchell',
  email: 'sarah@rzrinc.com',
  discount: '3%',
  timeline: [
    { label: 'Payment Requested', date: '3/13/2026', done: true },
    { label: 'Advance Confirmed', date: '3/13/2026', done: true },
    { label: 'Advance Paid', date: '3/13/2026', done: true },
    { label: 'Submitted to Ryder', date: '3/13/2026', done: true },
    { label: 'Acknowledged', date: '', done: false, current: true },
    { label: 'Paid', date: '', done: false },
  ],
};

export const CUSTOMER_INVOICES = [
  { id: 'c-1', date: '5/28/2026',  invoice: '2215-7102', unit: '312,450', amount: 3150.00, advance: 3055.50, drive: true, selected: true },
  { id: 'c-2', date: '5/30/2026',  invoice: '2215-7108', unit: '398,221', amount: 1820.75, advance: 1766.13, drive: true, selected: true },
  { id: 'c-3', date: '6/2/2026',   invoice: '2215-7115', unit: '290,100', amount: 2640.00, advance: 2560.80, drive: true, selected: false },
  { id: 'c-4', date: '6/4/2026',   invoice: '2215-7120', unit: '410,550', amount: 975.50,  advance: 946.24,  drive: true, selected: false },
  { id: 'c-5', date: '6/6/2026',   invoice: '2215-7131', unit: '187,330', amount: 1420.00, advance: 1377.40, drive: true, selected: false },
];

export const ADVANCED_INVOICES = [
  { invoice: '2215-7102', amount: 3150.00, advance: 3055.50, submitted: '6/5/2026 9:14 AM', confirmed: 'Awaiting', paid: 'Not yet', status: 'Awaiting Confirmation' },
  { invoice: '2215-7108', amount: 1820.75, advance: 1766.13, submitted: '6/5/2026 9:14 AM', confirmed: 'Awaiting', paid: 'Not yet', status: 'Awaiting Confirmation' },
  { invoice: '2215-7055', amount: 3200.00, advance: 3104.00, submitted: '5/1/2026 9:14 AM',  confirmed: 'Yes', paid: 'Not yet', status: 'Confirmed' },
  { invoice: '2215-7002', amount: 1450.00, advance: 1406.50, submitted: '3/15/2026 2:08 PM', confirmed: 'Yes', paid: 'Yes',     status: 'Advance Paid' },
  { invoice: '2215-6315', amount: 922.32,  advance: 894.65,  submitted: '2/21/2026 11:30 AM',confirmed: 'Yes', paid: 'Yes',     status: 'Advance Paid' },
  { invoice: '2215-5964', amount: 2082.17, advance: 2019.70, submitted: '10/10/2025 10:22 AM',confirmed: 'Yes', paid: 'Yes',    status: 'Advance Paid' },
];

export const KPI_DATA = {
  totalInvoices: 8,
  pendingInvoices: 4,
  awaitingConf: 2,
  openPaymentReqs: 1,
  overdue: 3,
  totalFaceValue: 13144.14,
  totalAdvanced: 8205.14,
  discountRevenue: 253.73,
  pendingWithRyder: 2458.63,
  collectedFromRyder: 2082.17,
};
