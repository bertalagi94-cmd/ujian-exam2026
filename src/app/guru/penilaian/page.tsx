'use client'

// FIX (konsolidasi menu): "Koreksi Essay", "Rekap Nilai", dan "Kirim Nilai ke
// Wali Kelas" sebelumnya 3 menu terpisah di sidebar. Digabung jadi 1 menu
// "Penilaian" dengan 3 tab bernomor supaya guru langsung paham urutan
// kerjanya, tanpa harus menghafal di menu mana suatu langkah berada.
//
// Aturan penting (baca sebelum mengubah):
//  - Tab "Periksa Jawaban Essay" itu KONDISIONAL — hanya tampil kalau guru
//    ini punya sesi ujian dengan essay. Guru yang mapelnya PG-only tidak
//    akan pernah lihat tab ini, supaya tidak bingung melihat "langkah 1"
//    yang selalu kosong. Nomor tab menyesuaikan otomatis (lihat `tabs` di
//    bawah — dibangun dari array, bukan angka statis di JSX).
//  - Tiap tab adalah komponen mandiri (state, fetch, dsb masing-masing
//    tidak diubah dari halaman aslinya) — lihat folder ./tabs. Hanya tab
//    yang sedang aktif yang di-mount, supaya tidak ada fetch tersembunyi
//    di tab yang tidak sedang dilihat, dan supaya state antar-tab tidak
//    saling bocor.
//  - Route lama (/guru/koreksi-essay, /guru/nilai, /guru/kirim-nilai) tetap
//    ada sebagai redirect ke sini (?tab=...) supaya bookmark/link lama
//    tidak 404 — pola yang sama seperti redirect /guru/soal → /guru/paket.
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckSquare, BarChart3, Send, Check } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { apiRequest, cn } from '@/lib/utils'
import { PeriksaEssayTab } from './tabs/PeriksaEssayTab'
import { RekapNilaiTab } from './tabs/RekapNilaiTab'
import { KirimNilaiTab } from './tabs/KirimNilaiTab'

type TabKey = 'periksa' | 'rekap' | 'kirim'

interface TabDef {
  key: TabKey
  label: string
  desc: string
  icon: React.ElementType
  accent: 'emerald' | 'sky' | 'indigo'
}

// Kelas literal per warna — SENGAJA ditulis lengkap (bukan digabung lewat
// template string seperti `bg-${accent}-600`) supaya Tailwind bisa
// mendeteksinya saat build. Kalau nama kelas dirakit secara dinamis,
// Tailwind tidak akan tahu kelas itu harus di-generate.
const ACCENT: Record<TabDef['accent'], {
  activeBg: string
  activeRing: string
  numberActive: string
  numberInactive: string
  iconInactive: string
  badge: string
}> = {
  emerald: {
    activeBg: 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-600 shadow-emerald-500/30',
    activeRing: 'ring-emerald-200',
    numberActive: 'bg-white/25 text-white',
    numberInactive: 'bg-emerald-100 text-emerald-700',
    iconInactive: 'text-emerald-600',
    badge: 'bg-emerald-600 text-white',
  },
  sky: {
    activeBg: 'bg-gradient-to-br from-sky-500 to-sky-600 border-sky-600 shadow-sky-500/30',
    activeRing: 'ring-sky-200',
    numberActive: 'bg-white/25 text-white',
    numberInactive: 'bg-sky-100 text-sky-700',
    iconInactive: 'text-sky-600',
    badge: 'bg-sky-600 text-white',
  },
  indigo: {
    activeBg: 'bg-gradient-to-br from-indigo-500 to-indigo-600 border-indigo-600 shadow-indigo-500/30',
    activeRing: 'ring-indigo-200',
    numberActive: 'bg-white/25 text-white',
    numberInactive: 'bg-indigo-100 text-indigo-700',
    iconInactive: 'text-indigo-600',
    badge: 'bg-indigo-600 text-white',
  },
}

function PenilaianContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // null = belum tahu (masih dicek), true/false = hasil pengecekan.
  // Diasumsikan `true` dulu selagi loading supaya tab tidak "meloncat"
  // muncul untuk mayoritas guru yang memang punya essay; kalau ternyata
  // false, tab akan hilang begitu pengecekan selesai.
  const [adaEssay, setAdaEssay] = useState<boolean | null>(null)
  const [jumlahSesiEssay, setJumlahSesiEssay] = useState(0)

  useEffect(() => {
    let batal = false
    apiRequest<{ data: unknown[] }>('/api/guru/koreksi-essay/jadwal')
      .then(res => {
        if (batal) return
        const jumlah = (res.data ?? []).length
        setJumlahSesiEssay(jumlah)
        setAdaEssay(jumlah > 0)
      })
      .catch(() => { if (!batal) setAdaEssay(false) })
    return () => { batal = true }
  }, [])

  // Jembatan antar-tab: begitu guru merilis semua nilai essay di tab
  // "Periksa Jawaban Essay", kita pindah ke tab "Kirim Nilai" dan simpan
  // target mapel+kelasnya supaya grup itu otomatis terbuka di sana.
  const [focusTarget, setFocusTarget] = useState<{ mapelId: string; kelas: string; namaMapel: string; namaKelas: string } | null>(null)

  const tabs: TabDef[] = [
    ...(adaEssay !== false ? [{
      key: 'periksa' as TabKey,
      label: 'Periksa Jawaban Essay',
      desc: 'Baca jawaban & beri nilai per soal',
      icon: CheckSquare,
      accent: 'emerald' as const,
    }] : []),
    {
      key: 'rekap',
      label: 'Rekap Nilai',
      desc: 'Lihat & unduh rekap nilai',
      icon: BarChart3,
      accent: 'sky',
    },
    {
      key: 'kirim',
      label: 'Kirim Nilai ke Wali Kelas',
      desc: 'Rilis & kirim nilai akhir siswa',
      icon: Send,
      accent: 'indigo',
    },
  ]

  const tabFromUrl = searchParams.get('tab') as TabKey | null
  const activeKey: TabKey = (tabFromUrl && tabs.some(t => t.key === tabFromUrl))
    ? tabFromUrl
    : (tabs[0]?.key ?? 'rekap')

  function gotoTab(key: TabKey) {
    router.push(`/guru/penilaian?tab=${key}`, { scroll: false })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Penilaian</h1>
        <p className="page-subtitle">
          Periksa jawaban essay, lihat rekapnya, lalu kirim nilai akhir ke wali kelas — dalam satu alur.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        {tabs.map((tab, i) => {
          const isActive = tab.key === activeKey
          const style = ACCENT[tab.accent]
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => gotoTab(tab.key)}
              className={cn(
                'flex-1 flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all',
                isActive
                  ? cn('text-white shadow-lg', style.activeBg)
                  : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
              )}
            >
              <span
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
                  isActive ? style.numberActive : style.numberInactive
                )}
              >
                {i + 1}
              </span>
              <Icon className={cn('w-4.5 h-4.5 flex-shrink-0', isActive ? 'text-white' : style.iconInactive)} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-semibold truncate', isActive ? 'text-white' : 'text-slate-800')}>
                  {tab.label}
                  {tab.key === 'periksa' && jumlahSesiEssay > 0 && (
                    <span className={cn(
                      'ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold align-middle',
                      isActive ? 'bg-white/25 text-white' : style.badge
                    )}>
                      {jumlahSesiEssay}
                    </span>
                  )}
                </span>
                <span className={cn('block text-xs truncate', isActive ? 'text-white/85' : 'text-slate-400')}>
                  {tab.desc}
                </span>
              </span>
              {isActive && <Check className="w-4 h-4 text-white/90 flex-shrink-0" />}
            </button>
          )
        })}
      </div>

      {/* Isi tab — hanya tab aktif yang di-mount */}
      <div>
        {adaEssay === null && activeKey === 'periksa' ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : activeKey === 'periksa' ? (
          <PeriksaEssayTab
            onLanjutKirimNilai={(target) => {
              setFocusTarget(target)
              gotoTab('kirim')
            }}
          />
        ) : activeKey === 'rekap' ? (
          <RekapNilaiTab />
        ) : (
          <KirimNilaiTab focusTarget={focusTarget} />
        )}
      </div>
    </div>
  )
}

export default function PenilaianPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner size="lg" /></div>}>
      <PenilaianContent />
    </Suspense>
  )
}
