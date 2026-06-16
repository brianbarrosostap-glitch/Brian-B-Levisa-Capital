import React, { useState, useEffect } from 'react'
import { ExternalLink, Check } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Badge, TH, TD } from '../../components/ui'
import { supabase } from '../../lib/supabase'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const YesNo = ({ val }) => val
  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.primary, fontWeight: 600, fontSize: 12 }}><Check size={12} strokeWidth={3} /> Yes</span>
  : <span style={{ fontSize: 12, color: C.textMut }}>Awaiting</span>

const DriveBadge = ({ url }) => (
  <a href={url || '#'} target={url ? '_blank' : undefined} rel="noreferrer" onClick={!url ? e => e.preventDefault() : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', border: `1px solid ${C.border}`, borderRadius: 6, color: '#1e40af', fontSize: 11, padding: '2px 7px', textDecoration: 'none' }}>
    <ExternalLink size={9} /> View
  </a>
)

export default function AdvancedInvoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => { fetchInvoices() }, [])

  const fetchInvoices = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: client }   = await supabase.from('clients').select('id').eq('owner_id', user.id).single()
    if (!client) { setLoading(false); return }

    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_amount, advance_amount, submitted_at, confirmed_at, advance_paid_at, status, drive_file_url')
      .eq('client_id', client.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })

    if (data) setInvoices(data)
    setLoading(false)
  }

  return (
    <div>
      <Card noPad>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Invoice #</TH>
                <TH style={{ textAlign: 'right' }}>Invoice Amount</TH>
                <TH style={{ textAlign: 'right' }}>Advance @97%</TH>
                <TH>Submitted</TH>
                <TH>Confirmed</TH>
                <TH>Advance Paid</TH>
                <TH>Status</TH>
                <TH>Invoice</TH>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={inv.id} style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5fdf8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <TD mono>{inv.invoice_number}</TD>
                  <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</TD>
                  <TD accent style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.advance_amount)}</TD>
                  <TD muted style={{ fontSize: 12 }}>{inv.submitted_at ? new Date(inv.submitted_at).toLocaleString() : '—'}</TD>
                  <TD><YesNo val={!!inv.confirmed_at} /></TD>
                  <TD><YesNo val={!!inv.advance_paid_at} /></TD>
                  <TD><Badge status={inv.status} /></TD>
                  <TD><DriveBadge url={inv.drive_file_url} /></TD>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>No advanced invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
