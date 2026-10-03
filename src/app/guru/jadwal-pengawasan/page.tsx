'use client'

// FIX (konsolidasi menu): "Jadwal Pengawasan" dan "Mode Pengawas" sebelumnya
// 2 menu terpisah di sidebar guru dengan nama yang mirip, sehingga guru
// sering bingung harus membuka yang mana. Digabung jadi 1 menu "Jadwal
// Mengawas Saya" dengan 2 tab bernomor, mengikuti pola menu "Penilaian":
//
//   1. Jadwal Mengawas — kapan & kelas mana saya mengawas (+ Ujian Susulan)
//   2. Mode Pengawas   — membuka sesi, memantau siswa, menutup sesi
//
// Aturan penting (baca sebelum mengubah):
//  - Isi tab ada di ./tabs sebagai komponen mandiri (state & fetch masing-
//    masing tidak berubah dari halaman aslinya). Hanya tab aktif yang
//    di-mount, supaya tidak ada polling tersembunyi di tab yang tidak
//    sedang dilihat.
//  - Tab awal PINTAR: kalau saat halaman dibuka ada sesi yang sedang
//    berlangsung, langsung masuk ke tab "Mode Pengawas" (itu yang dicari
//    guru saat ujian jalan); selain itu mulai dari tab "Jadwal Mengawas".
//    Tab awal ditentukan SEKALI saja, supaya tampilan tidak tiba-tiba
//    berpindah sendiri saat guru sedang membaca.
//  - Route lama /guru/mode-pengawas tetap ada sebagai redirect
//    (?tab=mode) supaya link/bookmark lama tidak 404.
//  - Tab bar sengaja 2 kolom sejajar di HP (bukan ditumpuk) supaya kedua
//    pilihan langsung terlihat tanpa scroll.
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Calendar, Shield, Check, PlayCircle } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { apiRequest, cn } from '@/lib/utils'
import { JadwalTab } from './tabs/JadwalTab'
import { ModePengawasTab } from './tabs/ModePengawasTab'

type TabKey = 'jadwal' | 'mode'

interface TabDef {
  key: TabKey
  label: string
  desc: string
  icon: React.ElementType
  accent: 'indigo' | 'orange'
}

// Kelas literal per warna — SENGAJA ditulis lengkap (bukan dirakit lewat
// template string) supaya Tailwind bisa mendeteksinya saat build.
const ACCENT: Record<TabDef['accent'], {
  activeBg: string
  numberActive: string
  numberInactive: string
  iconInactive: string
  badge: string
}> = {
  indigo: {
    activeBg: 'bg-gradient-to-br from-indigo-500 to-indigo-600 border-indigo-600 shadow-indigo-500/30',
    numberActive: 'bg-white/25 text-white',
    numberInactive: 'bg-indigo-100 text-indigo-700',
    iconInactive: 'text-indigo-600',
    badge: 'bg-indigo-600 text-white',
  },
  orange: {
    activeBg: 'bg-gradient-to-br from-orange-500 to-orange-600 border-orange-600 shadow-orange-500/30',
    numberActive: 'bg-white/25 text-white',
    numberInactive: 'bg-orange-100 text-orange-700',
    iconInactive: 'text-orange-600',
    badge: 'bg-orange-600 text-white',
  },
}

const TABS: TabDef[] = [
  {
    key: 'jadwal',
    label: 'Jadwal Mengawas',
    desc: 'Kapan & kelas mana',
    icon: Calendar,
    accent: 'indigo',
  },
  {
    key: 'mode',
    label: 'Mode Pengawas',
    desc: 'Mulai & pantau ujian',
    icon: Shield,
    accent: 'orange',
  },
]

const TAB_KEYS = TABS.map(t => t.key)

function isTabKey(v: string | null): v is TabKey {
  return !!v && (TAB_KEYS as string[]).includes(v)
}

interface RingkasanPengawasan {
  hariIni: number
  berjalan: number
}

function MengawasContent() {
  const searchParams = useSearchParams()

  // Ringkasan RINGAN untuk badge tab bar & penentuan tab awal. Sengaja fetch
  // sendiri (bukan menunggu tab dibuka) — pola yang sama seperti menu
  // Penilaian. Diulang tiap 60 detik dan tiap pindah tab supaya badge
  // "sedang berlangsung" tidak basi.
  const [ringkasan, setRingkasan] = useState<RingkasanPengawasan | null>(null)
  const [tabAwal, setTabAwal] = useState<TabKey | null>(null)

  const fetchRingkasan = useCallback(() => {
    interface Resp {
      data?: { tanggal: string; status: string }[]
      zonaWaktu?: { utcOffsetJam: number }
    }
    apiRequest<Resp>('/api/guru/jadwal-pengawasan', { timeoutMs: 8_000 })
      .then(res => {
        const list = res.data ?? []
        // "Hari ini" mengikuti zona waktu SEKOLAH dari server, bukan
        // timezone browser (sama seperti di tab Jadwal Mengawas).
        const offsetJam = res.zonaWaktu?.utcOffsetJam ?? 7
        const hariIni = new Date(Date.now() + offsetJam * 3600 * 1000).toISOString().slice(0, 10)
        const r: RingkasanPengawasan = {
          hariIni: list.filter(j => j.tanggal === hariIni).length,
          berjalan: list.filter(j => j.status === 'BERJALAN').length,
        }
        setRingkasan(r)
        // Tab awal ditentukan SEKALI (callback fungsional: kalau sudah
        // terisi, biarkan).
        setTabAwal(prev => prev ?? (r.berjalan > 0 ? 'mode' : 'jadwal'))
      })
      // Gagal memuat → tidak ada badge, mulai dari tab Jadwal.
      .catch(() => setTabAwal(prev => prev ?? 'jadwal'))
  }, [])

  useEffect(() => {
    fetchRingkasan()
    const interval = setInterval(fetchRingkasan, 60_000)
    return () => clearInterval(interval)
  }, [fetchRingkasan])

  // Ganti tab murni state lokal (instan, tanpa round-trip server); URL tetap
  // diupdate lewat window.history supaya link & tombol back/forward jalan.
  // Alasan lengkapnya sama dengan komentar di menu Penilaian.
  const [manualTab, setManualTab] = useState<TabKey | null>(null)

  useEffect(() => {
    function onPopState() {
      const tab = new URLSearchParams(window.location.search).get('tab')
      setManualTab(isTabKey(tab) ? tab : null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const tabDariUrl = searchParams.get('tab')
  const tabEksplisit: TabKey | null = manualTab ?? (isTabKey(tabDariUrl) ? tabDariUrl : null)
  // null = belum tahu tab mana yang harus dibuka (masih menunggu ringkasan).
  const activeKey: TabKey | null = tabEksplisit ?? tabAwal

  function gotoTab(key: TabKey) {
    setManualTab(key)
    window.history.pushState(null, '', `/guru/jadwal-pengawasan?tab=${key}`)
    // Dari tombol "Mulai Sesi" di bagian bawah daftar jadwal, guru perlu
    // langsung melihat bagian atas tab tujuan (terutama di HP).
    window.scrollTo({ top: 0, behavior: 'smooth' })
    fetchRingkasan()
  }

  function pesanTab(key: TabKey): { label: string; berdenyut?: boolean; amber?: boolean } | null {
    if (!ringkasan) return null
    if (key === 'jadwal' && ringkasan.hariIni > 0) {
      return { label: `${ringkasan.hariIni} jadwal hari ini` }
    }
    if (key === 'mode' && ringkasan.berjalan > 0) {
      return { label: `${ringkasan.berjalan} sedang berlangsung`, berdenyut: true, amber: true }
    }
    return null
  }

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Jadwal Mengawas Saya</h1>
        <p className="page-subtitle">
          Lihat jadwal mengawas Anda, lalu mulai dan pantau ujian — semuanya dari satu halaman.
        </p>
      </div>

      {/* Tab bar — 2 kolom sejajar di semua ukuran layar */}
      <div role="tablist" aria-label="Jadwal mengawas" className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {TABS.map((tab, i) => {
          const isActive = tab.key === activeKey
          const style = ACCENT[tab.accent]
          const Icon = tab.icon
          const pesan = pesanTab(tab.key)
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => gotoTab(tab.key)}
              className={cn(
                'flex min-w-0 items-center gap-2 sm:gap-3 rounded-2xl border px-3 py-2.5 sm:px-4 sm:py-3 text-left transition-all',
                isActive
                  ? cn('text-white shadow-lg', style.activeBg)
                  : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
              )}
            >
              <span
                className={cn(
                  'w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs sm:text-sm font-bold',
                  isActive ? style.numberActive : style.numberInactive
                )}
              >
                {i + 1}
              </span>
              <Icon className={cn('hidden sm:block w-4.5 h-4.5 flex-shrink-0', isActive ? 'text-white' : style.iconInactive)} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-semibold leading-tight', isActive ? 'text-white' : 'text-slate-800')}>
                  {tab.label}
                </span>
                <span className={cn('block text-[11px] sm:text-xs leading-snug mt-0.5', isActive ? 'text-white/85' : 'text-slate-400')}>
                  {tab.desc}
                </span>
                {pesan && (
                  <span
                    className={cn(
                      'mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-tight',
                      pesan.amber ? 'bg-amber-500 text-white' : isActive ? 'bg-white/25 text-white' : style.badge
                    )}
                  >
                    {pesan.berdenyut && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse flex-shrink-0" />}
                    {pesan.label}
                  </span>
                )}
              </span>
              {isActive && <Check className="hidden sm:block w-4 h-4 text-white/90 flex-shrink-0" />}
            </button>
          )
        })}
      </div>

      {/* Pengingat: ada ujian berjalan tapi guru sedang di tab Jadwal. Tombolnya
          besar & lebar penuh di HP supaya mudah ditekan. */}
      {activeKey === 'jadwal' && ringkasan && ringkasan.berjalan > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="flex-1 text-sm text-amber-800">
            <strong>{ringkasan.berjalan} ujian sedang berlangsung.</strong> Pantau siswa dan tutup sesi di tab Mode Pengawas.
          </p>
          <button
            type="button"
            onClick={() => gotoTab('mode')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
          >
            <PlayCircle className="w-4 h-4" />
            Buka Mode Pengawas
          </button>
        </div>
      )}

      {/* Isi tab — hanya tab aktif yang di-mount */}
      <div>
        {activeKey === null ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : activeKey === 'mode' ? (
          <ModePengawasTab />
        ) : (
          <JadwalTab onBukaMode={() => gotoTab('mode')} />
        )}
      </div>
    </div>
  )
}

export default function JadwalMengawasPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner size="lg" /></div>}>
      <MengawasContent />
    </Suspense>
  )
}
