'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { useUnitStore } from '@/lib/stores/unitStore';

interface PreviewNode {
  id: string;
  x: number;
  y: number;
  type: string;
  tag?: string;
}

interface PreviewEdge {
  s: string;
  t: string;
}

interface HubItem {
  id: number;
  title: string;
  description: string;
  category: string;
  postType?: 'showcase' | 'help';
  isSolved?: boolean;
  replyCount?: number;
  tags: string[];
  thermoMethod: string;
  unitCount: number;
  streamCount: number;
  massErrorPct: number | null;
  converged: boolean;
  isOfficial: boolean;
  presetId: string | null;
  authorId: number | null;
  authorName: string;
  views: number;
  forks: number;
  likes: number;
  createdAt: string;
  updatedAt: string;
  previewGraph?: { nodes: PreviewNode[]; edges: PreviewEdge[] } | null;
}

interface HubReply {
  id: number;
  hubId: number;
  authorId: number | null;
  authorName: string;
  isOfficial: boolean;
  message: string;
  fixedUrl: string;
  createdAt: string;
}

const CATEGORIES = [
  { id: 'all', labelEn: 'All Processes', labelKo: '전체 공정' },
  { id: 'energy', labelEn: 'Energy & Power', labelKo: '에너지 · 발전' },
  { id: 'separation', labelEn: 'Separation & Distillation', labelKo: '분리 · 증류' },
  { id: 'reaction', labelEn: 'Reaction & Synthesis', labelKo: '반응 · 합성' },
  { id: 'petrochemical', labelEn: 'Petrochemical', labelKo: '석유화학' },
  { id: 'gas', labelEn: 'Gas Processing', labelKo: '가스 처리' },
  { id: 'electrochem', labelEn: 'Electrochemistry', labelKo: '전기화학' },
  { id: 'general', labelEn: 'General / Custom', labelKo: '범용 / 기타' },
];

const CAT_BADGE_STYLE: Record<string, { bg: string; color: string; border: string; accent: string; label: string }> = {
  energy: { bg: 'rgba(245, 158, 11, 0.16)', color: '#FCD34D', border: 'rgba(245, 158, 11, 0.4)', accent: '#F59E0B', label: 'Energy & Power' },
  separation: { bg: 'rgba(56, 189, 248, 0.16)', color: '#7DD3FC', border: 'rgba(56, 189, 248, 0.4)', accent: '#38BDF8', label: 'Separation' },
  reaction: { bg: 'rgba(244, 114, 182, 0.16)', color: '#F9A8D4', border: 'rgba(244, 114, 182, 0.4)', accent: '#F472B6', label: 'Reaction' },
  petrochemical: { bg: 'rgba(167, 139, 250, 0.16)', color: '#C4B5FD', border: 'rgba(167, 139, 250, 0.4)', accent: '#A78BFA', label: 'Petrochemical' },
  gas: { bg: 'rgba(34, 211, 238, 0.16)', color: '#67E8F9', border: 'rgba(34, 211, 238, 0.4)', accent: '#22D3EE', label: 'Gas Processing' },
  electrochem: { bg: 'rgba(52, 211, 153, 0.16)', color: '#6EE7B7', border: 'rgba(52, 211, 153, 0.4)', accent: '#34D399', label: 'Electrochem' },
  general: { bg: 'rgba(148, 163, 184, 0.16)', color: '#CBD5E1', border: 'rgba(148, 163, 184, 0.4)', accent: '#94A3B8', label: 'General' },
};

function unitStrokeColor(t: string): string {
  if (t === 'reactor' || t === 'electrolyzer') return '#F59E0B';
  if (t === 'distillation' || t === 'absorber' || t === 'separator') return '#38BDF8';
  if (t === 'hex' || t === 'cooler' || t === 'liquefier' || t === 'evaporator') return '#FB7185';
  if (t === 'turbine' || t === 'compressor' || t === 'pump') return '#34D399';
  if (t === 'feed' || t === 'product') return '#94A3B8';
  return '#60A5FA';
}

/**
 * Renders a crisp dark-navy Blueprint PFD Thumbnail on top of every Hub card.
 * - Uses real `previewGraph` coordinates for user-published flowsheets
 * - Uses bespoke engineering PFD schematics for official starter examples
 */
function PfdBlueprintThumbnail({ item }: { item: HubItem }) {
  const cat = CAT_BADGE_STYLE[item.category] ?? CAT_BADGE_STYLE.general;
  const hasRealGraph = Boolean(item.previewGraph && item.previewGraph.nodes.length >= 2);

  const renderRealGraph = () => {
    const nodes = item.previewGraph!.nodes;
    const edges = item.previewGraph!.edges;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const spanX = Math.max(120, maxX - minX);
    const spanY = Math.max(80, maxY - minY);
    const padX = 28;
    const padY = 28;
    const W = 340 - padX * 2;
    const H = 132 - padY * 2;
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const nx = padX + ((n.x - minX) / spanX) * W;
      const ny = padY + ((n.y - minY) / spanY) * H;
      pos.set(n.id, { x: nx, y: ny });
    }
    return (
      <g>
        {edges.map((e, i) => {
          const a = pos.get(e.s);
          const b = pos.get(e.t);
          if (!a || !b) return null;
          const midX = (a.x + b.x) / 2;
          const d = `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#38BDF8"
              strokeOpacity="0.65"
              strokeWidth="1.35"
              strokeDasharray={a.x > b.x ? '3 2.5' : undefined}
            />
          );
        })}
        {nodes.map(n => {
          const p = pos.get(n.id);
          if (!p) return null;
          const col = unitStrokeColor(n.type);
          const isCol = n.type === 'distillation' || n.type === 'absorber';
          const isCircle = n.type === 'hex' || n.type === 'cooler' || n.type === 'pump';
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              {isCol ? (
                <rect x="-5" y="-11" width="10" height="22" rx="4" fill="#0F172A" stroke={col} strokeWidth="1.5" />
              ) : isCircle ? (
                <circle cx="0" cy="0" r="6.5" fill="#0F172A" stroke={col} strokeWidth="1.5" />
              ) : (
                <rect x="-8" y="-6" width="16" height="12" rx="2.5" fill="#0F172A" stroke={col} strokeWidth="1.5" />
              )}
              <circle cx="0" cy="0" r="1.5" fill={col} />
            </g>
          );
        })}
      </g>
    );
  };

  const renderOfficialSchematic = () => {
    if (item.presetId === 'lng_ccgt_power_plant' || item.category === 'energy') {
      // Brayton Gas Turbine + HRSG + Rankine Steam Turbine schematic
      return (
        <g strokeLinecap="round" strokeLinejoin="round">
          {/* Upper Brayton Loop */}
          <path d="M 28 48 H 76 M 102 48 H 146 M 174 48 H 214 M 242 48 H 284 M 304 48 H 322" fill="none" stroke="#38BDF8" strokeWidth="1.5" />
          {/* Lower Rankine Loop */}
          <path d="M 74 96 H 134 M 156 96 H 214 M 242 96 H 294 V 114 H 62 V 96 H 74" fill="none" stroke="#34D399" strokeWidth="1.35" strokeDasharray="3 2.5" />
          {/* HRSG Heat Bridge */}
          <path d="M 294 58 V 84" fill="none" stroke="#FB7185" strokeWidth="1.4" strokeDasharray="2.5 2" />
          {/* Air Compressor (Trapezoid) */}
          <polygon points="76,38 102,42 102,54 76,58" fill="#0F172A" stroke="#34D399" strokeWidth="1.6" />
          {/* Combustor */}
          <rect x="146" y="36" width="28" height="24" rx="6" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.6" />
          <path d="M 160 42 L 164 52 L 156 52 Z" fill="#F59E0B" opacity="0.85" />
          {/* Gas Turbine */}
          <polygon points="214,42 242,36 242,60 214,54" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.6" />
          {/* HRSG HEX */}
          <circle cx="294" cy="48" r="10" fill="#0F172A" stroke="#FB7185" strokeWidth="1.6" />
          <path d="M 288 48 L 292 43 L 296 53 L 300 48" fill="none" stroke="#FB7185" strokeWidth="1.3" />
          {/* Rankine Pump */}
          <circle cx="84" cy="96" r="8" fill="#0F172A" stroke="#34D399" strokeWidth="1.5" />
          {/* Steam Boiler HEX */}
          <circle cx="145" cy="96" r="9.5" fill="#0F172A" stroke="#FB7185" strokeWidth="1.5" />
          {/* Steam Turbine */}
          <polygon points="214,90 242,85 242,107 214,102" fill="#0F172A" stroke="#34D399" strokeWidth="1.6" />
          {/* Labels */}
          <text x="89" y="70" fill="#94A3B8" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">COMP</text>
          <text x="160" y="70" fill="#FCD34D" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">1150°C</text>
          <text x="228" y="70" fill="#7DD3FC" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">GT +5.6MW</text>
          <text x="228" y="118" fill="#6EE7B7" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">ST +1.0MW</text>
        </g>
      );
    }

    if (item.presetId === 'textbook_bt_distillation' || item.category === 'separation') {
      // Rigorous 20-Stage Distillation Column + Condenser + Reboiler
      return (
        <g strokeLinecap="round" strokeLinejoin="round">
          {/* Feed Line */}
          <path d="M 44 68 H 148" fill="none" stroke="#38BDF8" strokeWidth="1.6" />
          {/* Overhead & Reflux */}
          <path d="M 164 30 V 22 H 218 M 234 22 H 288" fill="none" stroke="#7DD3FC" strokeWidth="1.5" />
          <path d="M 226 30 V 42 H 180" fill="none" stroke="#38BDF8" strokeWidth="1.2" strokeDasharray="3 2" />
          {/* Bottoms & Reboiler */}
          <path d="M 164 106 V 114 H 218 M 234 114 H 288" fill="none" stroke="#FB7185" strokeWidth="1.5" />
          <path d="M 226 106 V 94 H 180" fill="none" stroke="#FB7185" strokeWidth="1.2" strokeDasharray="3 2" />
          {/* Preheater */}
          <circle cx="96" cy="68" r="9.5" fill="#0F172A" stroke="#FB7185" strokeWidth="1.5" />
          <path d="M 90 68 L 94 63 L 98 73 L 102 68" fill="none" stroke="#FB7185" strokeWidth="1.3" />
          {/* Distillation Column */}
          <rect x="148" y="30" width="32" height="76" rx="14" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.8" />
          {[44, 54, 64, 74, 84, 94].map(y => (
            <line key={y} x1="153" y1={y} x2="175" y2={y} stroke="#38BDF8" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="3 2" />
          ))}
          {/* Condenser & Reboiler */}
          <circle cx="226" cy="22" r="8" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
          <circle cx="226" cy="114" r="8" fill="#0F172A" stroke="#FB7185" strokeWidth="1.5" />
          {/* Labels */}
          <text x="164" y="21" fill="#7DD3FC" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">T-101 (20 STG)</text>
          <text x="278" y="18" fill="#6EE7B7" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">99.1% BZ</text>
          <text x="278" y="109" fill="#FCA5A5" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">TOL BOT</text>
        </g>
      );
    }

    if (item.presetId === 'hda_toluene_benzene_recycle' || item.category === 'petrochemical') {
      // HDA Reactor + Flash + Wegstein Recycle Loop + Column
      return (
        <g strokeLinecap="round" strokeLinejoin="round">
          {/* Main forward train */}
          <path d="M 28 72 H 84 M 102 72 H 134 M 162 72 H 196 M 214 72 H 254 M 278 72 H 314" fill="none" stroke="#A78BFA" strokeWidth="1.5" />
          {/* Recycle Loop */}
          <path d="M 205 56 V 32 H 93 V 62" fill="none" stroke="#34D399" strokeWidth="1.5" strokeDasharray="4 2.5" />
          <polygon points="93,62 90,56 96,56" fill="#34D399" />
          {/* Mixer */}
          <polygon points="84,64 102,72 84,80" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
          {/* HDA Reactor */}
          <rect x="134" y="56" width="28" height="32" rx="6" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.7" />
          <line x1="148" y1="62" x2="148" y2="82" stroke="#F59E0B" strokeWidth="1.3" />
          {/* Flash Drum */}
          <rect x="196" y="56" width="18" height="32" rx="8" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.6" />
          {/* Aromatics Column */}
          <rect x="254" y="42" width="24" height="60" rx="10" fill="#0F172A" stroke="#A78BFA" strokeWidth="1.6" />
          <text x="148" y="27" fill="#6EE7B7" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">WEGSTEIN RECYCLE LOOP</text>
          <text x="148" y="100" fill="#FCD34D" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">R-101 HDA</text>
          <text x="266" y="114" fill="#C4B5FD" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">T-101 BZ</text>
        </g>
      );
    }

    // Default / Reaction & Esterification schematic
    return (
      <g strokeLinecap="round" strokeLinejoin="round">
        <path d="M 32 54 H 92 M 32 82 H 92 M 110 68 H 148 M 180 68 H 236 M 262 50 H 308 M 262 86 H 308" fill="none" stroke="#F472B6" strokeWidth="1.5" />
        {/* Mixer */}
        <polygon points="92,58 110,68 92,78" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
        {/* CSTR */}
        <rect x="148" y="48" width="32" height="40" rx="8" fill="#0F172A" stroke="#F472B6" strokeWidth="1.7" />
        <line x1="164" y1="42" x2="164" y2="74" stroke="#F472B6" strokeWidth="1.4" />
        <line x1="156" y1="74" x2="172" y2="74" stroke="#F472B6" strokeWidth="1.4" />
        {/* Separation Column */}
        <rect x="236" y="38" width="26" height="60" rx="11" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.6" />
        <text x="164" y="101" fill="#F9A8D4" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">CSTR (NRTL)</text>
        <text x="249" y="110" fill="#7DD3FC" fontSize="7.5" fontFamily="JetBrains Mono, monospace" textAnchor="middle">T-101</text>
      </g>
    );
  };

  const patternId = `bp-grid-${item.id}`;
  return (
    <div
      style={{
        position: 'relative',
        height: 138,
        background: 'radial-gradient(circle at 70% 20%, #152544 0%, #0B1220 75%)',
        borderBottom: '1px solid #1E293B',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 340 132"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <defs>
          <pattern id={patternId} width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="0.85" fill="#334155" opacity="0.7" />
          </pattern>
        </defs>
        <rect width="340" height="132" fill={`url(#${patternId})`} />
        {hasRealGraph ? renderRealGraph() : renderOfficialSchematic()}
      </svg>

      {/* Top-Left HUD: Category & Official */}
      <div style={{ position: 'absolute', top: 8, left: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: 4,
            background: cat.bg,
            color: cat.color,
            border: `1px solid ${cat.border}`,
            backdropFilter: 'blur(4px)',
          }}
        >
          {cat.label}
        </span>
        {item.isOfficial && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 900,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(37, 99, 235, 0.25)',
              border: '1px solid rgba(96, 165, 250, 0.5)',
              color: '#93C5FD',
            }}
          >
            ★ OFFICIAL
          </span>
        )}
        {item.postType === 'help' && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 900,
              padding: '2px 6px',
              borderRadius: 4,
              background: item.isSolved ? 'rgba(16, 185, 129, 0.24)' : 'rgba(245, 158, 11, 0.24)',
              border: item.isSolved ? '1px solid rgba(52, 211, 153, 0.55)' : '1px solid rgba(251, 191, 36, 0.55)',
              color: item.isSolved ? '#6EE7B7' : '#FCD34D',
            }}
          >
            {item.isSolved ? '✓ SOLVED' : '🆘 HELP'}
          </span>
        )}
      </div>

      {/* Top-Right HUD: Thermo & Convergence Telemetry */}
      <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #334155',
            color: '#E2E8F0',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {item.thermoMethod}
        </span>
        {item.converged && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(5, 150, 105, 0.22)',
              border: '1px solid rgba(52, 211, 153, 0.45)',
              color: '#6EE7B7',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            ✓ {item.massErrorPct !== null ? `${item.massErrorPct.toFixed(2)}%` : 'OK'}
          </span>
        )}
      </div>

      {/* Bottom-Left CAD Stamp */}
      <div
        style={{
          position: 'absolute',
          bottom: 6,
          left: 10,
          fontSize: 9.5,
          fontWeight: 700,
          color: '#64748B',
          fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '0.03em',
        }}
      >
        PFD-{String(item.id).padStart(3, '0')} · {item.unitCount}U / {item.streamCount}S
      </div>
    </div>
  );
}

export default function ProcessHubPage() {
  const { user, loading: authLoading } = useAuth();
  const lang = useUnitStore(s => s.lang);
  const setLang = useUnitStore(s => s.setLang);
  const isEn = lang === 'en';
  const router = useRouter();

  const [items, setItems] = useState<HubItem[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [postTypeFilter, setPostTypeFilter] = useState<'all' | 'showcase' | 'help'>('all');
  const [sort, setSort] = useState<'latest' | 'popular' | 'liked'>('latest');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());

  // Detail & Replies modal state
  const [activeItem, setActiveItem] = useState<HubItem | null>(null);
  const [replies, setReplies] = useState<HubReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyFixedUrl, setReplyFixedUrl] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        q: search.trim(),
        category,
        post_type: postTypeFilter,
        sort,
      });
      const res = await fetch(`/api/hub/list?${qs.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Failed to load Process Hub.');
        setItems([]);
      } else {
        setIsPublic(Boolean(data.isPublic));
        setItems(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      setError(isEn ? 'Network error loading Process Hub.' : 'Process Hub 데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, category, postTypeFilter, sort, isEn]);

  useEffect(() => {
    if (!authLoading) {
      fetchItems();
    }
  }, [authLoading, fetchItems]);

  const openDetailModal = async (item: HubItem) => {
    setActiveItem(item);
    setReplies([]);
    setReplyText('');
    setReplyFixedUrl('');
    setReplyError(null);
    setRepliesLoading(true);
    try {
      const res = await fetch(`/api/hub/item/${item.id}/replies`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok && Array.isArray(data.replies)) {
        setReplies(data.replies);
      }
    } catch {
      // ignore
    } finally {
      setRepliesLoading(false);
    }
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem) return;
    if (!user) {
      setReplyError(isEn ? 'Please sign in to post a reply.' : '답변을 작성하려면 먼저 로그인해 주세요.');
      return;
    }
    if (replyText.trim().length < 2) {
      setReplyError(isEn ? 'Please enter at least 2 characters.' : '답변 내용을 2글자 이상 입력해 주세요.');
      return;
    }
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/hub/item/${activeItem.id}/replies`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: replyText.trim(),
          fixedUrl: replyFixedUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReplyError(data?.detail || 'Failed to post reply.');
      } else if (data.reply) {
        setReplies(prev => [...prev, data.reply]);
        setItems(prev =>
          prev.map(x => (x.id === activeItem.id ? { ...x, replyCount: (x.replyCount ?? 0) + 1 } : x))
        );
        setActiveItem(prev => (prev ? { ...prev, replyCount: (prev.replyCount ?? 0) + 1 } : null));
        setReplyText('');
        setReplyFixedUrl('');
      }
    } catch {
      setReplyError(isEn ? 'Network error.' : '네트워크 오류가 발생했습니다.');
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleToggleSolved = async (item: HubItem) => {
    try {
      const res = await fetch(`/api/hub/item/${item.id}/solve`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        const nextSolved = Boolean(data.isSolved);
        setItems(prev => prev.map(x => (x.id === item.id ? { ...x, isSolved: nextSolved } : x)));
        setActiveItem(prev => (prev && prev.id === item.id ? { ...prev, isSolved: nextSolved } : prev));
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteReply = async (replyId: number) => {
    if (!activeItem) return;
    try {
      const res = await fetch(`/api/hub/reply/${replyId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setReplies(prev => prev.filter(r => r.id !== replyId));
        setItems(prev =>
          prev.map(x =>
            x.id === activeItem.id ? { ...x, replyCount: Math.max(0, (x.replyCount ?? 1) - 1) } : x
          )
        );
      }
    } catch {
      // ignore
    }
  };

  const handleOpenInSimulator = async (item: HubItem) => {
    try {
      fetch(`/api/hub/fork/${item.id}`, { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch {
      // non-blocking
    }
    if (item.presetId) {
      router.push(`/flowsheet-simulator?preset=${encodeURIComponent(item.presetId)}`);
    } else {
      router.push(`/flowsheet-simulator?hub=${item.id}`);
    }
  };

  const handleCopyLink = (item: HubItem) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://chemplantstudio.com';
    const url = item.presetId
      ? `${origin}/flowsheet-simulator?preset=${encodeURIComponent(item.presetId)}`
      : `${origin}/flowsheet-simulator?hub=${item.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(prev => (prev === item.id ? null : prev)), 1800);
  };

  const handleLike = async (item: HubItem) => {
    if (likedIds.has(item.id)) return;
    setLikedIds(prev => new Set(prev).add(item.id));
    setItems(prev => prev.map(x => (x.id === item.id ? { ...x, likes: x.likes + 1 } : x)));
    try {
      await fetch(`/api/hub/like/${item.id}`, { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
  };

  const handleDelete = async (item: HubItem) => {
    const msg = isEn
      ? `Delete "${item.title}" from Process Hub?`
      : `"${item.title}" 공정을 Process Hub에서 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await fetch(`/api/hub/item/${item.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setItems(prev => prev.filter(x => x.id !== item.id));
      }
    } catch {
      // ignore
    }
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B1220', color: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8' }}>Loading Process Hub...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F1F5F9', color: '#0F172A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        .cp-hub-card {
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }
        .cp-hub-card:hover {
          transform: translateY(-3px);
          border-color: #2563EB !important;
          box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12) !important;
        }
        .cp-hub-open-btn {
          transition: background 140ms ease;
        }
        .cp-hub-open-btn:hover {
          background: #1D4ED8 !important;
        }
      `}</style>

      {/* Top Header */}
      <header style={{ background: '#0B1220', color: '#F8FAFC', borderBottom: '1px solid #1E293B', position: 'sticky', top: 0, zIndex: 30 }}>
        <div style={{ maxWidth: 1260, margin: '0 auto', padding: '11px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/flowsheet-simulator" style={{ color: '#F8FAFC', textDecoration: 'none', fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: 'linear-gradient(135deg, #2563EB, #0EA5E9)', width: 26, height: 26, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 900, boxShadow: '0 0 12px rgba(14,165,233,0.4)' }}>CP</span>
              <span>ChemPlant <span style={{ color: '#38BDF8' }}>Process Hub</span></span>
            </Link>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.18)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                color: '#7DD3FC',
              }}
            >
              {isEn ? '🔒 Members Only · Beta' : '🔒 회원 전용 · 테스트 버전 (Beta)'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setLang(isEn ? 'ko' : 'en')}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1E293B', color: '#E2E8F0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              {isEn ? 'KO' : 'EN'}
            </button>
            <Link
              href="/flowsheet-simulator"
              style={{ padding: '6px 13px', borderRadius: 6, background: '#2563EB', color: '#FFFFFF', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
            >
              {isEn ? '← Open Simulator' : '← 시뮬레이터로 이동'}
            </Link>
          </div>
        </div>
      </header>

      {/* Blueprint CAD Hero Section */}
      <section
        style={{
          position: 'relative',
          background: 'linear-gradient(135deg, #0B1220 0%, #0F2347 55%, #1E3A8A 100%)',
          color: '#FFFFFF',
          padding: '34px 20px 30px',
          borderBottom: '1px solid #1E293B',
          overflow: 'hidden',
        }}
      >
        {/* Subtle CAD Blueprint Grid Overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(56, 189, 248, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.06) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', maxWidth: 1260, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#38BDF8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
              OPEN-BROWSER PROCESS FLOWSHEET LIBRARY
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: 27, fontWeight: 900, letterSpacing: '-0.025em', lineHeight: 1.2 }}>
              {isEn ? 'Open Community Flowsheet Hub' : '엔지니어 공정 시뮬레이션 공유 허브'}
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: '#CBD5E1', maxWidth: 680, lineHeight: 1.55 }}>
              {isEn
                ? 'An open beta space for process engineers to freely publish simulation results, request convergence help on tricky flowsheets, and share working fixes in one click.'
                : '화학·공정 엔지니어들이 시뮬레이션 결과를 자유롭게 게시·공유하고, 수렴이 안 되는 공정을 올려 서로 해결 방법과 수정된 공정을 나눌 수 있는 열린 테스트 공간(Beta)입니다.'}
            </p>
          </div>

          {/* Engineering Telemetry Counters */}
          <div style={{ display: 'flex', gap: 10, fontFamily: 'JetBrains Mono, monospace' }}>
            <div style={{ background: 'rgba(11, 18, 32, 0.65)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: 9, padding: '10px 14px', minWidth: 118 }}>
              <div style={{ fontSize: 9.5, color: '#94A3B8', letterSpacing: '0.05em' }}>FLOWSHEETS</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FFFFFF', marginTop: 2 }}>{items.length}</div>
            </div>
            <div style={{ background: 'rgba(11, 18, 32, 0.65)', border: '1px solid rgba(52, 211, 153, 0.25)', borderRadius: 9, padding: '10px 14px', minWidth: 132 }}>
              <div style={{ fontSize: 9.5, color: '#94A3B8', letterSpacing: '0.05em' }}>ENGINE STATUS</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#6EE7B7', marginTop: 6 }}>PR · NRTL · MESH</div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main style={{ maxWidth: 1260, margin: '0 auto', padding: '22px 20px 56px' }}>
        {/* Search + Sort Bar */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, flex: '1 1 320px', maxWidth: 500 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') fetchItems(); }}
              placeholder={isEn ? 'Search flowsheets, components, tags (e.g. CCGT, Benzene, NRTL)...' : '공정명, 물질명, 태그 검색 (예: CCGT, Benzene, NRTL)...'}
              style={{ flex: 1, padding: '9px 13px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 13, color: '#0F172A', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
            />
            <button
              type="button"
              onClick={() => fetchItems()}
              style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #1E3A8A', background: '#1E3A8A', color: '#FFFFFF', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
            >
              {isEn ? 'Search' : '검색'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>{isEn ? 'Sort:' : '정렬:'}</span>
            {([
              ['latest', isEn ? 'Latest' : '최신순'],
              ['popular', isEn ? 'Most Opened' : '인기순'],
              ['liked', isEn ? 'Most Liked' : '좋아요순'],
            ] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                style={{
                  padding: '6px 11px',
                  borderRadius: 7,
                  border: sort === k ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                  background: sort === k ? '#EFF6FF' : '#FFFFFF',
                  color: sort === k ? '#1E3A8A' : '#475569',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Post Type Tabs (All / Showcase / Convergence Help) */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {([
            ['all', isEn ? 'All Posts' : '전체 보기'],
            ['showcase', isEn ? '📘 Process Showcase' : '📘 공정 공유'],
            ['help', isEn ? '🆘 Convergence Help' : '🆘 수렴 · 조건 도움 요청'],
          ] as const).map(([pt, lbl]) => {
            const active = postTypeFilter === pt;
            const isHelpTab = pt === 'help';
            return (
              <button
                key={pt}
                type="button"
                onClick={() => setPostTypeFilter(pt)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: active
                    ? `1.5px solid ${isHelpTab ? '#D97706' : '#1E3A8A'}`
                    : '1px solid #CBD5E1',
                  background: active ? (isHelpTab ? '#FFFBEB' : '#EFF6FF') : '#FFFFFF',
                  color: active ? (isHelpTab ? '#92400E' : '#1E3A8A') : '#334155',
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {lbl}
              </button>
            );
          })}
        </div>

        {/* Category Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 22 }}>
          {CATEGORIES.map(c => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                style={{
                  padding: '6px 13px',
                  borderRadius: 999,
                  border: active ? '1px solid #0F172A' : '1px solid #CBD5E1',
                  background: active ? '#0F172A' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#334155',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isEn ? c.labelEn : c.labelKo}
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: 14, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
            {isEn ? 'Loading flowsheets...' : '공정 목록을 불러오는 중...'}
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, color: '#64748B', fontSize: 13 }}>
            {isEn ? 'No matching flowsheets found.' : '조건에 맞는 공유 공정이 없습니다.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(355px, 1fr))', gap: 18 }}>
            {items.map(item => (
              <article
                key={item.id}
                className="cp-hub-card"
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 12,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.05)',
                }}
              >
                <div>
                  {/* Live Dark Blueprint PFD Thumbnail */}
                  <div onClick={() => handleOpenInSimulator(item)} style={{ cursor: 'pointer' }}>
                    <PfdBlueprintThumbnail item={item} />
                  </div>

                  {/* Body */}
                  <div style={{ padding: '14px 16px 10px' }}>
                    <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 900, color: '#0F172A', lineHeight: 1.35 }}>
                      {item.title}
                    </h2>
                    <p style={{ margin: '0 0 10px', fontSize: 12.2, color: '#475569', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.description || (isEn ? 'No description provided.' : '설명이 입력되지 않았습니다.')}
                    </p>

                    {item.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {item.tags.map(tg => (
                          <span key={tg} style={{ fontSize: 10.5, fontWeight: 600, color: '#334155', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 4, padding: '1px 6px' }}>
                            #{tg}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '10px 16px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748B', paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid #F1F5F9', fontFamily: 'JetBrains Mono, monospace' }}>
                    <span>
                      👁 {item.views} · ⑂ {item.forks}
                    </span>
                    <span>
                      by <b style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif' }}>{item.authorName}</b>
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="cp-hub-open-btn"
                      onClick={() => handleOpenInSimulator(item)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 7,
                        border: '1px solid #1E3A8A',
                        background: '#1E3A8A',
                        color: '#FFFFFF',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ▶ {isEn ? 'Open in Simulator' : '시뮬레이터에서 열기'}
                    </button>

                    <button
                      type="button"
                      onClick={() => openDetailModal(item)}
                      title={isEn ? 'View details & convergence help replies' : '상세 보기 및 수렴 답변'}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 7,
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#334155',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      💬 {item.replyCount ?? 0}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyLink(item)}
                      title={isEn ? 'Copy direct share link' : '직접 공유 링크 복사'}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 7,
                        border: '1px solid #CBD5E1',
                        background: copiedId === item.id ? '#ECFDF5' : '#FFFFFF',
                        color: copiedId === item.id ? '#059669' : '#334155',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {copiedId === item.id ? '✓' : '🔗'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLike(item)}
                      title={isEn ? 'Like' : '좋아요'}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 7,
                        border: likedIds.has(item.id) ? '1px solid #F43F5E' : '1px solid #CBD5E1',
                        background: likedIds.has(item.id) ? '#FFF1F2' : '#FFFFFF',
                        color: likedIds.has(item.id) ? '#E11D48' : '#475569',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      ♥ {item.likes}
                    </button>

                    {(isAdmin || (user && user.id === item.authorId)) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        title={isEn ? 'Delete post' : '삭제'}
                        style={{
                          padding: '8px 9px',
                          borderRadius: 7,
                          border: '1px solid #FECACA',
                          background: '#FFFFFF',
                          color: '#DC2626',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Detail & Convergence Help Replies Modal */}
      {activeItem && (
        <div
          onClick={() => setActiveItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.62)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 640,
              maxHeight: '88vh',
              background: '#FFFFFF',
              borderRadius: 12,
              border: '1px solid #CBD5E1',
              boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div style={{ padding: '14px 18px', background: '#0F172A', color: '#FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {activeItem.postType === 'help' && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 900,
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: activeItem.isSolved ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)',
                      color: activeItem.isSolved ? '#6EE7B7' : '#FCD34D',
                      flexShrink: 0,
                    }}
                  >
                    {activeItem.isSolved ? '✓ SOLVED' : '🆘 HELP'}
                  </span>
                )}
                <span style={{ fontSize: 14.5, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeItem.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveItem(null)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 17, fontWeight: 800, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Scroll Body */}
            <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {activeItem.description || (isEn ? 'No description provided.' : '설명이 없습니다.')}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleOpenInSimulator(activeItem)}
                  style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #1E3A8A', background: '#1E3A8A', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                >
                  ▶ {isEn ? 'Open in Simulator to Inspect / Fix' : '시뮬레이터에서 열어 확인 · 수정하기'}
                </button>
                {activeItem.postType === 'help' && (isAdmin || (user && user.id === activeItem.authorId)) && (
                  <button
                    type="button"
                    onClick={() => handleToggleSolved(activeItem)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 7,
                      border: activeItem.isSolved ? '1px solid #10B981' : '1px solid #CBD5E1',
                      background: activeItem.isSolved ? '#ECFDF5' : '#FFFFFF',
                      color: activeItem.isSolved ? '#065F46' : '#334155',
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {activeItem.isSolved
                      ? (isEn ? '✓ Marked as Solved' : '✓ 해결됨 (취소)')
                      : (isEn ? 'Mark as Solved ✓' : '해결 완료로 표시 ✓')}
                  </button>
                )}
              </div>

              {/* Replies List */}
              <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A', marginBottom: 10 }}>
                  💬 {isEn ? `Engineering Replies & Fixes (${replies.length})` : `엔지니어 답변 · 수렴 해결 내역 (${replies.length})`}
                </div>

                {repliesLoading ? (
                  <div style={{ fontSize: 12, color: '#64748B', padding: '12px 0' }}>Loading...</div>
                ) : replies.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748B', padding: '14px 12px', background: '#F8FAFC', borderRadius: 8, border: '1px dashed #CBD5E1' }}>
                    {isEn
                      ? 'No replies yet. Open the flowsheet, try fixing convergence, and share your solution below!'
                      : '아직 답변이 없습니다. 공정을 열어 수렴을 해결한 뒤 아래에 팁이나 수정본 링크를 공유해 주세요!'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {replies.map(r => (
                      <div
                        key={r.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          background: r.isOfficial ? '#EFF6FF' : '#F8FAFC',
                          border: r.isOfficial ? '1px solid #BFDBFE' : '1px solid #E2E8F0',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                            <b style={{ color: '#0F172A' }}>{r.authorName}</b>
                            {r.isOfficial && (
                              <span style={{ fontSize: 9.5, fontWeight: 900, padding: '1px 6px', borderRadius: 999, background: '#1E3A8A', color: '#FFFFFF' }}>
                                ★ OFFICIAL
                              </span>
                            )}
                          </div>
                          {(isAdmin || (user && user.id === r.authorId)) && (
                            <button
                              type="button"
                              onClick={() => handleDeleteReply(r.id)}
                              style={{ background: 'transparent', border: 'none', color: '#DC2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              {isEn ? 'Delete' : '삭제'}
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#1E293B', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                          {r.message}
                        </div>
                        {r.fixedUrl && (
                          <div style={{ marginTop: 8 }}>
                            <a
                              href={r.fixedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '5px 10px',
                                borderRadius: 6,
                                background: '#059669',
                                color: '#FFFFFF',
                                fontSize: 11.5,
                                fontWeight: 800,
                                textDecoration: 'none',
                              }}
                            >
                              ▶ {isEn ? 'Open Converged Fix in Simulator ↗' : '수정 · 수렴된 공정 열기 ↗'}
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reply Composer */}
              {user ? (
                <form onSubmit={handleSubmitReply} style={{ borderTop: '1px solid #E2E8F0', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={
                      isEn
                        ? 'Share how you converged it, parameter tips, or questions...'
                        : '수렴 해결 방법, 운전 조건 조언, 또는 의견을 자유롭게 남겨주세요...'
                    }
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 12.5, color: '#0F172A', resize: 'vertical' }}
                  />
                  <input
                    type="text"
                    value={replyFixedUrl}
                    onChange={e => setReplyFixedUrl(e.target.value)}
                    placeholder={
                      isEn
                        ? '(Optional) Paste fixed flowsheet link: https://chemplantstudio.com/flowsheet-simulator?hub=...'
                        : '(선택) 수정해 수렴시킨 공정 링크 붙여넣기: https://chemplantstudio.com/flowsheet-simulator?hub=...'
                    }
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 11.5, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                  {replyError && (
                    <div style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 700 }}>{replyError}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      disabled={replySubmitting}
                      style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #1E3A8A', background: '#1E3A8A', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: replySubmitting ? 'wait' : 'pointer' }}
                    >
                      {replySubmitting ? (isEn ? 'Posting...' : '등록 중...') : (isEn ? 'Post Reply' : '답변 등록')}
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 12, fontSize: 12, color: '#475569', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{isEn ? 'Sign in to post a reply or share your fixed flowsheet.' : '로그인하시면 답변과 수정된 공정을 공유할 수 있습니다.'}</span>
                  <Link href="/" style={{ padding: '6px 12px', borderRadius: 6, background: '#1E3A8A', color: '#FFFFFF', fontSize: 11.5, fontWeight: 800, textDecoration: 'none' }}>
                    {isEn ? 'Sign In' : '로그인'}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
