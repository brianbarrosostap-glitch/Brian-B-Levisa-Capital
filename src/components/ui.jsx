import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import { C, shadow, STATUS_COLOURS, PARTY_STYLE, FONT_MONO } from '../tokens';

// Lets the Topbar render the mobile menu button inline (in the header row)
// so it can never overlap content below it. Shell provides openNav.
const ShellContext = createContext({ isMobile: false, openNav: () => {} });
import {
  Layers, LayoutDashboard, ListOrdered, X, Search, ChevronDown,
  CheckCircle2, Circle, AlertTriangle, AlertCircle, FileText,
  MoreVertical, Check, Upload, Inbox, ChevronRight, ExternalLink,
  BarChart2, Clock, DollarSign, Users, TrendingUp, ArrowRight,
  Mail, Phone, Percent, Calendar, Eye, Trash2, Edit3,
  RefreshCw, XCircle, Info, Menu, LogOut, ChevronLeft
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
    return <div style={{ padding: 28, textAlign: 'center', fontSize: 14.5, color: C.textMut }}>{emptyText}</div>;
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
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.03em', flexShrink: 0 }}>{col.label}</span>
                <span style={{ fontSize: 14.5, color: C.text, fontFamily: col.mono ? 'monospace' : 'inherit', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cell(col, row)}</span>
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
  <span style={{ fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', ...style }}>
    {children}
  </span>
);

/* ─── Party Tag ────────────────────────────────────────────── */
// Which party a figure belongs to: 'RZR' (customer we advance to),
// 'Ryder' (debtor who pays us) or 'Lavisa' (our earnings).
export const PartyTag = ({ party }) => {
  if (!party) return null;
  const s = PARTY_STYLE[party] || { bg: '#f1f5f9', text: '#475569' };
  return (
    <span style={{
      background: s.bg, color: s.text, borderRadius: 5, fontSize: 11, fontWeight: 700, lineHeight: '16px',
      padding: '0 6px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', flexShrink: 0,
    }}>{party}</span>
  );
};

/* ─── Status Badge ─────────────────────────────────────────── */
// Colour is looked up by the raw `status`; `label` (optional) overrides the
// displayed text (e.g. a friendlier admin label) without changing the colour.
export const Badge = ({ status, label, small }) => {
  const s = STATUS_COLOURS[status] || { bg: '#f1f5f9', text: '#475569' };
  return (
    <span style={{
      background: s.bg, color: s.text,
      // Hairline ring in the badge's own text colour (~12% alpha) — crisper edge, same colours.
      boxShadow: `inset 0 0 0 1px ${s.text}1f`,
      borderRadius: 9999,
      height: small ? 18 : 22, boxSizing: 'border-box',
      fontSize: small ? 11 : 12,
      fontWeight: 600, letterSpacing: '0.005em',
      padding: small ? '0 7px' : '0 9px',
      whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1,
    }}>{label ?? status}</span>
  );
};

/* ─── Button ───────────────────────────────────────────────── */
export const Btn = ({ children, variant = 'primary', size = 'default', onClick, disabled, style, type = 'button', className }) => {
  const base = {
    borderRadius: 8, fontWeight: 600, letterSpacing: '-0.01em', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, border: 'none',
    fontSize: size === 'sm' ? 12.5 : 14.5,
    minHeight: size === 'sm' ? 28 : 36, boxSizing: 'border-box',
    padding: size === 'sm' ? '4px 11px' : '7px 16px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    whiteSpace: 'nowrap',
  };
  const variants = {
    primary:   { background: C.primary, color: '#fff', boxShadow: '0 1px 2px rgba(0,87,65,0.25), inset 0 1px 0 rgba(255,255,255,0.10)' },
    secondary: { background: '#fff', color: C.text, border: `1px solid ${C.borderMd}`, boxShadow: '0 1px 2px rgba(16,24,40,0.04)' },
    ghost:     { background: 'transparent', color: C.textSm, border: 'none' },
    danger:    { background: C.red, color: '#fff', boxShadow: '0 1px 2px rgba(153,27,27,0.25)' },
    outline:   { background: 'transparent', color: C.primary, border: `1.5px solid ${C.primary}` },
    subtle:    { background: C.primLt, color: C.primary, border: 'none' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`lc-btn lc-btn-${variant} lc-focus${className ? ` ${className}` : ''}`}
      style={{ ...base, ...variants[variant], ...style }}>
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
// A missing value ('—' / '–' / empty) renders as a light dash so real values stand out.
const isEmptyValue = v => v == null || v === '' || v === '—' || v === '–';
// `compact` = slightly smaller value for narrow 4-up grids (date + time fits one line).
export const Field = ({ label, value, accent, red: redV, mono, muted, compact }) => (
  <div style={{
    padding: compact ? '10px 10px' : '10px 12px', background: C.panel, borderRadius: 8, border: `1px solid ${C.borderLt}`,
    minHeight: 60, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0,
  }}>
    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textLbl, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5, lineHeight: 1.2 }}>{label}</div>
    {isEmptyValue(value)
      ? <div style={{ fontSize: 15.5, fontWeight: 600, color: C.borderMd, lineHeight: 1.25 }}>—</div>
      : <div style={{
          fontSize: compact ? 13.5 : mono ? 15 : 15.5, fontWeight: accent || redV ? 700 : 600, lineHeight: 1.3, letterSpacing: mono ? 0 : '-0.01em',
          color: redV ? C.red : accent ? C.primary : muted ? C.textSm : C.textB,
          fontFamily: mono ? FONT_MONO : undefined, fontVariantNumeric: 'tabular-nums',
          overflowWrap: 'anywhere',   // never hide part of a value — wrap instead
        }}>{value}</div>}
  </div>
);

/* ─── Table helpers ─────────────────────────────────────────── */
export const TH = ({ children, style }) => (
  <th style={{
    // Title Case (render text as written) instead of ALL-CAPS, so headers
    // read "Invoice Date", "Advance @97%", with connecting words like "for"
    // staying lowercase in the source text.
    height: 40, padding: '0 12px', fontSize: 12.5, fontWeight: 600, color: C.textLbl,
    letterSpacing: '0.01em', background: C.panel,
    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', textAlign: 'left',
    verticalAlign: 'middle',
    ...style,
  }}>{children}</th>
);

// `onClick` is forwarded so action cells can stop row clicks.
export const TD = ({ children, style, mono, accent, muted, onClick }) => (
  <td onClick={onClick} style={{
    padding: '12px 12px', fontSize: 14, lineHeight: 1.35,
    color: accent ? C.primary : muted ? C.textSm : C.text,
    fontWeight: accent ? 600 : undefined,
    fontFamily: mono ? FONT_MONO : undefined,
    ...(mono ? { fontSize: 13.5 } : {}),
    fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle',
    borderBottom: `1px solid ${C.borderLt}`,
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
          padding: '18px 20px 16px 24px', borderBottom: `1px solid ${accentHeader ? '#d6ede2' : C.border}`,
          background: accentHeader ? '#f0faf5' : '#fff',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: C.textB, lineHeight: 1.25 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 14.5, color: C.textSm, marginTop: 4, lineHeight: 1.4 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" title="Close" className="lc-icon-btn lc-focus" style={{
            width: 32, height: 32, flexShrink: 0, borderRadius: 8, border: `1px solid ${C.border}`, padding: 0,
            background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
          }}><X size={15} color={C.textSm} strokeWidth={2.2} /></button>
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
    padding: '12px 24px', borderTop: `1px solid ${C.border}`, minHeight: 60, boxSizing: 'border-box',
    background: C.panel, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
    flexWrap: 'wrap',
  }}>{children}</div>
);

/* ─── Shell Layout ──────────────────────────────────────────── */
// Sidebar nav item — shared by the admin and customer shells (one
// implementation for every page). Active = deeper green tint + hairline
// ring + green left bar + green icon. Hover / transitions live in index.css (.lc-nav).
const navBadgeText = (n) => (typeof n === 'number' && n > 99 ? '99+' : n);
export const NavItem = ({ icon: Icon, label, active, badge, onClick }) => (
  <button onClick={onClick} className={`lc-nav${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}
    title={label} style={{
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', height: 40,
    padding: '0 10px 0 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(0,168,112,0.18)' : 'transparent',
    boxShadow: active ? 'inset 0 0 0 1px rgba(0,168,112,0.28)' : 'none',
    color: active ? '#fff' : 'rgba(255,255,255,0.70)',
    fontWeight: active ? 600 : 500, fontSize: 14.5, letterSpacing: '-0.005em', lineHeight: 1,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    position: 'relative', textAlign: 'left', flexShrink: 0,
  }}>
    {active && <span aria-hidden style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: C.primMd }} />}
    <Icon className="lc-nav-icon" size={18} strokeWidth={active ? 2.1 : 1.8}
      style={{ flexShrink: 0, display: 'block', color: active ? C.primMd : 'currentColor', opacity: active ? 1 : 0.85 }} />
    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    {badge != null && badge !== 0 && (
      <span aria-label={`${badge} pending`} style={{
        background: C.red, color: '#fff', borderRadius: 9999, height: 20, minWidth: 20, boxSizing: 'border-box',
        fontSize: 11.5, fontWeight: 700, padding: '0 6px', flexShrink: 0, lineHeight: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontVariantNumeric: 'tabular-nums', boxShadow: `0 0 0 2px ${C.sidebar}`,
      }}>{navBadgeText(badge)}</span>
    )}
  </button>
);

export const Shell = ({ children, nav, user, onSignOut }) => {
  const [navOpen, setNavOpen] = useState(false);   // mobile drawer
  const isMobile = useIsMobile();

  const sidebar = (
    <div style={{
      width: 224, background: C.sidebar, boxSizing: 'border-box',
      borderRight: '1px solid rgba(255,255,255,0.04)',
      // Safe-area insets so the sidebar clears the iPhone notch (top) and
      // home indicator (bottom) when installed as a PWA.
      padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 12px calc(env(safe-area-inset-bottom, 0px) + 14px)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      height: '100%', overflowY: 'auto', overflowX: 'hidden',
      ...(isMobile ? { position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 60, boxShadow: '2px 0 24px rgba(0,0,0,0.35)' } : {}),
    }}>
      {/* Brand — tile left edge lines up with the nav icons */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '2px 4px 18px', marginBottom: 14,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, background: C.primary, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14), 0 4px 10px rgba(0,0,0,0.28)',
        }}>
          <Layers size={20} color="#fff" strokeWidth={2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, lineHeight: 1.15, letterSpacing: '-0.015em', whiteSpace: 'nowrap' }}>Levisa Capital</div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 4, whiteSpace: 'nowrap' }}>Invoice Factoring</div>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Main" onClick={() => isMobile && setNavOpen(false)} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {nav}
      </nav>

      {/* User + Sign Out pinned to the bottom */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginTop: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', marginBottom: 10,
          borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', background: C.primLt, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: C.primary, letterSpacing: '0.02em',
            boxShadow: '0 0 0 2px rgba(0,168,112,0.35)',
          }}>
            {user?.initials || 'BL'}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: 14.5, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || 'Brian Levisa'}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.35, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.role || 'Owner'}</div>
          </div>
        </div>
        {onSignOut && (
          <button onClick={onSignOut} className="lc-nav lc-signout" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 38,
            padding: '0 12px', borderRadius: 9, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.10)', background: 'transparent', color: 'rgba(255,255,255,0.80)',
            fontWeight: 500, fontSize: 14.5, fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}>
            <LogOut size={16} strokeWidth={1.9} />
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

      {/* Main — the mobile menu button now lives INSIDE the Topbar (via
          ShellContext) so it can never overlap the content below it. */}
      <ShellContext.Provider value={{ isMobile, openNav: () => setNavOpen(true) }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {children}
        </div>
      </ShellContext.Provider>
    </div>
  );
};

export const Topbar = ({ title, subtitle, children }) => {
  const { isMobile, openNav } = useContext(ShellContext);
  return (
    <div style={{
      background: '#fff', borderBottom: `1px solid ${C.border}`,
      // Bake the iPhone safe-area inset into the top padding directly (an
      // inline `padding` shorthand would otherwise override a CSS class).
      paddingTop: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 10px)' : 0,
      paddingBottom: isMobile ? 10 : 0,
      paddingLeft: isMobile ? 12 : 26,
      paddingRight: isMobile ? 12 : 26,
      minHeight: isMobile ? undefined : 56,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, flexShrink: 0, position: 'relative', zIndex: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {isMobile && (
          <button onClick={openNav} aria-label="Open menu" style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 8,
            border: `1px solid ${C.border}`, background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Menu size={18} color={C.textSm} />
          </button>
        )}
        <span style={{ fontSize: 17.5, fontWeight: 700, color: C.textB, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {subtitle && !isMobile && <span style={{ fontSize: 14, color: C.textMut, whiteSpace: 'nowrap' }}>— {subtitle}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>
    </div>
  );
};

export const PageContent = ({ children, style }) => {
  const isMobile = useIsMobile();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '24px 28px', ...style }}>{children}</div>
  );
};

/* ─── Kebab Menu ────────────────────────────────────────────── */
export const KebabMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);   // fixed-position coords of the dropdown
  const ref = useRef();
  const btnRef = useRef();
  // Listeners only while open (a page of rows = many menus).
  useEffect(() => {
    if (!open) return undefined;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', close, true);   // any scroll (page or table) closes it
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  // The dropdown is position:fixed so a card's overflow:hidden / a table's
  // horizontal scroll can't clip it; it opens upward when there's no room below.
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuH = items.length * 32 + 16;
      const up = r.bottom + 6 + menuH > window.innerHeight && r.top - 6 - menuH > 0;
      setPos({ right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    }
    setOpen(o => !o);
  };
  return (
    // stopPropagation on the whole menu so clicking the dots or any item
    // never bubbles up to a parent row's onClick (which would also open
    // the detail modal). This makes the kebab safe in clickable rows.
    <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={e => { e.stopPropagation(); toggle(); }}
        aria-label="Row actions" aria-haspopup="menu" aria-expanded={open}
        className="lc-icon-btn lc-focus" style={{
        width: 30, height: 30, borderRadius: 8, border: `1px solid ${open ? C.primary : C.border}`,
        background: open ? C.primLt : '#fff', cursor: 'pointer', padding: 0,
        boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><MoreVertical size={15} color={open ? C.primary : C.textSm} /></button>
      {open && pos && (
        <div role="menu" style={{
          position: 'fixed', ...pos, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 10px 30px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)',
          padding: 4, minWidth: 196, zIndex: 900,
        }}>
          {items.map((item, i) => (
            <React.Fragment key={i}>
              {/* Thin divider before the first destructive action */}
              {item.danger && i > 0 && !items[i - 1].danger && <div style={{ height: 1, background: C.borderLt, margin: '4px 6px' }} />}
              <button role="menuitem" onClick={e => { e.stopPropagation(); item.onClick(); setOpen(false); }}
                className={`lc-menu-item${item.danger ? ' is-danger' : ''} lc-focus`} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32,
                padding: '0 10px', borderRadius: 6, border: 'none', background: 'transparent',
                fontSize: 14.5, fontWeight: 500, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
                color: item.danger ? C.red : C.text,
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
              }}>
                {item.icon && <item.icon size={14} />}
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Pagination bar ───────────────────────────────────────── */
// Shared by Master (server-side pages) and Automation (pages over a fetched list).
// Page numbers shown: first, last, and a window around the current page.
const pageList = (page, pages) => {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages))
  const out = []
  let prev = 0
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

export function Pager({ page, pages, pageSize, total, rowsShown, onPage, onPageSize, sizes = [25, 50, 100], noun, compact }) {
  const from = (page - 1) * pageSize + 1
  const to = from + rowsShown - 1
  const btn = (on, disabled) => ({
    minWidth: 32, height: 32, padding: '0 8px', boxSizing: 'border-box', borderRadius: 8,
    border: `1px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff',
    color: on ? '#fff' : disabled ? C.borderMd : C.textSm, fontSize: 14.5, fontWeight: 600,
    fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: on ? '0 1px 2px rgba(0,87,65,0.25)' : '0 1px 2px rgba(16,24,40,0.04)',
  })
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      padding: compact ? '10px 12px' : '12px 16px', borderTop: `1px solid ${C.border}`, background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: C.textSm }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          Showing <strong style={{ color: C.text }}>{from}–{to}</strong> of <strong style={{ color: C.text }}>{total}</strong>{noun ? ` ${noun}` : ''}
        </span>
        {!compact && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Rows per page
            <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))} aria-label="Rows per page" className="lc-select" style={{
              height: 30, padding: '0 6px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff',
              fontSize: 14, color: C.text, fontFamily: 'inherit', cursor: 'pointer',
            }}>
              {sizes.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      <nav aria-label="Pagination" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className={page <= 1 ? 'lc-focus' : 'lc-icon-btn lc-focus'} style={btn(false, page <= 1)}>
          <ChevronLeft size={15} />
        </button>
        {compact ? (
          <span style={{ fontSize: 14, color: C.textSm, padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>Page {page} of {pages}</span>
        ) : pageList(page, pages).map((p, i) => p === '…'
          ? <span key={`gap${i}`} style={{ minWidth: 20, textAlign: 'center', color: C.textMut, fontSize: 14.5 }}>…</span>
          : <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
              className={p === page ? 'lc-focus' : 'lc-icon-btn lc-focus'} style={btn(p === page, false)}>{p}</button>
        )}
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}
          className={page >= pages ? 'lc-focus' : 'lc-icon-btn lc-focus'} style={btn(false, page >= pages)}>
          <ChevronRight size={15} />
        </button>
      </nav>
    </div>
  )
}

/* ─── Search + Filter Bar ───────────────────────────────────── */
export const SearchBar = ({ placeholder, value, onChange }) => (
  <div className="lc-search" style={{
    background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
    height: 36, boxSizing: 'border-box', padding: '0 10px 0 11px',
    display: 'flex', alignItems: 'center', gap: 8,
    flex: '1 1 320px', minWidth: 200, maxWidth: 440,
    boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
  }}>
    <Search size={15} color={C.textMut} style={{ flexShrink: 0 }} />
    <input
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'Search…'}
      aria-label={placeholder || 'Search'}
      style={{
        border: 'none', outline: 'none', fontSize: 14.5, color: C.text,
        background: 'transparent', width: '100%', minWidth: 0, padding: 0, height: '100%',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    />
    {value && (
      <button type="button" onClick={() => onChange('')} aria-label="Clear search" title="Clear search" style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: 9999, border: 'none', padding: 0,
        background: '#eef2f6', color: C.textSm, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}><X size={11} strokeWidth={2.6} /></button>
    )}
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
      <button onClick={() => setOpen(o => !o)} className={value ? 'lc-focus' : 'lc-icon-btn lc-focus'}
        aria-haspopup="listbox" aria-expanded={open} style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 36, boxSizing: 'border-box', padding: '0 12px',
        borderRadius: 8, border: `1px solid ${value ? C.primary : open ? C.borderMd : C.border}`,
        background: value ? '#f0faf5' : '#fff', whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
        fontSize: 14.5, color: value ? C.primary : C.textSm, fontWeight: value ? 600 : 500, cursor: 'pointer',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        <span>{value || label}</span>
        {value
          ? <X size={13} onClick={(e) => { e.stopPropagation(); onChange(''); }} style={{ cursor: 'pointer' }} />
          : <ChevronDown size={12} />}
      </button>
      {open && options && (
        <div role="listbox" style={{
          position: 'absolute', top: 42, left: 0, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 10px 30px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)',
          padding: 4, minWidth: 200, maxHeight: 360, overflowY: 'auto', zIndex: 100,
        }}>
          {/* Clear / show-all entry */}
          <button onClick={() => { onChange(''); setOpen(false); }} className="lc-menu-item" style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32,
            padding: '0 10px', borderRadius: 6, border: 'none',
            background: 'transparent', fontSize: 14, cursor: 'pointer', textAlign: 'left',
            color: value ? C.text : C.primary, fontWeight: value ? 400 : 600,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}>
            {!value && <Check size={12} color={C.primary} />}
            All {label.toLowerCase()}
          </button>
          <div style={{ height: 1, background: C.border, margin: '4px 2px' }} />
          {options.map(opt => (
            <button key={opt} onClick={() => { onChange(opt === value ? '' : opt); setOpen(false); }} className="lc-menu-item" style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32, whiteSpace: 'nowrap',
              padding: '0 10px', borderRadius: 6, border: 'none', background: value === opt ? '#f0faf5' : 'transparent',
              fontSize: 14.5, cursor: 'pointer', textAlign: 'left', color: value === opt ? C.primary : C.text, fontWeight: value === opt ? 600 : 400,
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
  <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {tabs.map(t => {
      const on = active === t.key;
      return (
        <button key={t.key} role="tab" aria-selected={on} onClick={() => onChange(t.key)}
          className={on ? 'lc-focus' : 'lc-icon-btn lc-focus'} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, boxSizing: 'border-box',
          padding: t.count != null ? '0 8px 0 13px' : '0 13px',
          borderRadius: 8, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          border: `1px solid ${on ? C.primary : C.border}`,
          background: on ? C.primLt : '#fff',
          color: on ? C.primary : C.textSm,
          boxShadow: on ? `0 0 0 3px rgba(0,121,83,0.08)` : '0 1px 2px rgba(16,24,40,0.04)',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}>
          {t.label}
          {t.count != null && (
            <span style={{
              minWidth: 22, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 9999,
              background: on ? C.primary : '#eef2f6', color: on ? '#fff' : C.textSm,
              fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{t.count}</span>
          )}
        </button>
      );
    })}
  </div>
);

/* ─── Timeline Step ─────────────────────────────────────────── */
// `extra` (optional string[]) renders extra dated lines under the step —
// used to list each Ryder submission (1st → last) below that step.
// Completed = filled green + check · current = green ring with a dot (the
// stage it's waiting on) · pending = hollow grey. The connector stretches to
// the step's real height, so long labels / extra lines never misalign it.
// `extra` lines like "1st — 24/11/2026 17:45" render as a small attempt list.
export const TimelineStep = ({ label, date, done, current, last, extra }) => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 18, flexShrink: 0 }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box', marginTop: 1,
        background: done ? C.primary : '#fff',
        border: `2px solid ${done || current ? C.primary : C.borderMd}`,
        boxShadow: current ? '0 0 0 4px rgba(0,121,83,0.14)' : done ? '0 1px 2px rgba(0,87,65,0.25)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {done && <Check size={10} color="#fff" strokeWidth={3.4} />}
        {!done && current && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.primary }} />}
      </div>
      {!last && <div style={{ width: 2, flex: 1, minHeight: 14, margin: '3px 0', borderRadius: 2, background: done ? C.primary : C.borderLt }} />}
    </div>
    <div style={{ paddingBottom: last ? 0 : 16, minWidth: 0, flex: 1 }}>
      <div style={{
        fontSize: 14.5, lineHeight: 1.35, overflowWrap: 'anywhere',
        fontWeight: done || current ? 600 : 500,
        color: done ? C.textB : current ? C.primary : C.textMut,
      }}>{label}</div>
      {date && <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{date}</div>}
      {!date && current && <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 2 }}>In progress</div>}
      {extra && extra.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: C.panel, border: `1px solid ${C.borderLt}`, borderRadius: 7 }}>
          {extra.map((line, i) => {
            const [tag, ...rest] = String(line).split(' — ');
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                {rest.length
                  ? <>
                      <span style={{ minWidth: 26, fontWeight: 700, color: C.textSm }}>{tag}</span>
                      <span style={{ color: C.textSm }}>{rest.join(' — ')}</span>
                    </>
                  : <span style={{ color: C.textSm }}>{line}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>
);

export { LayoutDashboard, ListOrdered, AlertTriangle, AlertCircle, FileText, CheckCircle2, Circle, Inbox, ExternalLink, Eye, Edit3, Trash2, RefreshCw, XCircle, Info, ArrowRight };
