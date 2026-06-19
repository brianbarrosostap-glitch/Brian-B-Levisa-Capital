import React, { useState, useRef, useEffect } from 'react';
import { C, shadow, shadowMd, STATUS_COLOURS } from '../tokens';
import {
  Layers, LayoutDashboard, ListOrdered, X, Search, ChevronDown,
  CheckCircle2, Circle, AlertTriangle, AlertCircle, FileText,
  MoreVertical, Check, Upload, Inbox, ChevronRight, ExternalLink,
  BarChart2, Clock, DollarSign, Users, TrendingUp, ArrowRight,
  Mail, Phone, Percent, Calendar, Eye, Trash2, Edit3,
  RefreshCw, XCircle, Info, Menu, LogOut
} from 'lucide-react';

/* ─── Responsive helpers ────────────────────────────────────── */
export const useViewportWidth = () => {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
};

export const useIsMobile = (breakpoint = 760) => useViewportWidth() < breakpoint;

/**
 * Responsive grid that collapses its column count on smaller screens.
 * `cols` is the desktop column count; it drops to 2 on tablet (<900px)
 * and 1 on phone (<560px). Pass `min` to keep a higher floor (e.g. charts
 * stay at 1 on phone but 2 on tablet by default).
 */
export const Grid = ({ cols = 4, gap = 11, mobileCols, tabletCols, style, children }) => {
  const w = useViewportWidth();
  let n = cols;
  if (w < 900) n = tabletCols ?? Math.min(cols, 2);
  if (w < 560) n = mobileCols ?? 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap, ...style }}>
      {children}
    </div>
  );
};

/**
 * Responsive data list. On desktop it renders a normal table; on phone
 * (<640px) it renders each row as a stacked label/value CARD so nothing
 * is hidden behind horizontal scroll.
 *
 * columns: [{ key, label, render?(row), align?, mono?, hideOnMobile? }]
 * rows:    array of objects (each must have a stable `id`)
 * onRowClick?(row), rowStyle?(row), footer? (JSX rendered below), actions?(row) → JSX
 */
export const DataList = ({ columns, rows, onRowClick, rowStyle, footer, actions, emptyText = 'No records.' }) => {
  const w = useViewportWidth();
  const phone = w < 640;
  const cell = (col, row) => (col.render ? col.render(row) : row[col.key]);

  if (rows.length === 0) {
    return <div style={{ padding: 28, textAlign: 'center', fontSize: 13, color: C.textMut }}>{emptyText}</div>;
  }

  // ── Mobile: stacked cards ──
  if (phone) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
        {rows.map(row => (
          <div key={row.id}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={{
              border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px',
              background: '#fff', cursor: onRowClick ? 'pointer' : 'default',
              ...(rowStyle ? rowStyle(row) : {}),
            }}>
            {columns.filter(c => !c.hideOnMobile).map(col => (
              <div key={col.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '3px 0' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.03em', flexShrink: 0 }}>{col.label}</span>
                <span style={{ fontSize: 13, color: C.text, fontFamily: col.mono ? 'monospace' : 'inherit', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cell(col, row)}</span>
              </div>
            ))}
            {actions && <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }} onClick={e => e.stopPropagation()}>{actions(row)}</div>}
          </div>
        ))}
        {footer && <div style={{ borderTop: `2px solid ${C.primary}`, paddingTop: 8 }}>{footer}</div>}
      </div>
    );
  }

  // ── Desktop: table ──
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map(col => <TH key={col.key} style={col.align ? { textAlign: col.align } : undefined}>{col.label}</TH>)}
            {actions && <TH style={{ width: 32 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? 'pointer' : 'default', ...(rowStyle ? rowStyle(row) : {}) }}>
              {columns.map(col => (
                <TD key={col.key} mono={col.mono} style={col.align ? { textAlign: col.align } : undefined}>{cell(col, row)}</TD>
              ))}
              {actions && <TD style={{ padding: '6px 8px' }} onClick={e => e.stopPropagation()}>{actions(row)}</TD>}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
};

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
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1.5,
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
    padding: '10px 16px', fontSize: 10.5, fontWeight: 700, color: C.textMut,
    letterSpacing: '0.04em', textTransform: 'uppercase', background: '#f7f9fb',
    borderBottom: `1.5px solid ${C.border}`, whiteSpace: 'nowrap', textAlign: 'left',
    verticalAlign: 'middle',
    ...style,
  }}>{children}</th>
);

export const TD = ({ children, style, mono, accent, muted }) => (
  <td style={{
    padding: '11px 16px', fontSize: 13,
    color: accent ? C.primary : muted ? C.textSm : C.text,
    fontWeight: accent ? 600 : undefined,
    fontFamily: mono ? 'monospace' : undefined,
    fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle',
    ...style,
  }}>{children}</td>
);

/* ─── Modal ─────────────────────────────────────────────────── */
export const Modal = ({ children, onClose, width = 520, title, subtitle, accentHeader }) => {
  const isMobile = useIsMobile();
  return (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(7,36,24,0.46)',
    display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'center',
    zIndex: 1000, padding: isMobile ? '12px 8px' : 30, overflowY: 'auto',
  }} onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{
      background: '#fff', borderRadius: 16, width, maxWidth: '100%',
      boxShadow: '0 24px 70px rgba(0,0,0,0.34)', border: `1px solid ${C.border}`,
      maxHeight: isMobile ? 'none' : '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
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
};

export const ModalBody = ({ children, style }) => (
  <div style={{ padding: '20px 24px', ...style }}>{children}</div>
);

export const ModalFooter = ({ children }) => (
  <div style={{
    padding: '13px 24px', borderTop: `1px solid ${C.border}`,
    background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: 9,
    flexWrap: 'wrap',
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

export const Shell = ({ children, nav, user, onSignOut }) => {
  const [navOpen, setNavOpen] = useState(false);   // mobile drawer
  const isMobile = useIsMobile();

  const sidebar = (
    <div style={{
      width: 224, background: C.sidebar, padding: '22px 10px',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      height: '100%',
      ...(isMobile ? { position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 60, boxShadow: '2px 0 24px rgba(0,0,0,0.35)' } : {}),
    }}>
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
      <div onClick={() => isMobile && setNavOpen(false)} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        {nav}
      </div>

      {/* User + Sign Out pinned to the bottom */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.09)', paddingTop: 12, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px', marginBottom: 6 }}>
          <div style={{ width: 29, height: 29, borderRadius: '50%', background: C.primLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.primary, flexShrink: 0 }}>
            {user?.initials || 'BL'}
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{user?.name || 'Brian Levisa'}</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5 }}>{user?.role || 'Owner'}</div>
          </div>
        </div>
        {onSignOut && (
          <button onClick={onSignOut} style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%',
            padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.78)',
            fontWeight: 500, fontSize: 13, fontFamily: 'Inter, system-ui, -apple-system, sans-serif', textAlign: 'left',
          }}>
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: C.bg }}>
      {/* Desktop sidebar, or mobile drawer when open */}
      {(!isMobile || navOpen) && sidebar}
      {/* Mobile backdrop */}
      {isMobile && navOpen && (
        <div onClick={() => setNavOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 55 }} />
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {isMobile && (
          <button onClick={() => setNavOpen(true)} aria-label="Open menu" style={{
            position: 'absolute', top: 11, left: 12, zIndex: 40, width: 32, height: 32,
            borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Menu size={17} color={C.textSm} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
};

export const Topbar = ({ title, subtitle, children }) => {
  const isMobile = useIsMobile();
  return (
    <div style={{
      minHeight: 52, background: '#fff', borderBottom: `1px solid ${C.border}`,
      padding: isMobile ? '0 14px 0 52px' : '0 26px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{title}</span>
        {subtitle && !isMobile && <span style={{ fontSize: 12.5, color: C.textMut }}>— {subtitle}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
    </div>
  );
};

export const PageContent = ({ children, style }) => {
  const isMobile = useIsMobile();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '22px 26px', ...style }}>{children}</div>
  );
};

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
    // stopPropagation on the whole menu so clicking the dots or any item
    // never bubbles up to a parent row's onClick (which would also open
    // the detail modal). This makes the kebab safe in clickable rows.
    <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }} style={{
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
            <button key={i} onClick={e => { e.stopPropagation(); item.onClick(); setOpen(false); }} style={{
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
        borderRadius: 8, border: `1px solid ${value ? C.primary : C.border}`,
        background: value ? '#f0faf5' : '#fff',
        fontSize: 12.5, color: value ? C.primary : C.textSm, fontWeight: value ? 600 : 400, cursor: 'pointer',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        <span>{value || label}</span>
        {value
          ? <X size={13} onClick={(e) => { e.stopPropagation(); onChange(''); }} style={{ cursor: 'pointer' }} />
          : <ChevronDown size={12} />}
      </button>
      {open && options && (
        <div style={{
          position: 'absolute', top: 36, left: 0, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 9, boxShadow: shadowMd,
          padding: 5, minWidth: 160, zIndex: 100,
        }}>
          {/* Clear / show-all entry */}
          <button onClick={() => { onChange(''); setOpen(false); }} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 10px', borderRadius: 6, border: 'none',
            background: 'transparent', fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
            color: value ? C.text : C.primary, fontWeight: value ? 400 : 600,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}>
            {!value && <Check size={12} color={C.primary} />}
            All {label.toLowerCase()}
          </button>
          <div style={{ height: 1, background: C.border, margin: '4px 2px' }} />
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
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
