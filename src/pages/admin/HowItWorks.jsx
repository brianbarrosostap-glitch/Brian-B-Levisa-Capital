import React, { useState, useEffect } from 'react'
import {
  Upload, Send, MailCheck, Banknote, Truck, BadgeCheck, Receipt, ArrowRight,
  Bell, AlertTriangle, ListChecks, Clock, Mail, Inbox, BookOpen, Info,
  ArrowUpRight, ArrowDownLeft, FileSearch, LayoutDashboard, ListOrdered, Archive,
  Trash2, Bot, ScrollText, CalendarClock, Zap, User, BellRing, Plug,
} from 'lucide-react'
import { C, shadow, FONT_MONO, STATUS_COLOURS, adminStatus, customerStatus } from '../../tokens'
import { Card, Badge, PartyTag, useIsMobile, useViewportWidth } from '../../components/ui'
import { supabase } from '../../lib/supabase'

// A plain-language guide for new admin users: where invoices come from, every
// automatic step, every email in and out, and which screen to use when.
// Timings and addresses are read live from app_settings (Automation → Settings).

const DEFAULTS = {
  auto_paid_hours: 12, ryder_wait_days: 7, resubmit_hours: 48,
  rzr_email: '', ryder_ap_email: '', admin_alert_email: '', rzr_reply_senders: [], ryder_confirmation_senders: [],
}
const RAIL_MIN_WIDTH = 1360   // viewport width at which the sticky "On this page" rail appears

/* ── text building blocks ── */
const P = ({ children, style }) => (
  <p style={{ margin: '0 0 12px', fontSize: 15, lineHeight: 1.65, color: C.textSm, ...style }}>{children}</p>
)
const B = ({ children }) => <strong style={{ color: C.text, fontWeight: 600 }}>{children}</strong>
const Code = ({ children }) => (
  <code style={{
    fontFamily: FONT_MONO, fontSize: 13, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6,
    padding: '1px 7px', color: C.text, whiteSpace: 'nowrap',
  }}>{children}</code>
)
const SubHead = ({ children }) => (
  <div style={{ fontSize: 13, fontWeight: 700, color: C.textLbl || C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '2px 0 8px' }}>{children}</div>
)
const Bullets = ({ items }) => (
  <ul style={{ margin: '0 0 14px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
    {items.filter(Boolean).map((it, i) => (
      <li key={i} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.6, color: C.textSm }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: C.primMd, flexShrink: 0, marginTop: 9 }} />
        <span style={{ minWidth: 0 }}>{it}</span>
      </li>
    ))}
  </ul>
)

const CALLOUT = {
  info: { bg: '#eff6ff', border: '#bfdbfe', bar: '#3b82f6', text: '#1e3a8a' },
  warn: { bg: '#fffbeb', border: '#fde68a', bar: '#f59e0b', text: '#78350f' },
  good: { bg: C.primLt,  border: '#b7dcc9', bar: C.primMd,  text: '#064e3b' },
}
const Callout = ({ tone = 'info', icon: Icon = Info, children }) => {
  const t = CALLOUT[tone]
  return (
    <div style={{
      display: 'flex', gap: 11, alignItems: 'flex-start', background: t.bg, border: `1px solid ${t.border}`,
      boxShadow: `inset 3px 0 0 ${t.bar}`, borderRadius: 10, padding: '12px 15px 12px 16px', margin: '4px 0 14px',
    }}>
      <Icon size={17} color={t.bar} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 14.5, lineHeight: 1.6, color: t.text, minWidth: 0 }}>{children}</div>
    </div>
  )
}

const GoTo = ({ page, label, onNavigate }) => onNavigate ? (
  <button type="button" onClick={() => onNavigate(page)} className="lc-link lc-focus" style={{
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
    color: C.primary, fontWeight: 600, fontSize: 14.5, textDecoration: 'underline', textUnderlineOffset: 3,
    display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
  }}>{label} <ArrowRight size={13} /></button>
) : null

/** Section card: icon tile (with step number), eyebrow, title, lead, then a divided body. */
const Section = ({ id, n, icon: Icon, title, lead, children }) => {
  const isMobile = useIsMobile()
  return (
    <section id={id} aria-labelledby={`${id}-title`} style={{ marginTop: 18, scrollMarginTop: 18 }}>
      <Card noPad>
        <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: isMobile ? '16px 16px 14px' : '18px 22px 16px', borderBottom: `1px solid ${C.borderLt}` }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: C.primLt, color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(0,121,83,0.12)' }}>
              <Icon size={20} />
            </div>
            {n && (
              <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 99, background: C.primary, color: '#fff', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px #fff' }}>{n}</span>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {n && <div style={{ fontSize: 12, fontWeight: 700, color: C.primMd, letterSpacing: '0.08em', marginBottom: 2 }}>STEP {n} OF 7</div>}
            <h2 id={`${id}-title`} style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.textB, letterSpacing: '-0.015em', lineHeight: 1.25 }}>{title}</h2>
            {lead && <div style={{ fontSize: 14.5, color: C.textMut, marginTop: 3, lineHeight: 1.5 }}>{lead}</div>}
          </div>
        </header>
        <div style={{ padding: isMobile ? '14px 16px 4px' : '18px 22px 6px' }}>{children}</div>
      </Card>
    </section>
  )
}

/** Numbered "what happens → result" list. The result column lines up on the right. */
const Steps = ({ rows }) => {
  const isMobile = useIsMobile()
  return (
    <ol style={{ listStyle: 'none', margin: '0 0 14px', padding: 0, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      {rows.map(([what, result], i) => (
        <li key={i} style={{
          display: 'grid', gridTemplateColumns: isMobile || !result ? '26px minmax(0, 1fr)' : '26px minmax(0, 1fr) auto', columnGap: 12, rowGap: 8,
          alignItems: 'start', padding: '13px 16px', borderTop: i ? `1px solid ${C.borderLt}` : 'none', background: '#fff',
        }}>
          <span style={{ width: 26, height: 26, borderRadius: 99, background: C.panel, border: `1px solid ${C.border}`, color: C.textSm, fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: C.text, minWidth: 0, overflowWrap: 'break-word', paddingTop: 2 }}>{what}</div>
          {result && (
            <div style={{
              gridColumn: isMobile ? '2' : 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
              justifyContent: isMobile ? 'flex-start' : 'flex-end', paddingTop: isMobile ? 0 : 3,
            }}>
              {result && !isMobile && <ArrowRight size={13} color={C.borderMd} />}
              {result}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Outcome chip for a step that doesn't end in an invoice status. */
const Outcome = ({ tone, children }) => {
  const t = { warn: { bg: '#fffbeb', text: '#b45309' }, danger: { bg: '#fef2f2', text: '#b91c1c' }, muted: { bg: '#f1f5f9', text: '#475569' } }[tone]
  return (
    <span style={{ background: t.bg, color: t.text, boxShadow: `inset 0 0 0 1px ${t.text}26`, borderRadius: 99, height: 22, padding: '0 9px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{children}</span>
  )
}

/** Table on desktop; stacked label/value cards on phones (no sideways scrolling). */
const SimpleTable = ({ head, rows, widths }) => {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 14px' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', background: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>{r[0]}</div>
            {r.slice(1).map((c, j) => (
              <div key={j} style={{ padding: '3px 0' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{head[j + 1]}</div>
                <div style={{ fontSize: 14.5, lineHeight: 1.55, color: C.textSm, overflowWrap: 'break-word' }}>{c}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, margin: '0 0 14px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640, tableLayout: widths ? 'fixed' : 'auto' }}>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>}
        <thead>
          <tr style={{ background: C.panel }}>
            {head.map(h => <th key={h} style={{ textAlign: 'left', padding: '11px 16px', fontSize: 12, fontWeight: 700, color: C.textLbl || C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="lc-trow">
              {r.map((c, j) => <td key={j} style={{ padding: '13px 16px', fontSize: 14.5, lineHeight: 1.55, color: j ? C.textSm : C.text, fontWeight: j ? 400 : 600, borderTop: i ? `1px solid ${C.borderLt}` : 'none', verticalAlign: 'top', overflowWrap: 'break-word' }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Coloured heading for the outgoing / incoming email tables. */
const Direction = ({ out, children }) => {
  const t = out ? { bg: C.primLt, text: C.primary, Icon: ArrowUpRight } : { bg: '#e0f2fe', text: '#0369a1', Icon: ArrowDownLeft }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 10px' }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: t.bg, color: t.text, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><t.Icon size={16} /></span>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{children}</span>
    </div>
  )
}

/** First cell of "When the system needs you": tinted icon + place name. */
const Where = ({ icon: Icon, tone, children }) => {
  const t = { red: ['#fef2f2', '#dc2626'], amber: ['#fffbeb', '#d97706'], blue: ['#eff6ff', '#2563eb'], green: [C.primLt, C.primary], grey: ['#f1f5f9', '#475569'] }[tone]
  return (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: t[0], color: t[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={15} /></span>
      <span style={{ paddingTop: 3 }}>{children}</span>
    </span>
  )
}

const Then = ({ children }) => (
  <span style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
    <ArrowRight size={14} color={C.primMd} style={{ flexShrink: 0, marginTop: 4 }} /><span>{children}</span>
  </span>
)
const Value = ({ children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.primLt, color: C.primary, borderRadius: 7, padding: '2px 9px', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
    <Clock size={13} /> {children}
  </span>
)

const S = ({ s }) => <Badge status={s} label={adminStatus(s)} />

/* ── the whole lifecycle at a glance ── */
const FLOW = [
  { status: 'Uploaded',           who: 'RZR / admin uploads',      icon: Upload,     by: 'Upload' },
  { status: 'Payment Requested',  who: 'RZR asks for an advance',  icon: Send,       by: 'RZR action' },
  { status: 'Advance Confirmed',  who: 'Email sent to RZR',        icon: Mail,       by: 'Automatic' },
  { status: 'Advance Agreed',     who: 'RZR replies “Approved”',   icon: MailCheck,  by: 'Automatic' },
  { status: 'Advance Paid',       who: 'Lavisa pays RZR',          icon: Banknote,   by: 'Automatic' },
  { status: 'Submitted to Ryder', who: 'Invoice emailed to Ryder', icon: Truck,      by: 'Automatic' },
  { status: 'Acknowledged',       who: 'Ryder confirms receipt',   icon: BadgeCheck, by: 'Automatic' },
  { status: 'Paid',               who: 'Ryder’s cheque arrives',   icon: Receipt,    by: 'Upload cheque' },
]

const Flow = ({ timing }) => (
  <ol style={{ listStyle: 'none', margin: '0 0 14px', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
    {FLOW.map((f, i) => {
      const Icon = f.icon
      const col = (STATUS_COLOURS[f.status] || {}).text || C.primary
      const auto = f.by === 'Automatic'
      return (
        <li key={f.status} style={{
          position: 'relative', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 11, padding: '12px 14px 12px 16px',
          boxShadow: `${shadow}, inset 3px 0 0 ${col}`, display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 24, height: 24, borderRadius: 99, background: C.primary, color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <Icon size={16} color={col} style={{ flexShrink: 0 }} />
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: '2px 8px',
              background: auto ? C.primLt : C.panel, color: auto ? C.primary : C.textSm, border: `1px solid ${auto ? '#c9e6d7' : C.border}`, whiteSpace: 'nowrap',
            }}>{auto ? <Zap size={11} /> : <User size={11} />} {f.by}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.35 }}>{f.who}</div>
          <div><Badge status={f.status} label={adminStatus(f.status)} /></div>
          {timing[f.status] && <div style={{ fontSize: 13, color: C.textMut, display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={12} /> {timing[f.status]}</div>}
        </li>
      )
    })}
  </ol>
)

const TOC = [
  ['overview', 'The big picture'], ['flow', 'Lifecycle at a glance'], ['s1', '1 · Invoices come in'],
  ['s2', '2 · RZR requests an advance'], ['s3', '3 · RZR’s reply'], ['s4', '4 · Advance paid'],
  ['s5', '5 · Sent to Ryder'], ['s6', '6 · Ryder confirms'], ['s7', '7 · Ryder pays (cheques)'],
  ['emails', 'All emails in & out'], ['you', 'When the system needs you'], ['screens', 'Admin screens'],
  ['customer', 'What RZR sees'], ['statuses', 'Every status'], ['settings', 'Timings & settings'],
]

const SCREENS = [
  ['dashboard', 'Dashboard', LayoutDashboard, 'Totals and charts for the chosen dates, the Audit To-Do list and Needs Attention. Every tile opens the matching invoices in Master.'],
  ['master', 'Master', ListOrdered, 'Every active invoice. Search by invoice #, PO, unit, cheque # or ADV number; filter by stage; open an invoice for its full timeline; row menu for manual actions (Advance Paid, Resubmit, Void…).'],
  ['cheques', 'Cheques', Receipt, 'Every cheque received and the invoices it paid. Upload new cheques here.'],
  ['review', 'Upload Review', FileSearch, 'Uploads the portal couldn’t read cleanly — fix and approve, retry, or reject.'],
  ['past', 'Past Invoices', Archive, 'Finished invoices: Paid, Void and Cancelled.'],
  ['deleted', 'Deleted Invoices', Trash2, 'Invoices RZR or an admin deleted — restore them from here.'],
  ['alerts', 'Alerts', BellRing, 'Every error in one place: broken connections, failed jobs, emails that could not be sent, failed uploads, mailbox emails not handled, open cheque alerts. The red badge counts problems from the last 24 hours.'],
  ['connections', 'Connections', Plug, 'Live status of every outside service (Gmail sending, Gemini, Composio Gmail/Drive/Sheets, the PDF services, the timers), checked every hour — with steps to fix one that breaks.'],
  ['automation', 'Automation', Bot, 'Addresses and timings (Settings), every email sent, every scheduled run, and every email read. Advanced switches at the bottom pause a job.'],
  ['audit', 'Audit Logs', ScrollText, 'Who did what and when — every change, by a person or by the system.'],
]

// Smooth scroll, unless the user asked the OS for reduced motion.
const jump = (id) => document.getElementById(id)?.scrollIntoView({
  behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
})

/** Highlights the section currently at the top of the scroll area. */
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    // The page scrolls inside PageContent, not the window — find that scroller.
    let scroller = document.getElementById(ids[0])?.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (!scroller) return
    const update = () => {
      const top = scroller.getBoundingClientRect().top + 140   // a section counts once its top passes this line
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= top) current = id
      }
      setActive(atEnd ? ids[ids.length - 1] : current)
    }
    // 15 rect reads per scroll event is cheap — no throttling needed.
    scroller.addEventListener('scroll', update, { passive: true })
    const first = setTimeout(update, 0)
    return () => { scroller.removeEventListener('scroll', update); clearTimeout(first) }
  }, [ids])
  return [active, setActive]
}

const TOC_IDS = TOC.map(t => t[0])

const Rail = () => {
  const [active, setActive] = useActiveSection(TOC_IDS)
  return (
    <nav aria-label="On this page" style={{ position: 'sticky', top: 0, width: 236, flexShrink: 0, alignSelf: 'flex-start' }}>
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: shadow, padding: '14px 10px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMut, letterSpacing: '0.06em', padding: '0 8px 8px' }}>ON THIS PAGE</div>
        {TOC.map(([id, label]) => {
          const on = id === active
          return (
            <button key={id} type="button" onClick={() => { setActive(id); jump(id) }} aria-current={on ? 'location' : undefined} className="lc-seg lc-focus" style={{
              display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: on ? C.primLt : 'transparent', color: on ? C.primary : C.textSm, fontWeight: on ? 600 : 500,
              fontSize: 14, lineHeight: 1.35, padding: '6px 10px', borderRadius: 7, boxShadow: on ? `inset 2px 0 0 ${C.primMd}` : 'none',
            }}>{label}</button>
          )
        })}
      </div>
    </nav>
  )
}

export default function HowItWorks({ onNavigate }) {
  const isMobile = useIsMobile()
  const showRail = useViewportWidth() >= RAIL_MIN_WIDTH
  const [cfg, setCfg] = useState(DEFAULTS)

  useEffect(() => {
    supabase.from('app_settings').select('key, value').then(({ data, error }) => {
      if (error || !data) return   // keep the defaults — the guide still reads fine
      setCfg(c => ({ ...c, ...Object.fromEntries(data.map(r => [r.key, r.value])) }))
    })
  }, [])

  const H = Number(cfg.auto_paid_hours) || 12
  const D = Number(cfg.ryder_wait_days) || 7
  const R = Number(cfg.resubmit_hours) || 48
  const addr = (v, fallback) => v ? <Code>{v}</Code> : <B>{fallback}</B>
  const rzr = addr(cfg.rzr_email, 'RZR’s email')
  const ryder = addr(cfg.ryder_ap_email, 'Ryder’s AP inbox')
  const alertTo = addr(cfg.admin_alert_email, 'the admin alert email')
  const senders = Array.isArray(cfg.rzr_reply_senders) && cfg.rzr_reply_senders.length
    ? cfg.rzr_reply_senders.map((s, i) => <React.Fragment key={s}>{i ? ', ' : ''}<Code>{s}</Code></React.Fragment>)
    : <B>the RZR reply senders</B>
  const confFrom = Array.isArray(cfg.ryder_confirmation_senders) && cfg.ryder_confirmation_senders.length
    ? cfg.ryder_confirmation_senders.map((s, i) => <React.Fragment key={s}>{i ? ', ' : ''}<Code>{s}</Code></React.Fragment>)
    : <Code>workflow@docufree.com</Code>
  const go = (page, label) => <GoTo page={page} label={label} onNavigate={onNavigate} />

  const timing = {
    'Advance Confirmed': 'as soon as the email is sent',
    'Advance Paid': `${H} h after RZR agrees`,
    'Submitted to Ryder': `${D} days after Advance Paid`,
    'Acknowledged': `resent every ${R} h until then`,
  }
  const pad = isMobile ? '18px 16px' : '22px 24px'

  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', maxWidth: showRail ? 1460 : 1180 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Intro ── */}
        <section id="overview" aria-labelledby="overview-title" style={{ scrollMarginTop: 18 }}>
          <Card noPad>
            <div style={{ padding: pad }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: C.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 10px rgba(0,121,83,0.25)' }}><BookOpen size={23} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.primMd, letterSpacing: '0.08em' }}>ADMIN GUIDE</div>
                  <h1 id="overview-title" style={{ margin: '2px 0 0', fontSize: isMobile ? 22 : 26, fontWeight: 700, color: C.textB, letterSpacing: '-0.02em', lineHeight: 1.2 }}>How the system works</h1>
                </div>
              </div>
              <P style={{ marginTop: 14, fontSize: 15.5, maxWidth: 900 }}>
                Levisa Capital pays <B>RZR</B> an advance of <B>97%</B> of each invoice RZR has billed to <B>Ryder</B>.
                Ryder later pays the <B>full invoice</B> to Lavisa by cheque — the 3% difference is Lavisa’s fee.
                This portal runs that whole cycle: it reads the invoices, emails RZR and Ryder, reads their replies
                and the cheques, and moves every invoice to the next status on its own. You step in only when something
                can’t be done automatically.
              </P>

              {/* key figures */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, margin: '4px 0 14px' }}>
                {[
                  ['97%', 'Advance paid to RZR', 'RZR'],
                  ['100%', 'Full invoice paid by Ryder', 'Ryder'],
                  ['3%', 'Lavisa’s fee', 'Lavisa'],
                  [`${H} h · ${D} d`, 'Agreed → paid · paid → sent to Ryder', null],
                ].map(([v, l, party]) => (
                  <div key={l} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', background: C.panel }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: C.textB, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                      {party ? <PartyTag party={party} /> : <CalendarClock size={16} color={C.textMut} />}
                    </div>
                    <div style={{ fontSize: 13, color: C.textSm, marginTop: 2, lineHeight: 1.4 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* the three parties */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
                {[['RZR', 'the customer — uploads invoices and receives the advance'],
                  ['Ryder', 'the debtor — receives the invoice and pays it by cheque'],
                  ['Lavisa', 'us — pays the advance, collects from Ryder, keeps 3%']].map(([p, d]) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 14.5, lineHeight: 1.5, color: C.textSm, border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ paddingTop: 2 }}><PartyTag party={p} /></span><span>{d}</span>
                  </div>
                ))}
              </div>
            </div>

            {!showRail && (
              <nav aria-label="Jump to section" style={{ borderTop: `1px solid ${C.borderLt}`, background: '#fbfcfd', padding: isMobile ? '12px 16px' : '14px 24px', display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.textMut, letterSpacing: '0.06em', marginRight: 4 }}>JUMP TO</span>
                {TOC.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => jump(id)} className="lc-seg lc-focus" style={{
                    border: `1px solid ${C.border}`, background: '#fff', color: C.textSm, borderRadius: 99, height: 30,
                    padding: '0 12px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{label}</button>
                ))}
              </nav>
            )}
          </Card>
        </section>

        {/* ── Flow ── */}
        <section id="flow" aria-labelledby="flow-title" style={{ marginTop: 18, scrollMarginTop: 18 }}>
          <Card noPad>
            <div style={{ padding: pad }}>
              <h2 id="flow-title" style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: C.textB, letterSpacing: '-0.015em' }}>The life of an invoice</h2>
              <P>Every invoice goes through these steps in order. Everything after “RZR asks for an advance” happens automatically.</P>
              <Flow timing={timing} />
              <Callout tone="info">
                An invoice that RZR uploaded but hasn’t asked an advance for yet simply waits at <B>Uploaded</B>.
                <B> Void</B> and <B>Cancelled</B> take an invoice out of the cycle (admin only) — it then moves to Past Invoices.
              </Callout>
            </div>
          </Card>
        </section>

        {/* ── 1 ── */}
        <Section id="s1" n={1} icon={Upload} title="Invoices come in" lead="RZR uploads its invoices to the portal (an admin can too).">
          <SubHead>Where invoices are uploaded</SubHead>
          <Bullets items={[
            <><B>RZR</B> — “Upload invoice” on their <B>Invoices to Advance</B> or <B>My Uploads</B> page.</>,
            <><B>Admin</B> — the “Upload invoice” button on <B>Master</B> (choose the customer).</>,
            <>Accepted: <B>PDF</B>, a <B>photo</B> of the invoice, an <B>Excel</B> file, or a <B>Google Sheet link</B>. Several files can go at once.</>,
          ]} />
          <SubHead>What the system does with each file</SubHead>
          <Steps rows={[
            ['The file is stored safely in the portal. Excel/Sheets are read directly; PDFs and photos are read by AI (Google Gemini). A PDF copy is kept — that is what Ryder will receive later.', null],
            [<>It checks what it read: <B>invoice number</B>, <B>amount</B> (grand total), <B>invoice date</B>, <B>PO number</B>, Ryder vendor # (when set for the customer), that the <B>charge lines add up</B> to the total before taxes, and that <B>total + taxes = grand total</B>. If a check fails it re-reads with a stronger AI model once.</>, null],
            ['All checks pass → the invoice is created automatically.', <S s="Uploaded" />],
            [<>Any check fails → it waits in <B>Upload Review</B> for you to correct and approve (nothing is created yet).</>, <Outcome tone="warn">Upload Review</Outcome>],
            ['The same file again, or an invoice number that already exists → marked “Duplicate”, nothing is created.', <Outcome tone="muted">Duplicate</Outcome>],
          ]} />
          <P>RZR sees the result of every upload on <B>My Uploads</B>. {go('review', 'Open Upload Review')}</P>
        </Section>

        {/* ── 2 ── */}
        <Section id="s2" n={2} icon={Send} title="RZR requests an advance" lead="RZR picks invoices and clicks Submit — no admin approval is needed.">
          <Steps rows={[
            ['On Invoices to Advance, RZR ticks the invoices it wants advanced and clicks Submit. They become one request (REQ-YYYY-NNN).', <S s="Payment Requested" />],
            [<>The portal emails {rzr} — subject <Code>Payment Request for #&lt;invoice numbers&gt;</Code> — with a table of each invoice, its PO, the amount and the <B>97% advance</B>, asking them to reply <B>Approved</B> or <B>Accepted</B>.</>, null],
            ['As soon as that email has been sent, the invoices move on automatically.', <S s="Advance Confirmed" />],
          ]} />
          <Callout tone="info">RZR can delete an invoice only while it is still <B>Uploaded</B> (not yet requested). It disappears from the portal but is kept under <B>Deleted Invoices</B>, where you can restore it.</Callout>
        </Section>

        {/* ── 3 ── */}
        <Section id="s3" n={3} icon={MailCheck} title="RZR’s reply comes back" lead="The portal reads the Levisa mailbox every 5 minutes.">
          <Steps rows={[
            [<>RZR replies to the payment-request email. Only replies from {senders} count.</>, null],
            [<>If the <B>new</B> part of the reply says <B>“Approved”</B> or <B>“Accepted”</B> (quoted older text is ignored), every invoice listed in the subject is agreed. An <B>advance number</B> (ADV-0001…) is given to the request.</>, <S s="Advance Agreed" />],
            [<>Any other reply (a question, “not approved”…) changes nothing: an alert email goes to {alertTo} and a bell notification appears, so you can follow up.</>, <Outcome tone="danger">Not approved alert</Outcome>],
          ]} />
          <P>Every email the portal read, and what it did with it, is listed in Automation → Mailbox. {go('automation', 'Open Automation')}</P>
        </Section>

        {/* ── 4 ── */}
        <Section id="s4" n={4} icon={Banknote} title="The advance is paid to RZR" lead={`Automatically ${H} hours after RZR agreed.`}>
          <Steps rows={[
            [<>{H} hours after RZR agreed, the invoices are marked paid out and RZR gets an email “<B>Invoice :- … is Paid</B>” at {rzr}.</>, <S s="Advance Paid" />],
            ['You can also mark it earlier by hand: Master → row menu, or the invoice’s detail window → “Mark Advance Paid” (RZR gets the same email).', null],
            [<>Dashboard → <B>Audit To-Do</B> → “Advances” lists each advance number with its total, so you can tick it off against the bank transfer.</>, null],
          ]} />
        </Section>

        {/* ── 5 ── */}
        <Section id="s5" n={5} icon={Truck} title="The invoice is sent to Ryder" lead={`Automatically ${D} days after Advance Paid.`}>
          <Steps rows={[
            [<>{D} days after the advance was paid, the invoice PDF is emailed to {ryder} — subject <Code>#&lt;invoice number&gt;</Code>, PDF attached (exactly how Ryder’s system expects it).</>, <S s="Submitted to Ryder" />],
            [<>If Ryder hasn’t confirmed, it is <B>sent again every {R} hours</B> (counted from the last send), with no limit, until Ryder confirms. Each resend is counted on the invoice; the status stays Submitted to Ryder.</>, null],
            ['Need it resent right now? Master → row menu → Resubmit sends it immediately (shown as Resubmitted until the email has gone).', <S s="Resubmitted" />],
            [<>After <B>3 sends or 7 days</B> without a confirmation, the invoice appears in Dashboard → Audit To-Do → “<B>Ryder — no confirmation</B>” so someone can check with Ryder. It clears itself once Ryder confirms.</>, null],
          ]} />
        </Section>

        {/* ── 6 ── */}
        <Section id="s6" n={6} icon={BadgeCheck} title="Ryder confirms the invoice" lead="Ryder’s system (Docufree) emails a confirmation; the portal picks it up every 5 minutes.">
          <Steps rows={[
            [<>An email from {confFrom}, “<B>Invoice Confirmation from Ryder #&lt;conf&gt;</B>”, arrives in the Levisa mailbox.</>, null],
            ['The portal opens its “View Invoice” link, reads the invoice number on that page, and records Ryder’s confirmation number. (An email without that link counts when its text contains the portal invoice number.)', <S s="Acknowledged" />],
            [<>A <B>due date 60 days</B> later is set. If the cheque hasn’t arrived by then the invoice counts as <B>Overdue</B> — it shows in Dashboard → Needs Attention and in the Master filter “Overdue with Ryder”.</>, null],
          ]} />
        </Section>

        {/* ── 7 ── */}
        <Section id="s7" n={7} icon={Receipt} title="Ryder pays — cheques" lead="Upload a photo or PDF of Ryder’s cheque; it is applied automatically (no approval step).">
          <Steps rows={[
            [<>Upload on the <B>Cheques</B> page (“Upload cheques”, several at once) or from Dashboard → Audit To-Do → Cheques column → Upload.</>, null],
            ['AI reads the cheque: number, date, total, and every invoice line on the remittance.', null],
            [<>Each line is matched to its invoice <B>by amount</B> across the whole cheque — this fixes blurry or misread invoice numbers. Matched invoices are marked paid straight away.</>, <S s="Paid" />],
            [<>A line that can’t be matched safely is <B>never</B> marked paid — it is listed in an alert and a bell notification (“Cheque applied — please check”), together with short payments or totals that don’t add up.</>, null],
            ['Only an unreadable photo (no amount found) goes to Upload Review — retake it or type the details there.', null],
            [<>Dashboard → Audit To-Do → “Cheques” lists each cheque so you can tick it off against the bank deposit.</>, null],
          ]} />
          <P>{go('cheques', 'Open Cheques')}</P>
        </Section>

        {/* ── Emails ── */}
        <Section id="emails" icon={Mail} title="Every email in and out" lead="All emails are sent from and read in the Levisa mailbox. Each is logged in Automation → Emails / Mailbox.">
          <Direction out>Sent by the portal</Direction>
          <SimpleTable head={['Email', 'To', 'When', 'Subject']} rows={[
            ['Payment request', rzr, 'RZR submits invoices for an advance', <Code>Payment Request for #…</Code>],
            ['Advance paid', rzr, `${H} h after RZR agrees, or when you mark Advance Paid`, <Code>#&lt;invoice numbers&gt;</Code>],
            ['Invoice to Ryder', ryder, `${D} days after Advance Paid, then every ${R} h until confirmed`, <Code>#&lt;invoice number&gt;</Code>],
            ['Not approved alert', alertTo, 'RZR replied without “Approved/Accepted”', <Code>Not approved: …</Code>],
          ]} />
          <Direction>Read by the portal (every 5 minutes)</Direction>
          <SimpleTable head={['Email', 'From', 'What the portal does']} rows={[
            ['RZR’s reply to a payment request', senders, '“Approved/Accepted” → Advance Agreed. Anything else → not-approved alert to you.'],
            ['Ryder invoice confirmation', confFrom, 'Reads the invoice # → Acknowledged, confirmation # saved, 60-day due date set.'],
          ]} />
          <Callout tone="good" icon={Inbox}>The portal looks only at <B>unread</B> emails and <B>marks each one read</B> once it has handled it (as n8n did) — it never deletes or moves emails, and it handles each email once. One it couldn’t handle stays unread so you notice it. A failed send is retried automatically (up to 5 attempts); failures show in red in Automation → Emails.</Callout>
        </Section>

        {/* ── Needs you ── */}
        <Section id="you" icon={AlertTriangle} title="When the system needs you" lead="Everything else runs on its own — check these places.">
          <SimpleTable head={['Where', 'What it means', 'What to do']} widths={['27%', '40%', '33%']} rows={[
            [<Where icon={BellRing} tone="red">Alerts <span style={{ color: C.red, fontWeight: 500 }}>(red badge)</span></Where>, 'Everything that went wrong, from every part of the system, in one list.', <Then>Start here — each alert links to the screen where you fix it.</Then>],
            [<Where icon={Plug} tone="amber">Connections</Where>, 'An outside service broke (e.g. the Gemini key expired, Gmail needs re-authorising). You also get a notification and an email.', <Then>Follow the “How to fix” steps on the card, then press Check now.</Then>],
            [<Where icon={FileSearch} tone="red">Upload Review <span style={{ color: C.red, fontWeight: 500 }}>(red badge)</span></Where>, 'An invoice failed a check, or a cheque photo couldn’t be read.', <Then>Correct the fields and “Approve &amp; save”, “Retry reading”, or Reject.</Then>],
            [<Where icon={Bell} tone="blue">Bell notifications</Where>, 'Not-approved replies from RZR, and every cheque applied — including lines that didn’t match or short payments.', <Then>Open and follow up.</Then>],
            [<Where icon={AlertTriangle} tone="amber">Dashboard → Needs Attention</Where>, 'Invoices overdue with Ryder (past the 60-day due date, cheque not received).', <Then>Click a row to open it in Master, then chase Ryder.</Then>],
            [<Where icon={ListChecks} tone="green">Dashboard → Audit To-Do</Where>, 'Advances to check against the bank transfer, cheques against the bank deposit, invoices Ryder hasn’t confirmed.', <Then>Verify, tick, and press Submit.</Then>],
            [<Where icon={Mail} tone="red">Automation → Emails</Where>, 'An email that failed to send.', <Then>Check the address in Settings, then “Send queued now”.</Then>],
            [<Where icon={Bot} tone="grey">Automation → Scheduled job runs</Where>, 'A run marked “error” (e.g. the mailbox couldn’t be read).', <Then>Read the summary; if it repeats, tell your developer.</Then>],
          ]} />
        </Section>

        {/* ── Screens ── */}
        <Section id="screens" icon={ListChecks} title="The admin screens" lead="What each tab in the sidebar is for.">
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, marginBottom: 14 }}>
            {SCREENS.map(([key, name, Icon, desc]) => (
              <button key={key} type="button" onClick={onNavigate ? () => onNavigate(key) : undefined} className="lc-card lc-tile lc-focus"
                aria-label={`Open ${name}`} style={{
                  textAlign: 'left', fontFamily: 'inherit', cursor: onNavigate ? 'pointer' : 'default',
                  border: `1px solid ${C.border}`, borderRadius: 11, padding: '14px 15px', background: '#fff', boxShadow: shadow,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                <span style={{ width: 36, height: 36, borderRadius: 9, background: C.sidebar, color: '#9fe3c6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={17} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 700, color: C.text }}>{name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 13.5, fontWeight: 600, color: C.primary }}>
                      Open <ArrowRight size={13} className="lc-tile-go" />
                    </span>
                  </span>
                  <span style={{ display: 'block', fontSize: 14, lineHeight: 1.55, color: C.textSm }}>{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Customer ── */}
        <Section id="customer" icon={Info} title="What RZR sees" lead="RZR has its own, simpler portal.">
          <Bullets items={[
            <><B>Invoices to Advance</B> — upload invoices, select some and submit an advance request, or delete one.</>,
            <><B>Advanced Invoices</B> — invoices already requested, with their progress.</>,
            <><B>My Uploads</B> — every file they uploaded and whether it was added, a duplicate, or waiting for review.</>,
            <>RZR never sees Ryder information, cheques or internal statuses. They see simpler words instead — for example:</>,
          ]} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 8, margin: '-4px 0 14px 16px' }}>
            {['Payment Requested', 'Advance Confirmed', 'Advance Agreed', 'Advance Paid'].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: `1px solid ${C.borderLt}`, borderRadius: 9, padding: '8px 11px', background: '#fcfdfd' }}>
                <S s={s} />
                <ArrowRight size={13} color={C.textMut} />
                <span style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>“{customerStatus(s)}”</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Statuses ── */}
        <Section id="statuses" icon={BadgeCheck} title="Every status" lead="What each badge means and what moves it on.">
          <SimpleTable head={['Status', 'Meaning', 'Moves on when']} widths={['30%', '36%', '34%']} rows={[
            [<S s="Uploaded" />, 'Invoice is in the portal, not requested yet.', <Then>RZR submits it for an advance.</Then>],
            [<S s="Payment Requested" />, 'RZR asked for the advance; the email to RZR is queued.', <Then>The payment-request email is sent (within minutes).</Then>],
            [<S s="Advance Confirmed" />, 'Email sent; waiting for RZR’s “Approved/Accepted”.', <Then>RZR replies Approved/Accepted.</Then>],
            [<S s="Advance Agreed" />, 'RZR agreed; an ADV number is assigned.', <Then>{H} hours pass, or you mark it Advance Paid.</Then>],
            [<S s="Advance Paid" />, 'The 97% advance went to RZR.', <Then>{D} days pass → emailed to Ryder.</Then>],
            [<S s="Submitted to Ryder" />, 'Invoice sent to Ryder; waiting for their confirmation.', <Then>Ryder confirms (resent every {R} h until then).</Then>],
            [<S s="Resubmitted" />, 'You asked for a manual resend to Ryder.', <Then>The email goes out → back to Submitted to Ryder.</Then>],
            [<S s="Acknowledged" />, 'Ryder confirmed it; due in 60 days.', <Then>Ryder’s cheque is uploaded.</Then>],
            [<S s="Paid" />, 'Ryder’s cheque received — finished.', <span style={{ color: C.borderMd }}>—</span>],
            [<span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}><S s="Void" /> <S s="Cancelled" /></span>, 'Taken out of the cycle by an admin.', <span style={{ color: C.borderMd }}>—</span>],
          ]} />
        </Section>

        {/* ── Settings ── */}
        <Section id="settings" icon={Clock} title="Timings & settings" lead="Current values — change them in Automation → Settings.">
          <SimpleTable head={['Setting', 'Current value', 'Used for']} rows={[
            ['Auto-paid after', <Value>{H} hours</Value>, 'RZR agreed → Advance Paid'],
            ['Send to Ryder after', <Value>{D} days</Value>, 'Advance Paid → invoice emailed to Ryder'],
            ['Resubmit every', <Value>{R} hours</Value>, 'Resend to Ryder until confirmed'],
            ['RZR email', rzr, 'Payment-request and “paid” emails'],
            ['RZR reply senders', senders, 'Whose replies can approve an advance'],
            ['Ryder AP email', ryder, 'Where invoices are submitted'],
            ['Ryder confirmation senders', confFrom, 'Whose “Invoice Confirmation from Ryder” emails are read'],
            ['Admin alert email', alertTo, 'Not-approved replies and failure alerts'],
          ]} />
          <Callout tone="good" icon={CalendarClock}>
            Fixed rules: the advance is <B>97%</B> of the invoice; Ryder’s due date is <B>60 days</B> after it confirms; the mailbox is read every <B>5 minutes</B> and scheduled jobs run every <B>10 minutes</B>, so a step can happen up to 10 minutes after its time. {go('automation', 'Open Automation')}
          </Callout>
        </Section>
      </div>

      {showRail && <Rail />}
    </div>
  )
}
