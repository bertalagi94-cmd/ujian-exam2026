'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import {
  CheckSquare, Calendar, Users, ChevronRight, ChevronDown, FileText, Image as ImageIcon,
  CheckCircle2, XCircle, Save, Send, AlertTriangle, Clock,
} from 'lucide-react'
import { Confirm, EmptyState, Spinner, Toast, Badge, Modal } from '@/components/ui'
import { EssayFlowGuide } from '@/components/shared/EssayFlowGuide'
import { apiRequest, formatDate, formatDateTime } from '@/lib/utils'

// ── Tipe ──────────────────────────────────────────────────────────
interface JadwalKoreksi {
  id: string
  tanggal: string
  mapel_id: string
  kelas: string
  nama_mapel: string
  nama_kelas: string
  // FIX (migrasi paket_essay): `jadwal.essay_aktif` sudah TIDAK dipakai lagi
  // sejak essay ditentukan otomatis dari paket_essay yang DISETUJUI untuk
  // mapel+kelas (lihat resolveEssayInfoJson di src/lib/gabungKirim.ts).
  // Status essay aktif-atau-tidak untuk sesi yang SUDAH dibuka disimpan di
  // sesi_ujian.info_json.essay_aktif, BUKAN lagi di kolom jadwal ini.
  sesi_ujian: { id: string; status: string; info_json?: { essay_aktif?: boolean } | null } | null
}

interface SoalEssayRingkas { id: string; teks: string; bobot_maks: number; urutan: number }

interface JawabanTeks { soal_essay_id: string; jawaban_teks: string }

interface Peserta {
  nis: string
  nama: string
  // FIX (siswa hilang dari antrean koreksi essay setelah sesi ditutup paksa):
  // sebelumnya field ini SELALU 'SUDAH_KIRIM' atau 'TIDAK_MENGERJAKAN' karena
  // itulah satu-satunya nilai yang diizinkan backend. Sekarang backend juga
  // menyertakan siswa yang sesinya ditutup paksa sebelum essay selesai —
  // status_essay mereka bisa null/'BELUM_MULAI'/'MENGERJAKAN'.
  statusEssay: string | null
  waktuKirimEssay: string | null
  jawabanTeks?: JawabanTeks[]
  fotoUrl?: string | null
  nilaiPg: { benar: number; total: number; kkm: number; nilai: number } | null
  nilaiEssay: number | null
  nilaiTotal: number | null
  sudahDinilai: boolean
  dirilis: boolean
}

interface KoreksiData {
  soalEssay: SoalEssayRingkas[]
  totalBobotMaks: number
  peserta: Peserta[]
  modeJawaban: 'DIGITAL' | 'KERTAS'
  bobotPg: number
  bobotEssay: number
  totalTargetSiswa: number
}

export default function GuruKoreksiEssayPage() {
  const [jadwalList, setJadwalList] = useState<JadwalKoreksi[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSesiId, setSelectedSesiId] = useState<string | null>(null)
  const [selectedJadwal, setSelectedJadwal] = useState<JadwalKoreksi | null>(null)
  const [data, setData] = useState<KoreksiData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const [nilaiInput, setNilaiInput] = useState<Record<string, string>>({})
  // UX (tabel koreksi essay): baris siswa dibuat ringkas & bisa di-expand —
  // sebelumnya semua jawaban+form nilai semua siswa selalu tampil sekaligus,
  // jadi terlalu penuh untuk sekadar melihat 1 mapel. Sekarang detail (jawaban
  // per soal, input nilai) hanya muncul untuk baris yang diklik/dibuka.
  const [expandedNis, setExpandedNis] = useState<string | null>(null)
  const [savingNis, setSavingNis] = useState<string | null>(null)
  const [confirmTakMengerjakan, setConfirmTakMengerjakan] = useState<string | null>(null)
  const [confirmRilisSemua, setConfirmRilisSemua] = useState(false)
  const [rilisingSemua, setRilisingSemua] = useState(false)
  const [rilisingNis, setRilisingNis] = useState<string | null>(null)

  // Modal edit bobot PG:Essay — dua tahap: peringatan dulu (bobot baru
  // berpengaruh ke nilai siswa yang sudah maupun belum dinilai essay-nya),
  // baru kalau guru lanjut, tampilkan form input persentasenya.
  const [editBobotStep, setEditBobotStep] = useState<'peringatan' | 'form' | null>(null)
  const [bobotPgInput, setBobotPgInput] = useState('')
  const [bobotEssayInput, setBobotEssayInput] = useState('')
  const [savingBobot, setSavingBobot] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  // ── Daftar jadwal essay yang sesinya sudah pernah dibuka ──────────
  // FIX BUG: sebelumnya memakai /api/guru/jadwal-pengawasan, yang hanya
  // berisi sesi di mana guru ini bertugas sebagai PENGAWAS RUANGAN. Guru
  // pengampu mapel yang tidak kebagian jaga (sesi diawasi guru lain) jadi
  // tidak pernah melihat sesi mapelnya sendiri di sini. Sekarang memakai
  // endpoint yang berbasis mapel yang diampu (mapel.guru_id), bukan pengawas.
  const loadJadwal = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: JadwalKoreksi[] }>('/api/guru/koreksi-essay/jadwal')
      const relevan = (res.data ?? []).filter(j => j.sesi_ujian?.info_json?.essay_aktif && j.sesi_ujian)
      setJadwalList(relevan)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat jadwal', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJadwal() }, [loadJadwal])

  async function loadKoreksiData(sesiId: string) {
    setLoadingData(true)
    setData(null)
    try {
      const res = await apiRequest<KoreksiData>(`/api/guru/koreksi-essay?sesiId=${sesiId}`)
      setData(res)
      const init: Record<string, string> = {}
      for (const p of res.peserta) {
        // UX (skala nilai essay 0-100 langsung): nilai yang tersimpan di
        // database memang sudah dalam skala 0-100, jadi tidak perlu
        // dikonversi balik ke skala lain lagi seperti sebelumnya.
        if (p.nilaiEssay !== null && p.nilaiEssay !== undefined) {
          init[p.nis] = String(p.nilaiEssay)
        }
      }
      setNilaiInput(init)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data koreksi', 'error')
    } finally {
      setLoadingData(false)
    }
  }

  async function selectSesi(j: JadwalKoreksi) {
    if (!j.sesi_ujian) return
    setSelectedSesiId(j.sesi_ujian.id)
    setSelectedJadwal(j)
    await loadKoreksiData(j.sesi_ujian.id)
  }

  async function handleSimpanNilai(nis: string) {
    if (!selectedSesiId) return
    const nilaiRaw = nilaiInput[nis]
    if (nilaiRaw === undefined || nilaiRaw === '') {
      showToast('Isi nilai essay terlebih dahulu', 'error')
      return
    }
    setSavingNis(nis)
    try {
      await apiRequest('/api/guru/koreksi-essay', {
        method: 'PUT',
        body: JSON.stringify({ sesiId: selectedSesiId, nis, nilaiEssay: Number(nilaiRaw) }),
      })
      showToast(`Nilai essay ${nis} berhasil disimpan`)
      if (selectedJadwal) await selectSesi(selectedJadwal)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan nilai', 'error')
    } finally {
      setSavingNis(null)
    }
  }

  async function handleTandaiTidakMengerjakan() {
    if (!selectedSesiId || !confirmTakMengerjakan) return
    const nis = confirmTakMengerjakan
    setSavingNis(nis)
    try {
      await apiRequest('/api/guru/koreksi-essay', {
        method: 'PUT',
        body: JSON.stringify({ sesiId: selectedSesiId, nis, tidakMengerjakan: true }),
      })
      showToast(`Siswa ${nis} ditandai tidak mengerjakan essay`)
      setConfirmTakMengerjakan(null)
      if (selectedJadwal) await selectSesi(selectedJadwal)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error')
    } finally {
      setSavingNis(null)
    }
  }

  async function handleRilisIndividu(nis: string) {
    if (!selectedSesiId) return
    setRilisingNis(nis)
    try {
      await apiRequest('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({ aksi: 'rilis_essay_individu', sesiId: selectedSesiId, nis }),
      })
      showToast(`Nilai untuk siswa ${nis} berhasil dirilis`)
      if (selectedJadwal) await selectSesi(selectedJadwal)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal merilis nilai', 'error')
    } finally {
      setRilisingNis(null)
    }
  }

  async function handleRilisSemua() {
    if (!selectedSesiId) return
    setRilisingSemua(true)
    try {
      const res = await apiRequest<{ message: string; jumlah: number }>('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({ aksi: 'rilis_essay_sekaligus', sesiId: selectedSesiId }),
      })
      showToast(res.message ?? 'Nilai berhasil dirilis ke semua siswa')
      setConfirmRilisSemua(false)
      if (selectedJadwal) await selectSesi(selectedJadwal)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal merilis nilai', 'error')
    } finally {
      setRilisingSemua(false)
    }
  }

  function bukaEditBobot() {
    if (!data) return
    setBobotPgInput(String(data.bobotPg))
    setBobotEssayInput(String(data.bobotEssay))
    setEditBobotStep('peringatan')
  }

  async function handleSimpanBobot() {
    if (!selectedSesiId) return
    const pg = Number(bobotPgInput)
    const essay = Number(bobotEssayInput)
    if (isNaN(pg) || isNaN(essay) || pg < 0 || pg > 100 || essay < 0 || essay > 100 || pg + essay !== 100) {
      showToast('Bobot PG + Essay harus berjumlah tepat 100', 'error')
      return
    }
    setSavingBobot(true)
    try {
      const res = await apiRequest<{ jumlahNilaiDiperbarui: number }>('/api/guru/koreksi-essay', {
        method: 'PATCH',
        body: JSON.stringify({ sesiId: selectedSesiId, bobotPg: pg, bobotEssay: essay }),
      })
      showToast(`Bobot nilai berhasil diperbarui (${res.jumlahNilaiDiperbarui} nilai siswa dihitung ulang)`)
      setEditBobotStep(null)
      await loadKoreksiData(selectedSesiId)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan bobot', 'error')
    } finally {
      setSavingBobot(false)
    }
  }

  const semuaSudahDinilai = !!data && data.peserta.length > 0 && data.peserta.every(p => p.sudahDinilai)
  const semuaSudahDirilis = !!data && data.peserta.length > 0 && data.peserta.every(p => p.dirilis)
  // Ringkasan jumlah siswa yang sudah/belum mengirim jawaban essay pada sesi terpilih.
  // FIX BUG (badge "Belum Menjawab" selalu 0): sebelumnya dihitung dari
  // `data.peserta.length - sudahMenjawab`, padahal `peserta` dari API hanya
  // berisi siswa yang statusnya sudah final (lihat catatan FIX di
  // route.ts) — siswa yang belum login/belum mulai sama sekali tidak pernah
  // masuk `peserta`, sehingga selisihnya selalu 0. Sekarang pakai
  // `totalTargetSiswa` (total siswa target sesi ini yang dihitung backend)
  // sebagai penyebut, bukan panjang array yang memang tidak lengkap.
  const jumlahSudahMenjawab = data ? data.peserta.filter(p => p.statusEssay === 'SUDAH_KIRIM').length : 0
  const jumlahBelumMenjawab = data ? Math.max(0, data.totalTargetSiswa - jumlahSudahMenjawab) : 0

  // UX (redesain tampilan koreksi essay): sebelumnya status siswa ditampilkan
  // sebagai 3-4 badge berjejer sekaligus (Tidak Mengerjakan + Belum
  // Dinilai/Dinilai + Dirilis), yang terasa penuh & memusingkan. Sekarang
  // satu siswa = satu badge, dipilih berdasarkan prioritas kondisi paling
  // relevan untuk guru di tahap koreksi ini.
  function statusBadge(p: Peserta): { variant: 'red' | 'yellow' | 'purple' | 'green' | 'slate'; label: string } {
    if (p.statusEssay === 'TIDAK_MENGERJAKAN') return { variant: 'red', label: 'Tidak Mengerjakan' }
    // FIX (siswa hilang dari antrean setelah sesi ditutup paksa): status
    // 'Belum Kirim' di sini sengaja mencakup SEMUA nilai selain SUDAH_KIRIM
    // (null/BELUM_MULAI/MENGERJAKAN) — termasuk peserta yang sesinya ditutup
    // paksa oleh pengawas/admin sebelum sempat menekan "Kirim" sendiri.
    if (p.statusEssay !== 'SUDAH_KIRIM') return { variant: 'yellow', label: 'Belum Kirim' }
    if (p.dirilis) return { variant: 'purple', label: 'Dirilis' }
    if (p.sudahDinilai) return { variant: 'green', label: 'Sudah Dinilai' }
    return { variant: 'slate', label: 'Belum Dinilai' }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Koreksi Essay</h1>
        <p className="page-subtitle">Lihat jawaban/foto siswa, beri nilai essay, dan rilis nilai akhir ke siswa</p>
      </div>

      <EssayFlowGuide current="koreksi" />

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : jadwalList.length === 0 ? (
        <div className="card">
          <EmptyState icon={CheckSquare} title="Belum ada sesi essay" description="Sesi ujian dengan essay yang sudah pernah dibuka akan muncul di sini." />
        </div>
      ) : !selectedSesiId ? (
        /* Daftar mata pelajaran — tampil langsung, klik untuk lihat hasil */
        <div className="space-y-3">
          <h2 className="font-bold text-slate-900 text-lg">Daftar Jawaban Essay</h2>
          <div className="space-y-2">
            {jadwalList.map(j => (
              <button
                key={j.id}
                onClick={() => { setExpandedNis(null); selectSesi(j) }}
                className="w-full text-left card p-3.5 transition-all hover:border-slate-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{j.nama_mapel}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" /> Kelas {j.nama_kelas}
                      <span className="text-slate-300">·</span>
                      <Calendar className="w-3 h-3" /> {formatDate(j.tanggal)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tombol kembali ke daftar mata pelajaran */}
          <button
            onClick={() => { setSelectedSesiId(null); setSelectedJadwal(null); setData(null); setExpandedNis(null) }}
            className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <ChevronRight className="w-4 h-4 rotate-180" /> Kembali ke Daftar Jawaban Essay
          </button>

          <div className="space-y-4">
            {loadingData ? (
              <div className="flex justify-center py-16"><Spinner size="lg" /></div>
            ) : !data || data.peserta.length === 0 ? (
              <div className="card">
                <EmptyState icon={Clock} title="Belum ada yang selesai" description="Belum ada siswa yang mengirim essay pada sesi ini." />
              </div>
            ) : (
              <>
                <div className="card space-y-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h2 className="font-bold text-slate-900 text-lg">{selectedJadwal?.nama_mapel}</h2>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3" /> Kelas {selectedJadwal?.nama_kelas}
                        <span className="text-slate-300">·</span>
                        <Calendar className="w-3 h-3" /> {selectedJadwal ? formatDate(selectedJadwal.tanggal) : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <FileText className="w-4 h-4 text-brand-600" />
                    <p className="text-sm text-slate-600">
                      {data.soalEssay.length} Soal Essay · Mode {data.modeJawaban === 'DIGITAL' ? 'Digital' : 'Kertas'}
                    </p>
                  </div>

                  {/* Ringkasan jumlah siswa yang sudah & belum menjawab essay */}
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <Badge variant="green">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {jumlahSudahMenjawab} Sudah Menjawab
                    </Badge>
                    <Badge variant="yellow">
                      <Clock className="w-3.5 h-3.5" /> {jumlahBelumMenjawab} Belum Menjawab
                    </Badge>
                  </div>

                  {/* UX (menghindari kebingungan skala nilai essay): jelaskan
                      di sini, sekali untuk seluruh sesi, bagaimana nilai
                      essay digabung dengan nilai PG jadi nilai akhir —
                      supaya guru tidak perlu menebak-nebak. */}
                  <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-xs text-slate-600 space-y-0.5">
                    <p>
                      Input Nilai siswa dari <strong>0–100</strong>.
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <p>
                        Bobot nilai yang di tentukan di awal pembuatan soal : <strong>PG {data.bobotPg}%</strong> + <strong>Essay {data.bobotEssay}%</strong> —
                        {' '}Nilai Akhir = (PG × {data.bobotPg}%) + (Essay × {data.bobotEssay}%).
                      </p>
                      <button
                        onClick={bukaEditBobot}
                        className="shrink-0 text-brand-700 font-medium underline underline-offset-2 hover:text-brand-800"
                      >
                        Edit Bobot
                      </button>
                    </div>
                  </div>

                  {!semuaSudahDinilai && (
                    <p className="text-xs text-amber-600 flex items-center gap-1 pt-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Rilis sekaligus hanya bisa dilakukan setelah semua siswa dinilai.
                    </p>
                  )}

                  {/* FIX (kejelasan duplikasi): tombol rilis yang sama juga ada
                      di menu "Kirim Nilai ke Wali Kelas" — sengaja disediakan
                      di dua tempat (praktis langsung setelah koreksi di sini,
                      atau sambil mengelola pengiriman nilai di sana), TAPI
                      keduanya memanggil aksi rilis yang sama persis. Guru tidak
                      perlu klik dua-duanya. */}
                  <p className="text-[11px] text-slate-400 pt-1">
                    Catatan: tombol ini sama dengan "Rilis Nilai Essay" di menu Kirim Nilai ke Wali Kelas — cukup lakukan dari salah satu.
                  </p>

                  <div className="flex justify-end pt-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={!semuaSudahDinilai || semuaSudahDirilis || rilisingSemua}
                      onClick={() => setConfirmRilisSemua(true)}
                    >
                      {rilisingSemua ? <Spinner size="sm" /> : <><Send className="w-4 h-4" /> {semuaSudahDirilis ? 'Semua Sudah Dirilis' : 'Rilis Nilai ke Semua Siswa'}</>}
                    </button>
                  </div>
                </div>

                {/* Daftar peserta — tabel ringkas, klik baris untuk buka detail.
                    UX (sebelumnya semua jawaban+form nilai SEMUA siswa langsung
                    tampil sekaligus dalam bentuk kartu panjang, sehingga terlalu
                    penuh hanya untuk 1 mapel). Sekarang tabel menampilkan ringkasan
                    per siswa; detail (jawaban per soal, input nilai, rilis individu)
                    hanya terbuka untuk baris yang diklik. */}
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Siswa</th>
                        <th>Nilai PG</th>
                        <th>Nilai Essay</th>
                        <th>Nilai Akhir</th>
                        <th>Status</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.peserta.map(p => {
                        const nilaiSaatIni = nilaiInput[p.nis] ?? ''
                        const terbuka = expandedNis === p.nis
                        const sb = statusBadge(p)
                        const akhirLulus = p.nilaiTotal !== null && p.nilaiPg ? p.nilaiTotal >= p.nilaiPg.kkm : null
                        return (
                          <Fragment key={p.nis}>
                            <tr
                              className="cursor-pointer select-none"
                              onClick={() => setExpandedNis(terbuka ? null : p.nis)}
                            >
                              <td className="bg-brand-100 border-l-8 border-brand-600">
                                <p className="font-semibold text-slate-900">{p.nama}</p>
                                <p className="text-xs text-slate-400">NIS {p.nis}</p>
                              </td>
                              <td>
                                {p.nilaiPg ? (
                                  <>
                                    <span className="font-bold text-slate-800">{p.nilaiPg.nilai}</span>
                                    <div className="text-[11px] text-slate-400">{p.nilaiPg.benar}/{p.nilaiPg.total} benar</div>
                                  </>
                                ) : <span className="text-slate-300">–</span>}
                              </td>
                              <td>
                                {p.nilaiEssay !== null
                                  ? <span className="font-bold text-slate-800">{p.nilaiEssay}</span>
                                  : <span className="text-xs text-slate-400 italic">Belum dinilai</span>}
                              </td>
                              <td>
                                {p.nilaiTotal !== null
                                  ? <span className={`font-bold ${akhirLulus ? 'text-emerald-600' : 'text-red-600'}`}>{p.nilaiTotal}</span>
                                  : <span className="text-slate-300">–</span>}
                              </td>
                              <td>
                                <Badge variant={sb.variant}>{sb.label}</Badge>
                              </td>
                              <td>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${terbuka ? 'rotate-180' : ''}`} />
                              </td>
                            </tr>

                            {terbuka && (
                              <tr>
                                <td colSpan={6} className="bg-slate-50/60 p-0 border-b border-slate-100">
                                  <div className="p-4 space-y-4">
                                    <p className="text-xs text-slate-400 -mt-1">
                                      Dikirim {p.waktuKirimEssay ? formatDateTime(p.waktuKirimEssay) : '-'}
                                    </p>

                                    {/* Jawaban */}
                                    <div className="space-y-2">
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Jawaban Siswa</p>
                                      {data.modeJawaban === 'DIGITAL' ? (
                                      <div className="space-y-2">
                                        {data.soalEssay.map((soal, i) => {
                                          const jawaban = p.jawabanTeks?.find(j => j.soal_essay_id === soal.id)
                                          // FIX (UX koreksi essay): tandai kotak jawaban dengan warna
                                          // supaya guru langsung lihat sekilas mana yang kosong tanpa
                                          // perlu baca teks satu-satu — merah = tidak dijawab (teks
                                          // kosong/hanya spasi), hijau = ada jawaban.
                                          const terjawab = !!jawaban?.jawaban_teks?.trim()
                                          return (
                                            <div
                                              key={soal.id}
                                              className={`rounded-lg p-3 text-sm border bg-white ${
                                                terjawab
                                                  ? 'border-emerald-200'
                                                  : 'border-red-200'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between gap-2 mb-1">
                                                <p className="text-xs text-slate-400">Soal {i + 1} · Bobot rubrik: {soal.bobot_maks} <span className="text-slate-300">(panduan, bukan skala nilai)</span></p>
                                                {terjawab ? (
                                                  <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3 h-3" /> Dijawab
                                                  </span>
                                                ) : (
                                                  <span className="text-[11px] font-medium text-red-700 flex items-center gap-1">
                                                    <XCircle className="w-3 h-3" /> Tidak dijawab
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-slate-700 font-medium mb-1.5">{soal.teks}</p>
                                              <p className="text-slate-600 whitespace-pre-wrap">{jawaban?.jawaban_teks?.trim() || <span className="italic text-slate-400">Tidak dijawab</span>}</p>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <div>
                                        {p.fotoUrl ? (
                                          <a href={p.fotoUrl} target="_blank" rel="noopener noreferrer">
                                            <img src={p.fotoUrl} alt={`Lembar jawaban ${p.nama}`} className="max-h-64 rounded-lg border border-slate-200" />
                                          </a>
                                        ) : (
                                          <p className="text-xs text-slate-400 flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> Belum ada foto diunggah</p>
                                        )}
                                      </div>
                                    )}
                                    </div>

                                    {/* Input nilai */}
                                    {p.statusEssay !== 'TIDAK_MENGERJAKAN' && (
                                      <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Beri Nilai Essay</p>
                                        <div className="flex items-end gap-2 flex-wrap">
                                          <div className="flex-1 min-w-[140px]">
                                            <label className="label">Nilai Essay (skala 0–100)</label>
                                            <input
                                              type="number" className="input" min={0} max={100}
                                              placeholder="0 – 100"
                                              value={nilaiSaatIni}
                                              onClick={e => e.stopPropagation()}
                                              onChange={e => setNilaiInput(prev => ({ ...prev, [p.nis]: e.target.value }))}
                                            />
                                          </div>
                                          <button className="btn-secondary btn-sm" onClick={() => handleSimpanNilai(p.nis)} disabled={savingNis === p.nis}>
                                            {savingNis === p.nis ? <Spinner size="sm" /> : <><Save className="w-3.5 h-3.5" /> Simpan</>}
                                          </button>
                                          <button className="btn-ghost btn-sm text-red-600" onClick={() => setConfirmTakMengerjakan(p.nis)} disabled={savingNis === p.nis}>
                                            <XCircle className="w-3.5 h-3.5" /> Tidak Mengerjakan
                                          </button>
                                        </div>

                                        {/* UX (menghindari kebingungan skala nilai essay): pratinjau
                                            nilai akhir dihitung LANGSUNG di client, mengikuti rumus
                                            persis yang dipakai backend (lihat PUT di
                                            api/guru/koreksi-essay/route.ts), supaya guru melihat hasil
                                            akhirnya SEBELUM menekan Simpan. Sejak skala essay jadi 0-100
                                            langsung, tidak ada lagi langkah "konversi poin → skala 100"
                                            di sini — nilai yang diketik guru = nilai essay itu sendiri. */}
                                        {nilaiSaatIni !== '' && !isNaN(Number(nilaiSaatIni)) && (
                                          (() => {
                                            const essayFinal = Math.max(0, Math.min(100, Number(nilaiSaatIni)))
                                            const nilaiPgSiswa = p.nilaiPg?.nilai ?? 0
                                            const perkiraanTotal = Math.round(nilaiPgSiswa * (data.bobotPg / 100) + essayFinal * (data.bobotEssay / 100))
                                            const kkmSiswa = p.nilaiPg?.kkm ?? 0
                                            const perkiraanLulus = perkiraanTotal >= kkmSiswa
                                            return (
                                              <p className="text-xs text-slate-500 bg-slate-50 rounded-md px-2.5 py-1.5 border border-slate-100">
                                                Nilai Akhir = (PG {nilaiPgSiswa}×{data.bobotPg}%) + (Essay {essayFinal}×{data.bobotEssay}%)
                                                {' '}= <strong className="text-brand-700">{perkiraanTotal}</strong>
                                                {' '}· KKM {kkmSiswa} ·{' '}
                                                <strong className={perkiraanLulus ? 'text-emerald-600' : 'text-red-600'}>
                                                  {perkiraanLulus ? 'Lulus' : 'Tidak Lulus'}
                                                </strong>
                                              </p>
                                            )
                                          })()
                                        )}
                                      </div>
                                    )}

                                    {/* UX (redesain ringkasan nilai): dulu satu baris teks padat
                                        "Tersimpan — Nilai Essay: X/100 · Nilai Total: Y" digabung
                                        tombol rilis di ujung kanan. Sekarang jadi kartu ringkasan 3
                                        kolom (PG / Essay / Akhir) + status lulus yang jelas, terpisah
                                        dari tombol aksi supaya lebih mudah dipindai mata. */}
                                    {p.nilaiTotal !== null && p.nilaiPg && (
                                      <div className="bg-white rounded-lg border border-slate-200 p-3">
                                        <div className="flex items-center justify-between flex-wrap gap-3">
                                          <div className="flex items-center gap-4">
                                            <div>
                                              <p className="text-[11px] text-slate-400">Nilai PG</p>
                                              <p className="font-bold text-slate-800">{p.nilaiPg.nilai}</p>
                                            </div>
                                            <div className="text-slate-200">+</div>
                                            <div>
                                              <p className="text-[11px] text-slate-400">Nilai Essay</p>
                                              <p className="font-bold text-slate-800">{p.nilaiEssay}</p>
                                            </div>
                                            <div className="text-slate-200">=</div>
                                            <div>
                                              <p className="text-[11px] text-slate-400">Nilai Akhir</p>
                                              <p className={`font-bold text-lg ${p.nilaiTotal >= p.nilaiPg.kkm ? 'text-emerald-600' : 'text-red-600'}`}>{p.nilaiTotal}</p>
                                            </div>
                                            <Badge variant={p.nilaiTotal >= p.nilaiPg.kkm ? 'green' : 'red'}>
                                              {p.nilaiTotal >= p.nilaiPg.kkm ? '✓ Lulus' : '✗ Tidak Lulus'}
                                            </Badge>
                                          </div>
                                          {!p.dirilis && (
                                            <button className="btn-ghost btn-sm text-brand-600" onClick={() => handleRilisIndividu(p.nis)} disabled={rilisingNis === p.nis}>
                                              {rilisingNis === p.nis ? <Spinner size="sm" /> : <><Send className="w-3.5 h-3.5" /> Rilis ke Siswa Ini</>}
                                            </button>
                                          )}
                                          {p.dirilis && (
                                            <span className="text-xs text-purple-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Sudah dirilis ke siswa</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Confirm
        open={!!confirmTakMengerjakan}
        onClose={() => setConfirmTakMengerjakan(null)}
        onConfirm={handleTandaiTidakMengerjakan}
        title="Tandai Tidak Mengerjakan"
        message="Siswa ini akan diberi nilai essay 0 dan ditandai tidak mengerjakan. Lanjutkan?"
        confirmLabel="Ya, Tandai"
        loading={!!savingNis}
      />

      <Confirm
        open={confirmRilisSemua}
        onClose={() => setConfirmRilisSemua(false)}
        onConfirm={handleRilisSemua}
        title="Rilis Nilai ke Semua Siswa"
        message="Nilai essay dan nilai total akan bisa dilihat oleh SEMUA siswa pada sesi ini. Tindakan ini tidak bisa dibatalkan. Lanjutkan?"
        confirmLabel="Ya, Rilis Semua"
        variant="primary"
        loading={rilisingSemua}
      />

      <Confirm
        open={editBobotStep === 'peringatan'}
        onClose={() => setEditBobotStep(null)}
        onConfirm={() => setEditBobotStep('form')}
        title="Ubah Bobot Nilai Akhir"
        message="Hasil pengeditan bobot nilai akan berpengaruh juga terhadap nilai siswa, baik yang sudah diberi nilai essay maupun yang belum. Nilai akhir siswa yang sudah dinilai akan langsung dihitung ulang memakai bobot yang baru. Lanjutkan?"
        confirmLabel="Ya, Lanjutkan"
        variant="danger"
      />

      <Modal
        open={editBobotStep === 'form'}
        onClose={() => setEditBobotStep(null)}
        title="Ubah Bobot Nilai Akhir"
        size="sm"
        footer={
          <>
            <button onClick={() => setEditBobotStep(null)} className="btn-ghost" disabled={savingBobot}>
              Batal
            </button>
            <button onClick={handleSimpanBobot} className="btn-primary" disabled={savingBobot}>
              {savingBobot ? 'Menyimpan...' : 'Simpan Bobot'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-amber-600 flex items-start gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Bobot baru ini berpengaruh terhadap nilai siswa, baik yang sudah diberi nilai essay maupun yang belum.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Bobot PG (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={bobotPgInput}
                onChange={e => {
                  const v = e.target.value
                  setBobotPgInput(v)
                  const n = Number(v)
                  if (!isNaN(n) && n >= 0 && n <= 100) setBobotEssayInput(String(100 - n))
                }}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Bobot Essay (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={bobotEssayInput}
                onChange={e => {
                  const v = e.target.value
                  setBobotEssayInput(v)
                  const n = Number(v)
                  if (!isNaN(n) && n >= 0 && n <= 100) setBobotPgInput(String(100 - n))
                }}
                className="input mt-1 w-full"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">Bobot PG + Essay harus berjumlah tepat 100%.</p>
        </div>
      </Modal>
    </div>
  )
}
