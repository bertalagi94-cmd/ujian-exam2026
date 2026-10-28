'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity, AlertTriangle, Building2, Check, CheckCircle2, ChevronDown, Clock, Copy, ImagePlus,
  Inbox, Loader2, LogOut, MessageCircle, Power, RefreshCw, Search, ShieldCheck, Sparkles,
  Trash2, UploadCloud, Users, X, XCircle,
} from 'lucide-react'

// ── Tipe data (tidak berubah dari versi sebelumnya) ──────────────────────────
interface Yayasan {
  id: string; kode: string; nama: string; status: 'MENUNGGU' | 'AKTIF' | 'NONAKTIF'
  jumlah_siswa?: number; created_at?: string
}
interface Pengajuan {
  id: string; nama_sekolah: string; npsn: string; username: string; no_hp: string | null
  status: 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'; alasan_tolak: string | null
  created_at: string; diputuskan_at: string | null; kode_sekolah?: string | null
}

type Tab = 'pengajuan' | 'sekolah' | 'branding'
type FilterStatus = 'SEMUA' | 'AKTIF' | 'NONAKTIF' | 'MENUNGGU'
type Tone = 'emerald' | 'rose' | 'amber'

interface Dialog {
  judul: string
  isi: React.ReactNode
  tone: Tone
  label: string
  alasan?: { placeholder: string }
  onOk: (alasan: string) => void | Promise<void>
}
interface Toast { id: number; tipe: 'ok' | 'err'; pesan: string }

// ── Helper ───────────────────────────────────────────────────────────────────
const tglWaktu = (s: string) => new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
const tgl = (s?: string) => (s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')

function lalu(s: string): string {
  const mnt = Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 60000))
  if (mnt < 1) return 'baru saja'
  if (mnt < 60) return `${mnt} menit lalu`
  const jam = Math.floor(mnt / 60)
  if (jam < 24) return `${jam} jam lalu`
  return `${Math.floor(jam / 24)} hari lalu`
}
const hariMenunggu = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / 86400000)

function linkWa(hp: string): string {
  let n = hp.replace(/\D/g, '')
  if (n.startsWith('0')) n = '62' + n.slice(1)
  else if (n.startsWith('8')) n = '62' + n
  return `https://wa.me/${n}`
}

function inisial(nama: string): string {
  const k = nama.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  return ((k[0]?.[0] ?? '?') + (k[1]?.[0] ?? '')).toUpperCase()
}

// Warna avatar stabil per nama (hash sederhana).
const AVATAR = [
  'from-emerald-400 to-cyan-500', 'from-violet-400 to-fuchsia-500', 'from-sky-400 to-indigo-500',
  'from-amber-400 to-orange-500', 'from-rose-400 to-pink-500', 'from-teal-400 to-emerald-500',
]
const warnaAvatar = (s: string) => AVATAR[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]

const TONE_BTN: Record<Tone, string> = {
  emerald: 'from-emerald-400 to-cyan-400 text-emerald-950 shadow-emerald-500/30',
  rose: 'from-rose-500 to-pink-500 text-white shadow-rose-500/30',
  amber: 'from-amber-400 to-orange-400 text-amber-950 shadow-amber-500/30',
}
const TONE_ICON: Record<Tone, string> = {
  emerald: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-400/30',
  amber: 'bg-amber-400/15 text-amber-300 ring-amber-400/30',
}

// ── Komponen kecil ───────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  const map: Record<string, { cls: string; dot: string; teks: string }> = {
    AKTIF: { cls: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30', dot: 'bg-emerald-400', teks: 'Aktif' },
    NONAKTIF: { cls: 'bg-rose-400/10 text-rose-300 ring-rose-400/30', dot: 'bg-rose-400', teks: 'Nonaktif' },
    MENUNGGU: { cls: 'bg-amber-400/10 text-amber-300 ring-amber-400/30', dot: 'bg-amber-400', teks: 'Menunggu' },
    DISETUJUI: { cls: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30', dot: 'bg-emerald-400', teks: 'Disetujui' },
    DITOLAK: { cls: 'bg-rose-400/10 text-rose-300 ring-rose-400/30', dot: 'bg-rose-400', teks: 'Ditolak' },
  }
  const m = map[status] ?? map.MENUNGGU
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${status === 'MENUNGGU' ? 'dv-kedip' : ''}`} />
      {m.teks}
    </span>
  )
}

function StatCard({ ikon, label, nilai, sub, warna, loading }: {
  ikon: React.ReactNode; label: string; nilai: number | string; sub?: string
  warna: 'emerald' | 'cyan' | 'violet' | 'amber' | 'rose'; loading: boolean
}) {
  const w = {
    emerald: { g: 'from-emerald-400/25', i: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/25', n: 'text-emerald-200' },
    cyan: { g: 'from-cyan-400/25', i: 'text-cyan-300 bg-cyan-400/10 ring-cyan-400/25', n: 'text-cyan-200' },
    violet: { g: 'from-violet-400/25', i: 'text-violet-300 bg-violet-400/10 ring-violet-400/25', n: 'text-violet-200' },
    amber: { g: 'from-amber-400/25', i: 'text-amber-300 bg-amber-400/10 ring-amber-400/25', n: 'text-amber-200' },
    rose: { g: 'from-rose-400/25', i: 'text-rose-300 bg-rose-400/10 ring-rose-400/25', n: 'text-rose-200' },
  }[warna]
  return (
    <div className="dv-kaca dv-angkat relative overflow-hidden rounded-2xl p-4 md:p-5">
      <div className={`pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${w.g} to-transparent blur-2xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 font-medium">{label}</p>
          {loading
            ? <div className="mt-3 h-8 w-16 rounded-md dv-skel" />
            : <p className={`mt-1.5 text-3xl font-bold tabular-nums ${w.n}`}>{nilai}</p>}
          {sub && !loading && <p className="mt-1 text-[11px] text-slate-500 truncate">{sub}</p>}
        </div>
        <div className={`shrink-0 w-10 h-10 rounded-xl grid place-items-center ring-1 ${w.i}`}>{ikon}</div>
      </div>
    </div>
  )
}

function Kosong({ ikon, judul, sub }: { ikon: React.ReactNode; judul: string; sub?: string }) {
  return (
    <div className="py-14 px-6 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl grid place-items-center bg-white/5 ring-1 ring-white/10 text-slate-500">{ikon}</div>
      <p className="mt-4 text-sm font-semibold text-slate-300">{judul}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function SalinKode({ kode }: { kode: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(kode); setOk(true); setTimeout(() => setOk(false), 1500) } catch { /* abaikan */ }
      }}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 ring-1 ring-white/10 font-mono text-[11px] text-slate-300 transition"
      title="Salin kode sekolah"
    >
      {kode}
      {ok ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3 text-slate-500" />}
    </button>
  )
}

// ── Halaman ──────────────────────────────────────────────────────────────────
export default function DeveloperPage() {
  const router = useRouter()
  const [daftar, setDaftar] = useState<Yayasan[]>([])
  const [pengajuan, setPengajuan] = useState<{ menunggu: Pengajuan[]; riwayat: Pengajuan[] }>({ menunggu: [], riwayat: [] })
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [logoAplikasi, setLogoAplikasi] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [namaDev, setNamaDev] = useState('Developer')
  const [tab, setTab] = useState<Tab>('pengajuan')
  const [cari, setCari] = useState('')
  const [filter, setFilter] = useState<FilterStatus>('SEMUA')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [alasan, setAlasan] = useState('')
  const [proses, setProses] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [bukaRiwayat, setBukaRiwayat] = useState(false)
  const [seret, setSeret] = useState(false)
  const [jam, setJam] = useState('')
  const toastId = useRef(0)

  const toast = useCallback((tipe: 'ok' | 'err', pesan: string) => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, tipe, pesan }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tipe === 'err' ? 6000 : 4000)
  }, [])

  const api = useCallback(async (url: string, init?: RequestInit) => {
    const token = localStorage.getItem('dev_token')
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 401) {
      localStorage.removeItem('dev_token'); localStorage.removeItem('dev_user')
      router.replace('/developer/login')
      throw new Error('Sesi berakhir, silakan masuk lagi')
    }
    if (!res.ok) throw new Error(json.error || 'Gagal')
    return json
  }, [router])

  const muat = useCallback(async () => {
    setLoading(true)
    try {
      setDaftar((await api('/api/developer/yayasan')).data)
      setPengajuan((await api('/api/developer/pengajuan')).data)
      setLogoAplikasi((await api('/api/developer/logo-aplikasi')).url ?? '')
    } catch (e) { toast('err', (e as Error).message) }
    finally { setLoading(false) }
  }, [api, toast])

  useEffect(() => {
    if (!localStorage.getItem('dev_token')) { router.replace('/developer/login'); return }
    try {
      const u = JSON.parse(localStorage.getItem('dev_user') || '{}')
      setNamaDev(u.nama || u.username || 'Developer')
    } catch { /* abaikan */ }
    setReady(true); muat()
  }, [router, muat])

  // Jam digital kecil di header.
  useEffect(() => {
    const tick = () => setJam(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick(); const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Esc menutup dialog.
  useEffect(() => {
    if (!dialog) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !proses) setDialog(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [dialog, proses])

  function keluar() {
    localStorage.removeItem('dev_token'); localStorage.removeItem('dev_user')
    router.replace('/developer/login')
  }

  function bukaDialog(d: Dialog) { setAlasan(''); setDialog(d) }

  async function jalankanDialog() {
    if (!dialog) return
    if (dialog.alasan && !alasan.trim()) return
    setProses(true)
    try { await dialog.onOk(alasan.trim()) } finally { setProses(false); setDialog(null) }
  }

  // ── Aksi (logika & endpoint sama seperti sebelumnya) ───────────────────────
  function putuskan(p: Pengajuan, aksi: 'SETUJUI' | 'TOLAK') {
    const kirim = async (alasanTolak: string) => {
      try {
        await api(`/api/developer/pengajuan/${p.id}`, { method: 'PATCH', body: JSON.stringify({ aksi, alasan: alasanTolak }) })
        toast('ok', aksi === 'SETUJUI'
          ? `${p.nama_sekolah} disetujui. Admin bisa login dengan email ${p.username}.`
          : `${p.nama_sekolah} ditolak.`)
        muat()
      } catch (err) { toast('err', (err as Error).message) }
    }
    if (aksi === 'TOLAK') {
      bukaDialog({
        judul: 'Tolak pengajuan', tone: 'rose', label: 'Tolak pengajuan',
        isi: <>Berikan alasan penolakan untuk <b className="text-white">{p.nama_sekolah}</b>. Alasan akan tercatat di riwayat.</>,
        alasan: { placeholder: 'Contoh: NPSN tidak sesuai data Dapodik…' },
        onOk: kirim,
      })
    } else {
      bukaDialog({
        judul: 'Setujui pengajuan', tone: 'emerald', label: 'Ya, setujui',
        isi: <><b className="text-white">{p.nama_sekolah}</b> (NPSN {p.npsn}) akan diaktifkan. Email <span className="font-mono text-emerald-300">{p.username}</span> akan menjadi admin sekolah.</>,
        onOk: kirim,
      })
    }
  }

  function ubahStatus(y: Yayasan, status: 'AKTIF' | 'NONAKTIF') {
    const kirim = async () => {
      try {
        await api(`/api/developer/yayasan/${y.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
        toast('ok', `${y.nama} ${status === 'AKTIF' ? 'diaktifkan' : 'dinonaktifkan'}.`)
        muat()
      } catch (err) { toast('err', (err as Error).message) }
    }
    if (status === 'NONAKTIF') {
      bukaDialog({
        judul: 'Nonaktifkan sekolah', tone: 'rose', label: 'Nonaktifkan',
        isi: <><b className="text-white">{y.nama}</b> tidak akan bisa dipakai login sampai diaktifkan kembali.</>,
        onOk: kirim,
      })
    } else { kirim() }
  }

  async function unggahFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('err', 'File harus berupa gambar'); return }
    if (file.size > 2 * 1024 * 1024) { toast('err', 'Ukuran logo maksimal 2MB'); return }
    setUploadingLogo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // Tanpa Content-Type manual: browser mengisi boundary multipart sendiri.
      const res = await fetch('/api/developer/logo-aplikasi', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('dev_token')}` },
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) { keluar(); return }
      if (!res.ok) throw new Error(json.error || 'Upload gagal')
      setLogoAplikasi(json.url)
      toast('ok', 'Logo aplikasi diperbarui untuk semua sekolah.')
    } catch (err) { toast('err', (err as Error).message) }
    finally { setUploadingLogo(false) }
  }

  function unggahLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    void unggahFile(file)
  }

  function hapusLogo() {
    bukaDialog({
      judul: 'Hapus logo aplikasi', tone: 'rose', label: 'Hapus logo',
      isi: 'Halaman login & sidebar semua sekolah akan memakai logo sekolah masing-masing.',
      onOk: async () => {
        try {
          await api('/api/developer/logo-aplikasi', { method: 'DELETE' })
          setLogoAplikasi('')
          toast('ok', 'Logo aplikasi dihapus.')
        } catch (err) { toast('err', (err as Error).message) }
      },
    })
  }

  // ── Turunan data ───────────────────────────────────────────────────────────
  const stat = useMemo(() => {
    const aktif = daftar.filter(y => y.status === 'AKTIF').length
    const nonaktif = daftar.filter(y => y.status === 'NONAKTIF').length
    const menunggu = daftar.filter(y => y.status === 'MENUNGGU').length
    const siswa = daftar.reduce((a, y) => a + (y.jumlah_siswa ?? 0), 0)
    return { total: daftar.length, aktif, nonaktif, menunggu, siswa }
  }, [daftar])

  const maksSiswa = useMemo(() => Math.max(1, ...daftar.map(y => y.jumlah_siswa ?? 0)), [daftar])

  const daftarTampil = useMemo(() => {
    const q = cari.trim().toLowerCase()
    return daftar.filter(y =>
      (filter === 'SEMUA' || y.status === filter) &&
      (!q || y.nama.toLowerCase().includes(q) || y.kode.toLowerCase().includes(q)))
  }, [daftar, cari, filter])

  if (!ready) return null

  const sapaan = (() => {
    const h = new Date().getHours()
    return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
  })()

  const TABS: { id: Tab; label: string; ikon: React.ReactNode; badge?: number }[] = [
    { id: 'pengajuan', label: 'Pengajuan', ikon: <Inbox className="w-4 h-4" />, badge: pengajuan.menunggu.length },
    { id: 'sekolah', label: 'Daftar Sekolah', ikon: <Building2 className="w-4 h-4" />, badge: stat.total },
    { id: 'branding', label: 'Logo Aplikasi', ikon: <Sparkles className="w-4 h-4" /> },
  ]

  return (
    <main className="dv-root min-h-screen text-slate-200 relative overflow-x-hidden">
      <style>{CSS}</style>

      {/* Latar: grid + blob cahaya */}
      <div className="pointer-events-none fixed inset-0 -z-0">
        <div className="absolute inset-0 dv-grid" />
        <div className="dv-blob dv-b1" /><div className="dv-blob dv-b2" /><div className="dv-blob dv-b3" />
        <div className="absolute inset-0 dv-fade" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#04090c]/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="dv-logo w-10 h-10 rounded-xl grid place-items-center shrink-0">
              {logoAplikasi
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoAplikasi} alt="" className="w-7 h-7 object-contain" />
                : <ShieldCheck className="w-5 h-5 text-emerald-950" />}
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="text-[15px] font-bold text-white truncate">SmartExam <span className="text-emerald-300">Developer</span></h1>
              <p className="text-[10px] tracking-[0.18em] text-slate-500 font-mono uppercase truncate">Konsol pengelola aplikasi</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 font-mono text-xs text-emerald-300 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-emerald-400/70" />{jam}
            </span>
            <button onClick={muat} disabled={loading} title="Muat ulang data"
              className="w-9 h-9 grid place-items-center rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-slate-300 transition disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={keluar}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 ring-1 ring-rose-400/25 text-rose-300 text-sm font-medium transition">
              <LogOut className="w-4 h-4" /><span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 space-y-6">
        {/* Hero */}
        <section className="dv-kaca relative overflow-hidden rounded-3xl p-6 md:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 w-64 h-64 rounded-full bg-gradient-to-br from-emerald-400/30 via-cyan-400/20 to-transparent blur-3xl" />
          <div className="pointer-events-none absolute -left-10 -bottom-20 w-56 h-56 rounded-full bg-gradient-to-tr from-violet-500/20 to-transparent blur-3xl" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <p className="inline-flex items-center gap-2 text-[11px] font-mono tracking-[0.16em] text-emerald-300/80 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 dv-kedip" /> Sistem online
              </p>
              <h2 className="mt-2 text-2xl md:text-3xl font-extrabold text-white">
                {sapaan}, <span className="dv-teks-gradien">{namaDev}</span>
              </h2>
              <p className="mt-1.5 text-sm text-slate-400 max-w-xl">
                {pengajuan.menunggu.length > 0
                  ? <>Ada <b className="text-amber-300">{pengajuan.menunggu.length} pengajuan sekolah</b> yang menunggu keputusan Anda.</>
                  : 'Semua pengajuan sudah ditangani. Tidak ada yang menunggu saat ini.'}
              </p>
            </div>
            {pengajuan.menunggu.length > 0 && (
              <button onClick={() => setTab('pengajuan')}
                className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-emerald-950 text-sm font-bold shadow-lg shadow-emerald-500/25 hover:brightness-110 transition">
                <Inbox className="w-4 h-4" /> Tinjau sekarang
              </button>
            )}
          </div>
        </section>

        {/* Statistik */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard loading={loading} warna="emerald" label="Sekolah aktif" nilai={stat.aktif} sub={`dari ${stat.total} terdaftar`} ikon={<Building2 className="w-5 h-5" />} />
          <StatCard loading={loading} warna="cyan" label="Total siswa" nilai={stat.siswa.toLocaleString('id-ID')} sub="seluruh sekolah" ikon={<Users className="w-5 h-5" />} />
          <StatCard loading={loading} warna="amber" label="Menunggu" nilai={pengajuan.menunggu.length} sub="pengajuan baru" ikon={<Clock className="w-5 h-5" />} />
          <StatCard loading={loading} warna="rose" label="Nonaktif" nilai={stat.nonaktif} sub="sekolah dinonaktifkan" ikon={<Power className="w-5 h-5" />} />
        </section>

        {/* Tab */}
        <nav className="dv-kaca rounded-2xl p-1.5 flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 min-w-fit inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap ${tab === t.id
                ? 'bg-gradient-to-r from-emerald-400/20 to-cyan-400/15 text-emerald-200 ring-1 ring-emerald-400/30 shadow-[0_0_24px_rgba(52,255,160,0.12)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
              {t.ikon}{t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold grid place-items-center ${t.id === 'pengajuan' ? 'bg-amber-400 text-amber-950' : 'bg-white/10 text-slate-300'}`}>{t.badge}</span>
              )}
            </button>
          ))}
        </nav>

        {/* ── TAB: Pengajuan ── */}
        {tab === 'pengajuan' && (
          <section className="space-y-4 dv-masuk">
            {loading && pengajuan.menunggu.length === 0 ? (
              <div className="space-y-3">{[0, 1].map(i => <div key={i} className="h-28 rounded-2xl dv-skel" />)}</div>
            ) : pengajuan.menunggu.length === 0 ? (
              <div className="dv-kaca rounded-2xl">
                <Kosong ikon={<CheckCircle2 className="w-7 h-7 text-emerald-400/70" />} judul="Tidak ada pengajuan yang menunggu" sub="Pengajuan sekolah baru akan muncul di sini." />
              </div>
            ) : (
              pengajuan.menunggu.map(p => {
                const hari = hariMenunggu(p.created_at)
                return (
                  <article key={p.id} className="dv-kaca dv-angkat rounded-2xl p-4 md:p-5 relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-300 to-orange-400" />
                    <div className="flex flex-col lg:flex-row lg:items-center gap-4 pl-2">
                      <div className={`w-12 h-12 rounded-2xl grid place-items-center shrink-0 text-sm font-extrabold text-white bg-gradient-to-br ${warnaAvatar(p.nama_sekolah)}`}>
                        {inisial(p.nama_sekolah)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-white text-base">{p.nama_sekolah}</h3>
                          <Badge status="MENUNGGU" />
                          {hari >= 2 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-orange-300">
                              <AlertTriangle className="w-3 h-3" /> {hari} hari belum diputuskan
                            </span>
                          )}
                        </div>
                        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-1.5 text-xs">
                          <div><dt className="text-slate-500">NPSN</dt><dd className="font-mono text-slate-200">{p.npsn}</dd></div>
                          <div className="min-w-0"><dt className="text-slate-500">Email admin</dt><dd className="font-mono text-slate-200 truncate">{p.username}</dd></div>
                          <div><dt className="text-slate-500">WhatsApp</dt>
                            <dd className="text-slate-200">
                              {p.no_hp
                                ? <a href={linkWa(p.no_hp)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:underline">
                                  <MessageCircle className="w-3 h-3" />{p.no_hp}</a>
                                : '-'}
                            </dd>
                          </div>
                          <div><dt className="text-slate-500">Diajukan</dt><dd className="text-slate-200" title={tglWaktu(p.created_at)}>{lalu(p.created_at)}</dd></div>
                        </dl>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => putuskan(p, 'TOLAK')}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 ring-1 ring-rose-400/30 text-rose-300 text-sm font-semibold transition">
                          <XCircle className="w-4 h-4" /> Tolak
                        </button>
                        <button onClick={() => putuskan(p, 'SETUJUI')}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-emerald-950 text-sm font-bold shadow-lg shadow-emerald-500/25 hover:brightness-110 transition">
                          <CheckCircle2 className="w-4 h-4" /> Setujui
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })
            )}

            {/* Riwayat */}
            {pengajuan.riwayat.length > 0 && (
              <div className="dv-kaca rounded-2xl overflow-hidden">
                <button onClick={() => setBukaRiwayat(v => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Activity className="w-4 h-4 text-cyan-300" /> Riwayat keputusan
                    <span className="text-xs font-normal text-slate-500">({pengajuan.riwayat.length} terakhir)</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${bukaRiwayat ? 'rotate-180' : ''}`} />
                </button>
                {bukaRiwayat && (
                  <ul className="px-5 pb-5 space-y-0 border-t border-white/10 pt-4">
                    {pengajuan.riwayat.map((p, i) => (
                      <li key={p.id} className="relative pl-7 pb-4 last:pb-0">
                        {i < pengajuan.riwayat.length - 1 && <span className="absolute left-[9px] top-5 bottom-0 w-px bg-white/10" />}
                        <span className={`absolute left-0 top-1 w-[19px] h-[19px] rounded-full grid place-items-center ring-1 ${p.status === 'DISETUJUI' ? 'bg-emerald-400/15 ring-emerald-400/40 text-emerald-300' : 'bg-rose-400/15 ring-rose-400/40 text-rose-300'}`}>
                          {p.status === 'DISETUJUI' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-semibold text-slate-100">{p.nama_sekolah}</span>
                          <span className="font-mono text-[11px] text-slate-500">NPSN {p.npsn}</span>
                          <Badge status={p.status} />
                          {p.kode_sekolah && <SalinKode kode={p.kode_sekolah} />}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {p.diputuskan_at ? tglWaktu(p.diputuskan_at) : '-'}
                          {p.status === 'DITOLAK' && <> · <span className="text-rose-300/80">{p.alasan_tolak ?? '-'}</span></>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── TAB: Sekolah ── */}
        {tab === 'sekolah' && (
          <section className="space-y-4 dv-masuk">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Cari nama atau kode sekolah…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-white/5 ring-1 ring-white/10 focus:ring-emerald-400/50 focus:bg-white/[0.07] outline-none text-slate-100 placeholder:text-slate-500 transition" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                {(['SEMUA', 'AKTIF', 'NONAKTIF', 'MENUNGGU'] as FilterStatus[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ring-1 transition ${filter === f
                      ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/40'
                      : 'bg-white/5 text-slate-400 ring-white/10 hover:text-slate-200'}`}>
                    {f === 'SEMUA' ? 'Semua' : f === 'AKTIF' ? 'Aktif' : f === 'NONAKTIF' ? 'Nonaktif' : 'Menunggu'}
                  </button>
                ))}
              </div>
            </div>

            {/* Bar komposisi status */}
            {stat.total > 0 && (
              <div className="dv-kaca rounded-2xl px-5 py-4">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400">Komposisi status sekolah</span>
                  <span className="text-slate-500">{stat.total} sekolah</span>
                </div>
                <div className="h-2.5 rounded-full bg-white/5 overflow-hidden flex">
                  <div className="bg-gradient-to-r from-emerald-400 to-cyan-400" style={{ width: `${(stat.aktif / stat.total) * 100}%` }} />
                  <div className="bg-amber-400" style={{ width: `${(stat.menunggu / stat.total) * 100}%` }} />
                  <div className="bg-rose-400" style={{ width: `${(stat.nonaktif / stat.total) * 100}%` }} />
                </div>
                <div className="mt-2 flex gap-4 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-emerald-400" />Aktif {stat.aktif}</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-amber-400" />Menunggu {stat.menunggu}</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-rose-400" />Nonaktif {stat.nonaktif}</span>
                </div>
              </div>
            )}

            {loading && daftar.length === 0 ? (
              <div className="grid md:grid-cols-2 gap-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-36 rounded-2xl dv-skel" />)}</div>
            ) : daftarTampil.length === 0 ? (
              <div className="dv-kaca rounded-2xl">
                <Kosong ikon={<Building2 className="w-7 h-7" />} judul={daftar.length === 0 ? 'Belum ada sekolah' : 'Tidak ada sekolah yang cocok'} sub={daftar.length === 0 ? 'Sekolah baru masuk lewat pengajuan.' : 'Coba ubah kata kunci atau filter.'} />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3 md:gap-4">
                {daftarTampil.map(y => {
                  const siswa = y.jumlah_siswa ?? 0
                  return (
                    <article key={y.id} className="dv-kaca dv-angkat rounded-2xl p-5 flex flex-col gap-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-2xl grid place-items-center shrink-0 text-sm font-extrabold text-white bg-gradient-to-br ${warnaAvatar(y.nama)} ${y.status === 'NONAKTIF' ? 'grayscale opacity-60' : ''}`}>
                          {inisial(y.nama)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-white leading-snug">{y.nama}</h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <Badge status={y.status} />
                            <SalinKode kode={y.kode} />
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="inline-flex items-center gap-1.5 text-slate-400"><Users className="w-3.5 h-3.5" />Siswa terdaftar</span>
                          <span className="font-bold text-slate-100 tabular-nums">{siswa.toLocaleString('id-ID')}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-700" style={{ width: `${(siswa / maksSiswa) * 100}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-white/10">
                        <span className="text-[11px] text-slate-500">Terdaftar {tgl(y.created_at)}</span>
                        {y.id === 'YYS_AWAL'
                          ? <span className="inline-flex items-center gap-1 text-[11px] text-cyan-300/80"><ShieldCheck className="w-3.5 h-3.5" />Yayasan utama</span>
                          : y.status === 'NONAKTIF'
                            ? <button onClick={() => ubahStatus(y, 'AKTIF')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-400/10 hover:bg-emerald-400/20 ring-1 ring-emerald-400/30 text-emerald-300 text-xs font-semibold transition"><Power className="w-3.5 h-3.5" />Aktifkan</button>
                            : <button onClick={() => ubahStatus(y, 'NONAKTIF')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 ring-1 ring-rose-400/30 text-rose-300 text-xs font-semibold transition"><Power className="w-3.5 h-3.5" />Nonaktifkan</button>}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ── TAB: Logo aplikasi ── */}
        {tab === 'branding' && (
          <section className="dv-kaca rounded-2xl p-5 md:p-7 dv-masuk">
            <h3 className="text-lg font-bold text-white">Logo aplikasi</h3>
            <p className="text-sm text-slate-400 mt-1">Tampil di halaman login &amp; sidebar semua sekolah (bukan di dokumen cetak).</p>

            <div className="mt-6 grid md:grid-cols-[1fr_1.2fr] gap-6">
              {/* Pratinjau */}
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-medium">Pratinjau</p>
                <div className="grid grid-cols-2 gap-3">
                  {[{ n: 'Gelap', c: 'bg-slate-900' }, { n: 'Terang', c: 'bg-white' }].map(b => (
                    <div key={b.n} className={`aspect-square rounded-2xl ring-1 ring-white/10 grid place-items-center overflow-hidden ${b.c}`}>
                      {logoAplikasi
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={logoAplikasi} alt="Logo aplikasi" className="max-w-[70%] max-h-[70%] object-contain" />
                        : <span className={`text-xs ${b.n === 'Gelap' ? 'text-slate-500' : 'text-slate-400'}`}>Belum ada</span>}
                    </div>
                  ))}
                </div>
                {logoAplikasi && (
                  <button onClick={hapusLogo} className="inline-flex items-center gap-1.5 text-xs text-rose-300 hover:text-rose-200 transition">
                    <Trash2 className="w-3.5 h-3.5" /> Hapus logo
                  </button>
                )}
              </div>

              {/* Dropzone */}
              <label
                onDragOver={e => { e.preventDefault(); setSeret(true) }}
                onDragLeave={() => setSeret(false)}
                onDrop={e => { e.preventDefault(); setSeret(false); void unggahFile(e.dataTransfer.files?.[0]) }}
                className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center text-center gap-3 transition min-h-[220px] ${seret
                  ? 'border-emerald-400 bg-emerald-400/10'
                  : 'border-white/15 bg-white/[0.02] hover:border-emerald-400/50 hover:bg-emerald-400/5'} ${uploadingLogo ? 'opacity-60 pointer-events-none' : ''}`}>
                <div className="w-14 h-14 rounded-2xl grid place-items-center bg-emerald-400/10 ring-1 ring-emerald-400/30 text-emerald-300">
                  {uploadingLogo ? <Loader2 className="w-6 h-6 animate-spin" /> : <UploadCloud className="w-6 h-6" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">{uploadingLogo ? 'Mengupload…' : 'Tarik gambar ke sini atau klik untuk memilih'}</p>
                  <p className="text-xs text-slate-500 mt-1">JPG, PNG, GIF, WebP · maksimal 2MB</p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-xs font-semibold text-slate-200"><ImagePlus className="w-3.5 h-3.5" />Pilih file</span>
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" onChange={unggahLogo} disabled={uploadingLogo} />
              </label>
            </div>
            <p className="mt-5 text-xs text-slate-500 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />Hanya akun developer yang bisa mengubah logo ini.</p>
          </section>
        )}

        <footer className="pt-4 pb-2 text-center font-mono text-[11px] tracking-wider text-slate-600">
          Developed by : <span className="text-emerald-300/80 font-bold">Tasrif A. Abbas</span>
        </footer>
      </div>

      {/* Dialog konfirmasi */}
      {dialog && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm dv-fade-in" onMouseDown={e => { if (e.target === e.currentTarget && !proses) setDialog(null) }}>
          <div role="dialog" aria-modal="true" className="dv-kaca-solid w-full max-w-md rounded-2xl p-6 dv-pop">
            <div className="flex items-start gap-4">
              <div className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ring-1 ${TONE_ICON[dialog.tone]}`}>
                {dialog.tone === 'emerald' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-lg font-bold text-white">{dialog.judul}</h4>
                <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{dialog.isi}</p>
              </div>
            </div>
            {dialog.alasan && (
              <textarea autoFocus value={alasan} onChange={e => setAlasan(e.target.value)} rows={3} placeholder={dialog.alasan.placeholder}
                className="mt-4 w-full px-3.5 py-3 rounded-xl text-sm bg-white/5 ring-1 ring-white/10 focus:ring-rose-400/50 outline-none text-slate-100 placeholder:text-slate-500 resize-none" />
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setDialog(null)} disabled={proses}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-300 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition disabled:opacity-50">Batal</button>
              <button onClick={jalankanDialog} disabled={proses || (!!dialog.alasan && !alasan.trim())}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r shadow-lg transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed ${TONE_BTN[dialog.tone]}`}>
                {proses && <Loader2 className="w-4 h-4 animate-spin" />}{dialog.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 sm:w-96" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`dv-toast dv-kaca-solid rounded-xl px-4 py-3 flex items-start gap-3 ring-1 ${t.tipe === 'ok' ? 'ring-emerald-400/40' : 'ring-rose-400/40'}`}>
            {t.tipe === 'ok'
              ? <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              : <XCircle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />}
            <p className="text-sm text-slate-200 flex-1">{t.pesan}</p>
            <button onClick={() => setToasts(x => x.filter(i => i.id !== t.id))} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </main>
  )
}

// Gaya khusus panel developer (selaras dengan halaman login: hitam + hijau neon).
const CSS = `
.dv-root { background: #03070a; }
.dv-grid { background-image: linear-gradient(rgba(52,255,160,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(52,255,160,0.045) 1px, transparent 1px); background-size: 44px 44px; }
.dv-fade { background: radial-gradient(ellipse at 50% 0%, transparent 0%, rgba(3,7,10,0.55) 60%, #03070a 100%); }
.dv-blob { position: absolute; border-radius: 9999px; filter: blur(90px); opacity: .5; }
.dv-b1 { width: 460px; height: 460px; background: rgba(16,185,129,0.28); top: -140px; left: -120px; animation: dv-ap1 22s ease-in-out infinite; }
.dv-b2 { width: 420px; height: 420px; background: rgba(34,211,238,0.20); top: 18%; right: -140px; animation: dv-ap2 28s ease-in-out infinite; }
.dv-b3 { width: 380px; height: 380px; background: rgba(139,92,246,0.18); bottom: -120px; left: 30%; animation: dv-ap1 34s ease-in-out infinite reverse; }
@keyframes dv-ap1 { 50% { transform: translate(70px, 50px) scale(1.12); } }
@keyframes dv-ap2 { 50% { transform: translate(-80px, 60px) scale(0.9); } }
.dv-kaca { background: linear-gradient(145deg, rgba(255,255,255,0.065), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.09); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06); }
.dv-kaca-solid { background: #070f13; border: 1px solid rgba(52,255,160,0.25); box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 40px rgba(52,255,160,0.10); }
.dv-angkat { transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
.dv-angkat:hover { transform: translateY(-2px); border-color: rgba(52,255,160,0.35); box-shadow: 0 12px 40px rgba(0,0,0,0.45), 0 0 30px rgba(52,255,160,0.10); }
.dv-logo { background: linear-gradient(135deg, #34ffa0, #22d3ee); box-shadow: 0 0 22px rgba(52,255,160,0.45); }
.dv-teks-gradien { background: linear-gradient(90deg, #6ee7b7, #22d3ee, #a78bfa); -webkit-background-clip: text; background-clip: text; color: transparent; }
.dv-kedip { animation: dv-kedip 1.8s ease-in-out infinite; }
@keyframes dv-kedip { 50% { opacity: .35; } }
.dv-skel { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: dv-skel 1.4s linear infinite; }
@keyframes dv-skel { to { background-position: -200% 0; } }
.dv-masuk { animation: dv-masuk .35s ease-out both; }
@keyframes dv-masuk { from { opacity: 0; transform: translateY(10px); } }
.dv-fade-in { animation: dv-fi .2s ease-out both; }
@keyframes dv-fi { from { opacity: 0; } }
.dv-pop { animation: dv-pop .22s cubic-bezier(.2,.9,.3,1.2) both; }
@keyframes dv-pop { from { opacity: 0; transform: scale(.94) translateY(8px); } }
.dv-toast { animation: dv-toast .3s cubic-bezier(.2,.9,.3,1.1) both; }
@keyframes dv-toast { from { opacity: 0; transform: translateX(24px); } }
@media (prefers-reduced-motion: reduce) { .dv-blob, .dv-kedip, .dv-skel, .dv-masuk, .dv-pop, .dv-toast, .dv-fade-in { animation: none !important; } }
`
