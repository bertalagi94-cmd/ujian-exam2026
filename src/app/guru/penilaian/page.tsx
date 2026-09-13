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
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckSquare, BarChart3, Send, Check, AlertTriangle, CheckCircle2 } from 'lucide-react'
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

  // BUG FIX (badge tab bar tidak ikut update setelah aksi di dalam tab):
  // fungsi-fungsi fetch ringkasan di bawah ini sebelumnya HANYA dipanggil
  // sekali saat mount (di dalam useEffect masing-masing dengan dependency
  // kosong `[]`). Begitu guru menyimpan nilai remedial di tab "Rekap
  // Nilai", tab itu me-refresh data dirinya SENDIRI (state lokalnya) tapi
  // tidak pernah memberi tahu halaman ini untuk menghitung ulang ringkasan
  // di badge tab bar — jadi badge "1 Siswa di Bawah KKM" tetap nyangkut
  // walau nilainya sudah lulus semua, sampai guru refresh browser (yang
  // me-remount semuanya dari nol). Sekarang tiga fetch ringkasan diubah
  // jadi fungsi bernama (bukan langsung di dalam useEffect) supaya bisa
  // dipanggil ULANG lewat `refreshRingkasan`, yang diteruskan sebagai
  // prop `onDataChanged` ke KETIGA tab. Setiap aksi di tab yang mengubah
  // nilai/status siswa (simpan remedial, nilai/rilis essay, kirim ke wali
  // kelas) memanggil prop ini setelah berhasil, supaya badge di tab bar
  // ini langsung akurat tanpa perlu refresh manual.
  const fetchAdaEssay = useCallback(() => {
    apiRequest<{ data: unknown[] }>('/api/guru/koreksi-essay/jadwal')
      .then(res => {
        const jumlah = (res.data ?? []).length
        setJumlahSesiEssay(jumlah)
        setAdaEssay(jumlah > 0)
      })
      .catch(() => setAdaEssay(prev => prev ?? false))
  }, [])

  useEffect(() => { fetchAdaEssay() }, [fetchAdaEssay])

  // UX (peringatan di tab bar): "Rekap Nilai" & "Kirim Nilai ke Wali Kelas"
  // masing-masing komponen tab mandiri (fetch sendiri, lihat komentar di
  // atas), jadi supaya tab bar bisa menampilkan ringkasan tanpa menunggu
  // tab itu dibuka, halaman ini fetch RINGAN sendiri secara independen —
  // sama seperti pola `adaEssay`/`jumlahSesiEssay` di atas.
  const [ringkasanRekap, setRingkasanRekap] = useState<{ diBawahKkm: number; adaData: boolean } | null>(null)
  const [ringkasanKirim, setRingkasanKirim] = useState<{ mapelBelumKirim: number; siswaBaruBelumKirim: number; siswaMenungguEssay: number; adaData: boolean } | null>(null)

  // Ringkasan "Rekap Nilai": jumlah siswa yang nilai akhirnya (nilai_final,
  // sudah termasuk remedial) di bawah KKM. `stats.tidakLulus` sudah dihitung
  // server-side di /api/guru/nilai dari nilai_final/lulus_final, dan TIDAK
  // ikut menghitung siswa yang belum ujian sama sekali — persis yang
  // dibutuhkan di sini.
  const fetchRingkasanRekap = useCallback(() => {
    apiRequest<{ stats: { tidakLulus: number } | null }>('/api/guru/nilai')
      .then(res => {
        setRingkasanRekap({ diBawahKkm: res.stats?.tidakLulus ?? 0, adaData: !!res.stats })
      })
      .catch(() => setRingkasanRekap(null))
  }, [])

  useEffect(() => { fetchRingkasanRekap() }, [fetchRingkasanRekap])

  // Ringkasan "Kirim Nilai ke Wali Kelas": TIGA kondisi berbeda yang perlu
  // dibedakan (sama seperti `statusKirimKelompok` di KirimNilaiTab) —
  //  - Mapel yang BELUM PERNAH dikirim sama sekali → "X Mapel Belum Dikirim"
  //  - Mapel yang sudah pernah dikirim, TAPI ada nilai siswa baru masuk
  //    setelah pengiriman terakhir dan belum ikut terkirim → "X Siswa
  //    Belum Dikirim".
  //  - Mapel yang sudah pernah dikirim SEBAGIAN, dan sisanya murni
  //    tertunda menunggu rilis nilai essay (bukan siswa baru) → "X Siswa
  //    Menunggu Rilis Essay".
  //
  // BUG FIX (badge "Semua Nilai Sudah Terkirim" padahal mapel di bawahnya
  // masih berlabel "Belum terkirim"): versi sebelumnya SENGAJA mengecualikan
  // siswa essay_belum_dirilis dari hitungan siswaBaruBelumKirim (supaya
  // tidak dobel-label dengan alur "Periksa Jawaban Essay") — TAPI kalau
  // siswa itu satu-satunya alasan sebuah mapel belum 100% terkirim
  // (dikirimRows.length > 0 tapi < grupRows.length), mapel tsb tidak masuk
  // cabang `mapelBelumKirim` (karena sudah ada yang terkirim) MAUPUN cabang
  // `siswaBaruBelumKirim` (karena satu-satunya siswa tersisa dikecualikan) —
  // mapel itu jadi tidak tercatat sama sekali di ringkasan ini, sehingga
  // `bagian` tetap kosong dan badge salah menampilkan "Semua Nilai Sudah
  // Terkirim" walau `statusKirimKelompok` di KirimNilaiTab (yang tidak
  // punya celah ini) tetap benar menampilkan "Belum terkirim" untuk mapel
  // yang sama. FIX: hitung eksplisit siswa yang tertunda essay ini sebagai
  // kategori sendiri (`siswaMenungguEssay`), supaya mapelnya tetap muncul
  // di ringkasan atas dengan label yang jujur, tanpa dobel-label sebagai
  // "siswa baru".
  const fetchRingkasanKirim = useCallback(() => {
    interface RowRingkas {
      mapel_id: string
      kelas: string
      timestamp: string
      dikirim_ke_wali: boolean
      dikirim_at: string | null
      essay_belum_dirilis?: boolean
      belum_ujian?: boolean
    }
    apiRequest<{ data: RowRingkas[] }>('/api/guru/kirim-nilai')
      .then(res => {
        const rows = (res.data ?? []).filter(r => !r.belum_ujian)
        const map: Record<string, RowRingkas[]> = {}
        for (const r of rows) {
          const kunci = `${r.mapel_id}__${r.kelas}`
          if (!map[kunci]) map[kunci] = []
          map[kunci].push(r)
        }
        let mapelBelumKirim = 0
        let siswaBaruBelumKirim = 0
        let siswaMenungguEssay = 0
        for (const grupRows of Object.values(map)) {
          const dikirimRows = grupRows.filter(r => r.dikirim_ke_wali)
          if (dikirimRows.length === 0) {
            mapelBelumKirim++
            continue
          }
          if (dikirimRows.length === grupRows.length) continue // sudah terkirim semua
          const waktuKirimTerakhir = dikirimRows
            .map(r => r.dikirim_at)
            .filter((t): t is string => !!t)
            .sort()
            .pop()
          const belumKirimRows = grupRows.filter(r => !r.dikirim_ke_wali)
          for (const r of belumKirimRows) {
            if (r.essay_belum_dirilis) {
              siswaMenungguEssay++
            } else if (r.timestamp && (!waktuKirimTerakhir || r.timestamp > waktuKirimTerakhir)) {
              siswaBaruBelumKirim++
            }
          }
        }
        setRingkasanKirim({ mapelBelumKirim, siswaBaruBelumKirim, siswaMenungguEssay, adaData: Object.keys(map).length > 0 })
      })
      .catch(() => setRingkasanKirim(null))
  }, [])

  useEffect(() => { fetchRingkasanKirim() }, [fetchRingkasanKirim])

  // Dipanggil oleh ketiga tab setelah aksi yang mengubah nilai/status siswa
  // berhasil disimpan (simpan remedial, nilai/rilis essay, kirim ke wali
  // kelas) — lihat komentar panjang di atas `fetchAdaEssay`.
  const refreshRingkasan = useCallback(() => {
    fetchRingkasanRekap()
    fetchRingkasanKirim()
    fetchAdaEssay()
  }, [fetchRingkasanRekap, fetchRingkasanKirim, fetchAdaEssay])

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

  // Pesan ringkas di bawah label tab "Rekap Nilai" & "Kirim Nilai ke Wali
  // Kelas" — merah kalau ada yang perlu ditindaklanjuti, hijau kalau semua
  // sudah aman, atau null kalau datanya belum ada sama sekali (belum ada
  // nilai untuk diringkas).
  function pesanTab(key: TabKey): { label: string; warna: 'merah' | 'hijau' } | null {
    if (key === 'rekap') {
      if (!ringkasanRekap || !ringkasanRekap.adaData) return null
      if (ringkasanRekap.diBawahKkm > 0) {
        return { label: `${ringkasanRekap.diBawahKkm} Siswa di Bawah KKM`, warna: 'merah' }
      }
      return { label: 'Semua Nilai Aman', warna: 'hijau' }
    }
    if (key === 'kirim') {
      if (!ringkasanKirim || !ringkasanKirim.adaData) return null
      const bagian: string[] = []
      if (ringkasanKirim.mapelBelumKirim > 0) bagian.push(`${ringkasanKirim.mapelBelumKirim} Mapel Belum Dikirim`)
      if (ringkasanKirim.siswaBaruBelumKirim > 0) bagian.push(`${ringkasanKirim.siswaBaruBelumKirim} Siswa Belum Dikirim`)
      // BUG FIX (lihat komentar di useEffect ringkasanKirim di atas): kategori
      // ini WAJIB ikut ditampilkan, bukan cuma dihitung diam-diam — kalau
      // tidak, mapel yang sisa masalahnya cuma "menunggu rilis essay" akan
      // hilang dari ringkasan dan badge salah bilang "Semua Nilai Sudah
      // Terkirim" walau nilainya belum benar-benar sampai ke wali kelas.
      if (ringkasanKirim.siswaMenungguEssay > 0) bagian.push(`${ringkasanKirim.siswaMenungguEssay} Siswa Menunggu Rilis Essay`)
      if (bagian.length > 0) return { label: bagian.join(' & '), warna: 'merah' }
      return { label: 'Semua Nilai Sudah Terkirim', warna: 'hijau' }
    }
    return null
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
                {(() => {
                  const pesan = pesanTab(tab.key)
                  if (!pesan) return null
                  const Icon2 = pesan.warna === 'merah' ? AlertTriangle : CheckCircle2
                  return (
                    <span className={cn(
                      'mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                      pesan.warna === 'merah' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                    )}>
                      <Icon2 className="w-2.5 h-2.5 flex-shrink-0" />
                      {pesan.label}
                    </span>
                  )
                })()}
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
            onDataChanged={refreshRingkasan}
          />
        ) : activeKey === 'rekap' ? (
          <RekapNilaiTab onDataChanged={refreshRingkasan} />
        ) : (
          <KirimNilaiTab focusTarget={focusTarget} onDataChanged={refreshRingkasan} />
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
