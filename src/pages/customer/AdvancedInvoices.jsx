import React, { useState, useEffect } from 'react'
import { ExternalLink, Check } from 'lucide-react'
import { C, customerStatus } from '../../tokens'
import { Card, Badge, Btn, TH, TD } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Once Brian approves, the customer can see the 97% advance amount.
const APPROVED = ['Advance Confirmed', 'Advance Agreed', 'Advance Paid', 'Submitted to Ryder', 'Acknowledged', 'Resubmitted', 'Paid']

const DriveBadge = ({ url }) => (
  <a href={url || '#'} target={url ? '_blank' : undefined} rel="noreferrer" onClick={!url ? e => e.preventDefault() : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', border: `1px solid ${C.border}`, borderRadius: 6, color: '#1e40af', fontSize: 11, padding: '2px 7px', textDecoration: 'none' }}>
    <ExternalLink size={9} /> View
  </a>
)

// Friendly status pill using the customer label map.
const CustomerBadge = ({ status }) => <Badge status={customerStatus(status)} />

export default function AdvancedInvoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)
  const [agreeing, setAgreeing] = useState(null)

  useEffect(() => { fetchInvoices() }, [])

  const fetchInvoices = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: client }   = await supabase.from('clients').select('id').eq('owner_id', user.id).single()
    if (!client) { setLoading(false); return }

    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_amount, advance_amount, submitted_at, status, drive_file_url')
      .eq('client_id', client.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })

    if (data) setInvoices(data)
    setLoading(false)
  }

  // Customer agrees to the 97% terms → Advance Confirmed → Advance Agreed.
  const agree = async (inv) => {
    setAgreeing(inv.id)
    try {
      await callFunction('agree-advance', { invoice_ids: [inv.id] })
      await fetchInvoices()
    } catch (e) { console.error(e) }
    setAgreeing(null)
  }

  return (
    <div>
      <Card noPad>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr>
                  <TH>Invoice #</TH>
                  <TH style={{ textAlign: 'right' }}>Invoice Amount</TH>
                  <TH style={{ textAlign: 'right' }}>Advance </TH>
                  <TH>Submitted</TH>
                  <TH style={{ textAlign: 'center' }}>Status</TH>
                  <TH style={{ textAlign: 'center' }}>Invoice</TH>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const approved   = APPROVED.includes(inv.status)
                  const canAgree   = inv.status === 'Advance Confirmed'
                  return (
                    <tr key={inv.id} style={{ borderBottom: `1px solid ${C.border}` }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f5fdf8'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <TD mono>{inv.invoice_number}</TD>
                      <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</TD>
                      <TD accent style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {approved ? fmt(inv.advance_amount) : <span style={{ color: C.textMut, fontWeight: 400 }}>—</span>}
                      </TD>
                      <TD muted style={{ fontSize: 12 }}>{inv.submitted_at ? new Date(inv.submitted_at).toLocaleDateString() : '—'}</TD>
                      <TD style={{ textAlign: 'center' }}>
                        {canAgree ? (
                          <Btn size="sm" onClick={() => agree(inv)} disabled={agreeing === inv.id}>
                            <Check size={12} /> {agreeing === inv.id ? 'Saving…' : 'Agree to 97%'}
                          </Btn>
                        ) : (
                          <CustomerBadge status={inv.status} />
                        )}
                      </TD>
                      <TD style={{ textAlign: 'center' }}><DriveBadge url={inv.drive_file_url} /></TD>
                    </tr>
                  )
                })}
                {invoices.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>No advanced invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
