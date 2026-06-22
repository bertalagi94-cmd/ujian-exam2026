'use client'

import { useEffect, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Modal ──────────────────────────────────────────────
interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const sizeMap = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={cn('modal w-full', sizeMap[size])}>
        <div className="modal-header">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="btn-ghost btn-icon">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────
interface StatCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  color?: string
  sub?: string
  trend?: { value: number; label: string }
}

export function StatCard({ label, value, icon: Icon, color = 'bg-brand-500', sub, trend }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className={cn('stat-icon', color)}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1">
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-sm text-slate-500 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
        {trend && (
          <div className={cn('text-xs font-medium mt-1', trend.value >= 0 ? 'text-emerald-600' : 'text-red-500')}>
            {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value)}% {trend.label}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Badge ──────────────────────────────────────────────
type BadgeVariant = 'green' | 'blue' | 'yellow' | 'red' | 'slate' | 'purple' | 'orange'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  dot?: boolean
}

const badgeVariants: Record<BadgeVariant, string> = {
  green: 'badge-green',
  blue: 'badge-blue',
  yellow: 'badge-yellow',
  red: 'badge-red',
  slate: 'badge-slate',
  purple: 'badge-purple',
  orange: 'badge bg-orange-50 text-orange-700 ring-1 ring-orange-600/20',
}

export function Badge({ children, variant = 'slate', dot }: BadgeProps) {
  return (
    <span className={badgeVariants[variant]}>
      {dot && (
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          { green: 'bg-emerald-500', blue: 'bg-blue-500', yellow: 'bg-amber-500', red: 'bg-red-500', slate: 'bg-slate-400', purple: 'bg-purple-500', orange: 'bg-orange-500' }[variant]
        )} />
      )}
      {children}
    </span>
  )
}

// ── Status Badge helpers ──────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { v: BadgeVariant; l: string }> = {
    AKTIF: { v: 'green', l: 'Aktif' },
    NONAKTIF: { v: 'red', l: 'Nonaktif' },
    DISETUJUI: { v: 'green', l: 'Disetujui' },
    MENUNGGU: { v: 'yellow', l: 'Menunggu' },
    DRAFT: { v: 'slate', l: 'Draft' },
    DITOLAK: { v: 'red', l: 'Ditolak' },
    BERJALAN: { v: 'blue', l: 'Berjalan' },
    SELESAI: { v: 'green', l: 'Selesai' },
    LULUS: { v: 'green', l: 'Lulus' },
    TIDAK_LULUS: { v: 'red', l: 'Tidak Lulus' },
    TERKUNCI: { v: 'red', l: 'Terkunci' },
    BELUM: { v: 'slate', l: 'Belum' },
  }
  const cfg = map[status] ?? { v: 'slate' as BadgeVariant, l: status }
  return <Badge variant={cfg.v} dot>{cfg.l}</Badge>
}

// ── Empty State ───────────────────────────────────────
export function EmptyState({
  message,
  title,
  description,
  icon: Icon,
}: {
  message?: string
  title?: string
  description?: string
  icon?: React.ElementType
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      {Icon && <Icon className="w-12 h-12 mb-3 opacity-40" />}
      {title && <p className="text-sm font-medium text-slate-500">{title}</p>}
      {description && <p className="text-xs mt-1 text-center max-w-xs">{description}</p>}
      {!title && !description && <p className="text-sm">{message ?? 'Tidak ada data'}</p>}
    </div>
  )
}

// ── Loading Spinner ───────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sz = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }
  return (
    <div className={cn('border-2 border-slate-200 border-t-brand-600 rounded-full animate-spin', sz[size])} />
  )
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Spinner size="lg" />
    </div>
  )
}

// ── Search Input ──────────────────────────────────────
interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder = 'Cari...', className }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        className={cn('input pl-9')}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

// ── Pagination ────────────────────────────────────────
interface PaginationProps {
  page: number
  totalPages: number
  onPage: (p: number) => void
  total?: number
  perPage?: number
}

export function Pagination({ page, totalPages, onPage, total, perPage }: PaginationProps) {
  if (totalPages <= 1) return null
  const start = total && perPage ? (page - 1) * perPage + 1 : null
  const end = total && perPage ? Math.min(page * perPage, total) : null

  return (
    <div className="flex items-center justify-between px-1 py-2">
      {total && start && end ? (
        <p className="text-xs text-slate-500">Menampilkan {start}–{end} dari {total} data</p>
      ) : <span />}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="btn-secondary btn-icon btn-sm disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i
          return (
            <button
              key={p}
              onClick={() => onPage(p)}
              className={cn('btn btn-sm min-w-[32px] justify-center', p === page ? 'btn-primary' : 'btn-secondary')}
            >
              {p}
            </button>
          )
        })}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="btn-secondary btn-icon btn-sm disabled:opacity-40"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Confirm Dialog ────────────────────────────────────
interface ConfirmProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'primary'
  loading?: boolean
}

export function Confirm({ open, onClose, onConfirm, title = 'Konfirmasi', message, confirmLabel = 'Ya, Lanjutkan', variant = 'danger', loading }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={loading}>Batal</button>
          <button
            onClick={onConfirm}
            className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
            disabled={loading}
          >
            {loading ? <Spinner size="sm" /> : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-slate-600 text-sm">{message}</p>
    </Modal>
  )
}

// ── Toast Notification ────────────────────────────────
// Simple in-place toast — wrap in layout for global use
export function Toast({ message, type = 'success', onClose }: { message: string; type?: 'success' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={cn(
      'fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-card-lg text-sm font-medium animate-slide-up',
      type === 'success' && 'bg-emerald-600 text-white',
      type === 'error' && 'bg-red-600 text-white',
      type === 'info' && 'bg-brand-600 text-white',
    )}>
      {message}
      <button onClick={onClose}><X className="w-4 h-4" /></button>
    </div>
  )
}
