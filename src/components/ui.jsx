import React, { useState, useRef, useEffect } from 'react';
import { C, shadow, shadowMd, STATUS_COLOURS } from '../tokens';
import {
  Layers, LayoutDashboard, ListOrdered, X, Search, ChevronDown,
  CheckCircle2, Circle, AlertTriangle, AlertCircle, FileText,
  MoreVertical, Check, Upload, Inbox, ChevronRight, ExternalLink,
  BarChart2, Clock, DollarSign, Users, TrendingUp, ArrowRight,
  Mail, Phone, Percent, Calendar, Eye, Trash2, Edit3,
  RefreshCw, XCircle, Info
} from 'lucide-react';

/* ─── Typography helpers ───────────────────────────────────── */
export const Label = ({ children, style }) => (
  <span style={{ fontSize: 10, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', ...style }}>
    {children}
  </span>
);

/* ─── Status Badge ─────────────────────────────────────────── */
export const Badge = ({ status, small }) => {
  const s = STATUS_COLOURS[status] || { bg: '#f1f5f9', text: '#475569' };
  return (
    <span style={{
      background: s.bg, color: s.text,
      borderRadius: 9999,
      fontSize: small ? 10 : 10.5,
      fontWeight: 600,
      padding: small ? '1px 7px' : '3px 10px',
      whiteSpace: 'nowrap',
      display: 'inline-block',
    }}>{status}</span>
  );
};

/* ─── Button ───────────────────────────────────────────────── */
export const Btn = ({ children, variant = 'primary', size = 'default', onClick, disabled, style, type = 'button' }) => {
  const base = {
    borderRadius: 7, fontWeight: 600, letterSpacing: '-0.01em', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, border: 'none', outline: 'none',
    fontSize: size === 'sm' ? 11.5 : 13,
    padding: size === 'sm' ? '5px 11px' : '8px 16px',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    transition: 'background 0.15s',
    ...style,
  };
  const variants = {
    primary:   { background: C.primary, color: '#fff' },
    secondary: { background: '#fff', color: C.text, border: `1px solid ${C.borderMd}` },
    ghost:     { background: 'transparent', color: C.textSm, border: 'none' },
    danger:    { background: C.red, color: '#fff' },
    outline:   { background: 'transparent', color: C.primary, border: `1.5px solid ${C.primary}` },
    subtle:    { background: C.primLt, color: C.primary, border: 'none' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
};

/* ─── Card ─────────────────────────────────────────────────── */
export const Card = ({ children, style, noPad }) => (
  <div style={{
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: noPad ? 0 : 20, boxShadow: shadow, overflow: noPad ? 'hidden' : undefined,
    ...style,
  }}>{children}</div>
);

/* ─── Field (compact label/value) ──────────────────────────── */
export const Field = ({ label, value, accent, red: redV, mono }) => (
  <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: `1px solid ${C.border}` }}>
    <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
    <div style={{
      fontSize: 13.5, fontWeight: 700,
      color: redV ? C.red : accent ? C.primary : C.text,
      fontFamily: mono ? 'monospace' : undefined,
    }}>{value}</div>
  </div>
);

/* ─── Table helpers ─────────────────────────────────────────── */
export const TH = ({ children, style }) => (
  <th style={{
    padding: '9px 13px', fontSize: 10.5, fontWeight: 700, color: C.textMut,
    letterSpacing: '0.05em', textTransform: 'uppercase', background: '#f7f9fb',
    borderBottom: `1.5px solid ${C.border}`, whiteSpace: 'nowrap', textAlign: 'left',
    ...style,
  }}>{children}</th>
);

export const TD = ({ children, style, mono, accent, muted }) => (
  <td style={{
    padding: '11px 13px', fontSize: 13,
    color: accent ? C.primary : muted ? C.textSm : C.text,
    fontWeight: accent ? 600 : undefined,
    fontFamily: mono ? 'monospace' : undefined,
    fontVariantNumeric: 'tabular-nums',
    ...style,
  }}>{children}</td>
);

/* ─── Modal ─────────────────────────────────────────────────── */
export const Modal = ({ children, onClose, width = 520, title, subtitle, accentHeader }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(7,36,24,0.46)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 30,
  }} onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{
      background: '#fff', borderRadius: 16, width, maxWidth: '100%',
      boxShadow: '0 24px 70px rgba(0,0,0,0.34)', border: `1px solid ${C.border}`,
      maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {title && (
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${C.border}`,
          background: accentHeader ? '#f0faf5' : '#fff',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: C.textB }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: C.textSm, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.border}`,
            background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={14} color={C.textSm} /></button>
        </div>
      )}
      <div style={{ overflowY: 'auto', flex: 1 }}>{children}</div>
    </div>
  </div>
);

export const ModalBody = ({ children, style }) => (
  <div style={{ padding: '20px 24px', ...style }}>{children}</div>
);

export const ModalFooter = ({ children }) => (
  <div style={{
    padding: '13px 24px', borderTop: `1px solid ${C.border}`,
    background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: 9,
  }}>{children}</div>
);

/* ─── Shell Layout ──────────────────────────────────────────── */
const NavItem = ({ icon: Icon, label, active, badge, onClick }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
    padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(0,121,83,0.28)' : 'transparent',
    color: active ? '#fff' : 'rgba(255,255,255,0.58)',
    fontWeight: active ? 600 : 400, fontSize: 13.5,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    position: 'relative', textAlign: 'left',
  }}>
    <Icon size={16} />
    <span style={{ flex: 1 }}>{label}</span>
    {badge != null && (
      <span style={{
        background: C.red, color: '#fff', borderRadius: 9999,
        fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center',
      }}>{badge}</span>
    )}
  </button>
);

export const Shell = ({ children, nav, user, portal = 'admin' }) => (
  <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: C.bg }}>
    {/* Sidebar */}
    <div style={{ width: 224, background: C.sidebar, padding: '22px 10px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, paddingLeft: 2 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Layers size={18} color="#fff" />
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 }}>Levisa Capital</div>
          <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Invoice Factoring</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        {nav}
      </div>

      {/* User */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.09)', paddingTop: 14, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px' }}>
          <div style={{ width: 29, height: 29, borderRadius: '50%', background: C.primLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.primary, flexShrink: 0 }}>
            {user?.initials || 'BL'}
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{user?.name || 'Brian Levisa'}</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5 }}>{user?.role || 'Owner'}</div>
          </div>
        </div>
      </div>
    </div>

    {/* Main */}
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {children}
    </div>
  </div>
);

export const Topbar = ({ title, subtitle, children }) => (
  <div style={{
    height: 52, background: '#fff', borderBottom: `1px solid ${C.border}`,
    padding: '0 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</span>
      {subtitle && <span style={{ fontSize: 12.5, color: C.textMut }}>— {subtitle}</span>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
  </div>
);

export const PageContent = ({ children, style }) => (
  <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', ...style }}>{children}</div>
);

/* ─── Kebab Menu ────────────────────────────────────────────── */
export const KebabMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.border}`,
        background: open ? '#f0faf5' : '#fff', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><MoreVertical size={13} color={C.textSm} /></button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 30, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 9, boxShadow: shadowMd,
          padding: 5, minWidth: 172, zIndex: 100,
        }}>
          {items.map((item, i) => (
            <button key={i} onClick={() => { item.onClick(); setOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent',
              fontSize: 12.5, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
              color: item.danger ? C.red : C.text,
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            }}
              onMouseEnter={e => e.currentTarget.style.background = item.danger ? '#fee2e2' : '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {item.icon && <item.icon size={13} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Search + Filter Bar ───────────────────────────────────── */
export const SearchBar = ({ placeholder, value, onChange }) => (
  <div style={{
    background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8, maxWidth: 340,
  }}>
    <Search size={13} color={C.textMut} />
    <input
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'Search…'}
      style={{
        border: 'none', outline: 'none', fontSize: 13, color: C.text,
        background: 'transparent', width: '100%',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    />
  </div>
);

export const FilterChip = ({ label, options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 11px',
        borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff',
        fontSize: 12.5, color: C.textSm, cursor: 'pointer',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        <span>{value || label}</span>
        <ChevronDown size={12} />
      </button>
      {open && options && (
        <div style={{
          position: 'absolute', top: 36, left: 0, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 9, boxShadow: shadowMd,
          padding: 5, minWidth: 160, zIndex: 100,
        }}>
          {options.map(opt => (
            <button key={opt} onClick={() => { onChange(opt === value ? '' : opt); setOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent',
              fontSize: 12.5, cursor: 'pointer', textAlign: 'left', color: C.text,
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            }}>
              {value === opt && <Check size={12} color={C.primary} />}
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── View Tabs ─────────────────────────────────────────────── */
export const Tabs = ({ tabs, active, onChange }) => (
  <div style={{ display: 'flex', gap: 6 }}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)} style={{
        padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
        border: active === t.key ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
        background: active === t.key ? C.primLt : '#fff',
        color: active === t.key ? C.primary : C.textSm,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        {t.label}{t.count != null ? ` (${t.count})` : ''}
      </button>
    ))}
  </div>
);

/* ─── Timeline Step ─────────────────────────────────────────── */
export const TimelineStep = ({ label, date, done, current, last }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        background: done || current ? C.primary : '#fff',
        border: done || current ? `2px solid ${C.primary}` : `2px solid ${C.borderMd}`,
        boxShadow: current ? `0 0 0 3px rgba(0,121,83,0.18)` : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {done && <Check size={9} color="#fff" strokeWidth={3} />}
      </div>
      {!last && <div style={{ width: 2, height: 28, background: done ? C.primary : C.border, marginTop: 2 }} />}
    </div>
    <div style={{ paddingBottom: last ? 0 : 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: done || current ? C.text : C.textMut }}>{label}</div>
      {date && <div style={{ fontSize: 11, color: C.textMut, marginTop: 1 }}>{date}</div>}
    </div>
  </div>
);

export { LayoutDashboard, ListOrdered, AlertTriangle, AlertCircle, FileText, CheckCircle2, Circle, Inbox, ExternalLink, Eye, Edit3, Trash2, RefreshCw, XCircle, Info, ArrowRight };
