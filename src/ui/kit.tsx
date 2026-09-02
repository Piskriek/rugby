import React from 'react';

export const GOLD = '#e8cf46';
export const INK = '#0f1420';
export const PAPER = '#f4efe2';

export function Panel({ children, className = '', title, accent = GOLD }: {
  children: React.ReactNode; className?: string; title?: string; accent?: string;
}) {
  return (
    <div className={`relative border-2 bg-[#101724]/95 ${className}`} style={{ borderColor: accent }}>
      {title && (
        <div className="px-3 py-1 text-[11px] font-black tracking-[0.22em]" style={{ background: accent, color: '#14161d' }}>
          {title}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}

export function Btn({ children, onClick, active, danger, wide, small }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean; danger?: boolean;
  wide?: boolean; small?: boolean;
}) {
  const base = 'border-2 font-black uppercase tracking-[0.14em] transition-colors select-none cursor-pointer';
  const size = small ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]';
  const colour = active
    ? 'bg-[#e8cf46] border-[#e8cf46] text-[#14161d]'
    : danger
      ? 'bg-[#2a1420] border-[#c8402f] text-[#ffb0a0] hover:bg-[#c8402f] hover:text-white'
      : 'bg-[#1a2334] border-[#3d4b66] text-[#cfd8e6] hover:border-[#e8cf46] hover:text-[#e8cf46]';
  return (
    <button onClick={onClick} className={`${base} ${size} ${colour} ${wide ? 'w-full text-left' : ''}`}>
      {children}
    </button>
  );
}

export function Stat({ label, value, colour = PAPER, sub }: { label: string; value: React.ReactNode; colour?: string; sub?: string }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.2em] text-[#7f8ea6]">{label}</div>
      <div className="text-[15px] font-black tabular-nums" style={{ color: colour }}>{value}</div>
      {sub && <div className="text-[9px] text-[#6f7f96]">{sub}</div>}
    </div>
  );
}

export function Meter({ v, label, hi, lo, danger = 0.7 }: { v: number; label?: string; hi?: string; lo?: string; danger?: number }) {
  const pct = Math.max(0, Math.min(1, v));
  const col = pct > danger ? '#6ee7a0' : pct > 0.35 ? '#e8cf46' : '#ff6a5a';
  return (
    <div className="w-full">
      {label && <div className="flex justify-between text-[9px] tracking-[0.16em] text-[#7f8ea6]"><span>{label}</span><span>{lo} / {hi}</span></div>}
      <div className="h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: col }} />
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-block border border-[#4a5a76] bg-[#1b2434] px-1 text-[9px] font-bold text-[#cfd8e6]">
      {children}
    </span>
  );
}

export function TitleBar({ kicker, title, right }: { kicker: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between border-b-2 border-[#e8cf46] pb-2">
      <div>
        <div className="text-[10px] font-black tracking-[0.4em] text-[#7f8ea6]">{kicker}</div>
        <div className="text-2xl font-black tracking-[0.12em] text-[#f4efe2]">{title}</div>
      </div>
      {right}
    </div>
  );
}

export function KitSwatch({ k, size = 22 }: { k: { kit: string; trim: string; shorts: string }; size?: number }) {
  return (
    <div className="inline-flex flex-col" style={{ width: size }}>
      <div className="border border-[#20202b]" style={{ height: size * 0.6, background: k.kit }} />
      <div className="border border-[#20202b]" style={{ height: size * 0.25, background: k.shorts }} />
      <div style={{ height: 2, background: k.trim }} />
    </div>
  );
}
