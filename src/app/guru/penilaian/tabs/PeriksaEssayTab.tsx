'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import {
  CheckSquare, Calendar, Users, ChevronRight, ChevronDown, FileText, Image as ImageIcon,
  CheckCircle2, XCircle, Save, Send, AlertTriangle, Clock, HelpCircle,
} from 'lucide-react'
import { Confirm, EmptyState, Spinner, Toast, Badge, Modal } from '@/components/ui'
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
  // FIX (kunci nilai essay setelah kirim ke wali kelas): kalau true, nilai
  // siswa ini sudah dikirim ke wali kelas — form skor & tombol Simpan/Tidak
  // Mengerjakan harus dikunci (guard yang sama juga ada di backend, lihat
  // PUT /api/guru/koreksi-essay).
  dikirimKeWali: boolean
  // FIX (penilaian berbasis rubrik): skor yang sudah tersimpan per soal
  // essay, dipakai untuk mengisi ulang form saat halaman dibuka kembali.
  skorPerSoal?: Record<string, number>
}

interface KoreksiData {
  soalEssay: SoalEssayRingkas[]
  totalBobotMaks: number
  peserta: Peserta[]
  modeJawaban: 'DIGITAL' | 'KERTAS'
  bobotPg: number
  bobotEssay: number
  totalTargetSiswa: number
  // FITUR BARU (tampilkan siswa yang belum ujian): siswa di kelas/sesi ini
  // yang sama sekali belum masuk daftar `peserta` di atas (belum submit
  // essay/PG sama sekali, atau masih mengerjakan/belum mulai) — cuma
  // nis+nama, ditampilkan sebagai baris ringkas terpisah di bagian bawah
  // tabel dengan pesan "belum ujian".
  siswaBelumUjian: { nis: string; nama: string }[]
  // FITUR BARU (kunci bobot PG:Essay setelah kirim ke wali kelas): true kalau
  // ada minimal 1 nilai siswa di sesi ini yang sudah dikirim ke wali kelas —
  // tombol "Edit" bobot harus dikunci selama ini true (lihat guard yang sama
  // di backend, PATCH /api/guru/koreksi-essay).
  bobotTerkunci: boolean
}

// Komponen ini adalah isi tab "Periksa Jawaban Essay" di menu Penilaian
// (/guru/penilaian). Sebelumnya halaman sendiri (/guru/koreksi-essay) —
// logikanya TIDAK diubah, cuma dipindah supaya jadi salah satu tab.
// `onLanjutKirimNilai` dipanggil setelah guru merilis semua nilai essay
// satu sesi, supaya dia bisa langsung lompat ke tab "Kirim Nilai" dengan
// mapel+kelas yang sama sudah otomatis terbuka — tanpa harus mencari-cari lagi.
export function PeriksaEssayTab({
  onLanjutKirimNilai,
  onDataChanged,
}: {
  onLanjutKirimNilai?: (target: { mapelId: string; kelas: string; namaMapel: string; namaKelas: string }) => void
  onDataChanged?: () => void
}) {
  const [jadwalList, setJadwalList] = useState<JadwalKoreksi[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSesiId, setSelectedSesiId] = useState<string | null>(null)
  const [selectedJadwal, setSelectedJadwal] = useState<JadwalKoreksi | null>(null)
  const [data, setData] = useState<KoreksiData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // FIX (penilaian berbasis rubrik): input skor sekarang PER SOAL, bukan
  // satu angka gabungan — struktur: nis → soal_essay_id → string skor.
  const [skorInput, setSkorInput] = useState<Record<string, Record<string, string>>>({})
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

  // UX (sederhanakan tampilan koreksi essay): penjelasan cara menilai,
  // rumus bobot, dan catatan-catatan lain dulu selalu tampil sebagai kotak
  // teks panjang di atas tabel siswa — bikin guru harus scroll lewat teks
  // dulu sebelum sampai ke tabel input nilai (tujuan utama tab ini). Semua
  // penjelasan itu sekarang dikumpulkan di modal "Petunjuk", dibuka lewat
  // satu tombol kecil, supaya area utama fokus ke ringkasan status + tabel.
  const [showPetunjuk, setShowPetunjuk] = useState(false)

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
      // FIX (penilaian berbasis rubrik): isi ulang input skor PER SOAL dari
      // data tersimpan (skorPerSoal), bukan lagi satu angka nilaiEssay.
      const initSkor: Record<string, Record<string, string>> = {}
      for (const p of res.peserta) {
        initSkor[p.nis] = {}
        for (const soal of res.soalEssay) {
          const skorTersimpan = p.skorPerSoal?.[soal.id]
          if (skorTersimpan !== undefined) initSkor[p.nis][soal.id] = String(skorTersimpan)
        }
      }
      setSkorInput(initSkor)
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
    if (!selectedSesiId || !data) return
    // FIX (penilaian berbasis rubrik): validasi semua soal terisi DI SINI
    // dulu (sebelum request dikirim) supaya guru langsung tahu soal mana
    // yang masih kosong, bukan menunggu pesan error dari server.
    const skorSiswa = skorInput[nis] ?? {}
    const soalKosong = data.soalEssay.find(s => {
      const v = skorSiswa[s.id]
      return v === undefined || v.trim() === ''
    })
    if (soalKosong) {
      showToast(`Isi dulu skor untuk semua soal essay (Soal "${soalKosong.teks.slice(0, 30)}..." masih kosong)`, 'error')
      return
    }
    const skorPerSoal: Record<string, number> = {}
    for (const soal of data.soalEssay) {
      skorPerSoal[soal.id] = Number(skorSiswa[soal.id])
    }
    setSavingNis(nis)
    try {
      await apiRequest('/api/guru/koreksi-essay', {
        method: 'PUT',
        body: JSON.stringify({ sesiId: selectedSesiId, nis, skorPerSoal }),
      })
      showToast(`Nilai essay ${nis} berhasil disimpan`)
      if (selectedJadwal) await selectSesi(selectedJadwal)
      onDataChanged?.()
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
      onDataChanged?.()
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
      onDataChanged?.()
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
      onDataChanged?.()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal merilis nilai', 'error')
    } finally {
      setRilisingSemua(false)
    }
  }

  function bukaEditBobot() {
    if (!data) return
    // FIX (kunci bobot setelah kirim ke wali kelas): jaga-jaga kalau tombol
    // ini sempat terpanggil lewat jalur lain — tombol UI sendiri sudah
    // disembunyikan saat data.bobotTerkunci true (lihat render di bawah).
    if (data.bobotTerkunci) {
      showToast('Bobot tidak bisa diubah karena sudah ada nilai siswa yang dikirim ke wali kelas.', 'error')
      return
    }
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
      const res = await apiRequest<{ jumlahNilaiDiperbarui: number; jumlahRilisDitarik: number }>('/api/guru/koreksi-essay', {
        method: 'PATCH',
        body: JSON.stringify({ sesiId: selectedSesiId, bobotPg: pg, bobotEssay: essay }),
      })
      // FIX (bobot diubah setelah rilis tidak menarik status rilis): kalau
      // ada nilai yang sudah dirilis ikut ditarik ulang karena angkanya
      // berubah akibat bobot baru, beri tahu guru secara eksplisit di toast
      // supaya tidak lupa menekan Rilis lagi.
      showToast(
        res.jumlahRilisDitarik > 0
          ? `Bobot nilai berhasil diperbarui (${res.jumlahNilaiDiperbarui} nilai siswa dihitung ulang, ${res.jumlahRilisDitarik} di antaranya sudah dirilis dan ditarik kembali — silakan Rilis ulang)`
          : `Bobot nilai berhasil diperbarui (${res.jumlahNilaiDiperbarui} nilai siswa dihitung ulang)`
      )
      setEditBobotStep(null)
      await loadKoreksiData(selectedSesiId)
      onDataChanged?.()
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
  // UX (peringatan belum dinilai di header mapel): siswa yang sudah kirim
  // jawaban essay tapi belum diberi skor oleh guru (status "Belum Dinilai"
  // pada statusBadge) — ditampilkan sebagai peringatan mencolok di sebelah
  // nama mapel supaya guru langsung sadar masih ada yang perlu dikoreksi.
  const jumlahBelumDinilai = data
    ? data.peserta.filter(p => p.statusEssay === 'SUDAH_KIRIM' && !p.dirilis && !p.sudahDinilai).length
    : 0

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
    // FIX (kunci nilai essay setelah kirim ke wali kelas): status ini
    // sengaja diprioritaskan di atas "Dirilis" — begitu nilai terkirim ke
    // wali kelas, itu yang paling penting diketahui guru (nilai sudah
    // terkunci), bukan sekadar status rilis ke siswa.
    if (p.dikirimKeWali) return { variant: 'slate', label: 'Terkirim ke Wali · Terkunci' }
    if (p.dirilis) return { variant: 'purple', label: 'Dirilis' }
    if (p.sudahDinilai) return { variant: 'green', label: 'Sudah Dinilai' }
    return { variant: 'slate', label: 'Belum Dinilai' }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

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
            ) : !data || (data.peserta.length === 0 && data.siswaBelumUjian.length === 0) ? (
              <div className="card">
                <EmptyState icon={Clock} title="Belum ada yang selesai" description="Belum ada siswa yang mengirim essay pada sesi ini." />
              </div>
            ) : (
              <>
                <div className="card space-y-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h2 className="font-bold text-slate-900 text-lg flex items-center gap-2 flex-wrap">
                        {selectedJadwal?.nama_mapel}
                        {jumlahBelumDinilai > 0 && (
                          <span className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-md">
                            - {jumlahBelumDinilai} Siswa Belum Dinilai
                          </span>
                        )}
                      </h2>
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

                  {/* UX (declutter): ringkasan bobot + tombol "Petunjuk" saja
                      yang selalu tampil. Cara menilai, rumus lengkap, dan
                      catatan-catatan lain dipindah ke modal — lihat state
                      showPetunjuk. Ini menjaga area di atas tabel siswa tetap
                      pendek supaya guru cepat sampai ke input nilai. */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                    <p className="text-xs text-slate-500">
                      Bobot Nilai Akhir: <strong className="text-slate-700">PG {data.bobotPg}%</strong> + <strong className="text-slate-700">Essay {data.bobotEssay}%</strong>
                      {' '}
                      {/* FITUR BARU (kunci bobot setelah kirim ke wali kelas):
                          begitu ada nilai siswa di sesi ini yang sudah
                          terkirim ke wali kelas, tautan "Edit" diganti pesan
                          terkunci — guru tidak bisa lagi membuka modal ubah
                          bobot sama sekali (guard yang sama juga ditegakkan
                          di backend, lihat PATCH /api/guru/koreksi-essay). */}
                      {data.bobotTerkunci ? (
                        <span className="text-slate-400 italic">(terkunci — sudah ada nilai terkirim ke wali kelas)</span>
                      ) : (
                        <button
                          onClick={bukaEditBobot}
                          className="text-brand-700 font-medium underline underline-offset-2 hover:text-brand-800"
                        >
                          Edit
                        </button>
                      )}
                    </p>
                    <button
                      onClick={() => setShowPetunjuk(true)}
                      className="btn-ghost btn-sm text-brand-600"
                    >
                      <HelpCircle className="w-3.5 h-3.5" /> Petunjuk
                    </button>
                  </div>
                  {data.bobotTerkunci && (
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                      Bobot tidak bisa diubah karena sudah ada nilai siswa yang dikirim ke wali kelas. Minta wali kelas mengembalikan nilainya dulu jika bobot perlu direvisi.
                    </p>
                  )}

                  {!semuaSudahDinilai && (
                    <p className="text-xs text-amber-600 flex items-center gap-1 pt-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Rilis sekaligus hanya bisa dilakukan setelah semua siswa dinilai.
                    </p>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={!semuaSudahDinilai || semuaSudahDirilis || rilisingSemua}
                      onClick={() => setConfirmRilisSemua(true)}
                    >
                      {rilisingSemua ? <Spinner size="sm" /> : <><Send className="w-4 h-4" /> {semuaSudahDirilis ? 'Semua Sudah Dirilis' : 'Rilis Nilai ke Semua Siswa'}</>}
                    </button>
                  </div>

                  {/* Jembatan antar-tab (bagian dari konsolidasi menu
                      Penilaian): begitu semua nilai essay sesi ini sudah
                      dirilis, tawarkan lompat langsung ke tab "Kirim Nilai"
                      dengan mapel+kelas yang sama sudah otomatis terbuka —
                      guru tidak perlu mencari-cari grupnya lagi di tab itu. */}
                  {semuaSudahDirilis && selectedJadwal && onLanjutKirimNilai && (
                    <div className="flex items-center justify-between gap-3 flex-wrap bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mt-1">
                      <p className="text-xs text-indigo-800">
                        Semua nilai essay sesi ini sudah dirilis ke siswa. Lanjut kirim nilai akhirnya ke wali kelas?
                      </p>
                      <button
                        className="btn-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 rounded-lg px-3 py-1.5 shrink-0"
                        onClick={() => onLanjutKirimNilai({
                          mapelId: selectedJadwal.mapel_id,
                          kelas: selectedJadwal.kelas,
                          namaMapel: selectedJadwal.nama_mapel,
                          namaKelas: selectedJadwal.nama_kelas,
                        })}
                      >
                        Lanjut ke Kirim Nilai <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
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
                        const terbuka = expandedNis === p.nis
                        const sb = statusBadge(p)
                        const akhirLulus = p.nilaiTotal !== null && p.nilaiPg ? p.nilaiTotal >= p.nilaiPg.kkm : null
                        return (
                          <Fragment key={p.nis}>
                            <tr
                              className="cursor-pointer select-none"
                              onClick={() => setExpandedNis(terbuka ? null : p.nis)}
                            >
                              <td>
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

                                    {/* UX (gabung Jawaban Siswa + Beri Skor per Soal): dulu ada dua
                                        kartu terpisah — daftar jawaban, lalu di bawahnya daftar input
                                        skor per soal yang sama persis urutannya. Guru sering salah
                                        klik ke halaman lain karena harus scroll panjang bolak-balik
                                        untuk mencocokkan jawaban dengan kolom skornya. Sekarang untuk
                                        mode DIGITAL, kolom skor kecil ditaruh langsung di tiap kartu
                                        jawaban (mode KERTAS tetap terpisah karena tidak ada jawaban
                                        teks untuk digabung skornya). */}
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
                                          const skorSoalStr = skorInput[p.nis]?.[soal.id] ?? ''
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
                                                <p className="text-xs text-slate-400">Soal {i + 1} · Bobot maks: {soal.bobot_maks}</p>
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
                                              <p className="text-slate-600 whitespace-pre-wrap mb-2">{jawaban?.jawaban_teks?.trim() || <span className="italic text-slate-400">Tidak dijawab</span>}</p>
                                              {p.statusEssay !== 'TIDAK_MENGERJAKAN' && (
                                                <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-slate-100">
                                                  <span className="text-xs text-slate-500">Skor <span className="text-slate-400">(maks {soal.bobot_maks})</span></span>
                                                  <input
                                                    type="number"
                                                    className="input w-20 h-8 text-center flex-shrink-0 text-sm"
                                                    min={0}
                                                    max={soal.bobot_maks}
                                                    placeholder={`0–${soal.bobot_maks}`}
                                                    value={skorSoalStr}
                                                    disabled={p.dikirimKeWali}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => setSkorInput(prev => ({
                                                      ...prev,
                                                      [p.nis]: { ...prev[p.nis], [soal.id]: e.target.value },
                                                    }))}
                                                  />
                                                </div>
                                              )}
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
                                          <p className="text-xs text-slate-400 flex items-center gap-1">
                                            <ImageIcon className="w-3.5 h-3.5" /> Mode Kertas — lembar jawaban dikumpulkan manual oleh pengawas ruang ujian, beri skor langsung dari kertas fisik siswa.
                                          </p>
                                        )}
                                      </div>
                                    )}
                                    </div>

                                    {/* Mode KERTAS: tidak ada jawaban teks untuk digabung skornya,
                                        jadi input skor tetap tampil sebagai kartu tersendiri. */}
                                    {data.modeJawaban !== 'DIGITAL' && p.statusEssay !== 'TIDAK_MENGERJAKAN' && (
                                      <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-3">
                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Beri Skor per Soal</p>
                                        <div className="space-y-2">
                                          {data.soalEssay.map((soal, i) => {
                                            const skorSoalStr = skorInput[p.nis]?.[soal.id] ?? ''
                                            return (
                                              <div key={soal.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2">
                                                <p className="text-sm text-slate-600 min-w-0 truncate" title={soal.teks}>
                                                  Soal {i + 1} <span className="text-slate-400">(maks {soal.bobot_maks})</span>
                                                </p>
                                                <input
                                                  type="number"
                                                  className="input w-24 text-center flex-shrink-0"
                                                  min={0}
                                                  max={soal.bobot_maks}
                                                  placeholder={`0–${soal.bobot_maks}`}
                                                  value={skorSoalStr}
                                                  disabled={p.dikirimKeWali}
                                                  onClick={e => e.stopPropagation()}
                                                  onChange={e => setSkorInput(prev => ({
                                                    ...prev,
                                                    [p.nis]: { ...prev[p.nis], [soal.id]: e.target.value },
                                                  }))}
                                                />
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    {/* FIX (penilaian berbasis rubrik): input nilai sekarang PER
                                        SOAL essay, sesuai bobot_maks masing-masing (rubrik yang
                                        dibuat guru sendiri di menu Buat Soal) — bukan lagi satu
                                        angka gabungan yang ditaksir sendiri. Total & konversi ke
                                        skala 0-100 dihitung & ditampilkan LANGSUNG di sini secara
                                        real-time, mengikuti rumus persis yang dipakai backend
                                        (lihat PUT di api/guru/koreksi-essay/route.ts), supaya guru
                                        selalu melihat hasil akhirnya SEBELUM menekan Simpan — tidak
                                        ada lagi konversi tersembunyi. Tombol Simpan tetap satu di
                                        paling bawah, di luar daftar jawaban, supaya tidak perlu
                                        scroll panjang lagi untuk menemukannya. */}
                                    {p.statusEssay !== 'TIDAK_MENGERJAKAN' && (
                                      <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-3">
                                        {/* FIX (kunci nilai essay setelah kirim ke wali kelas): sembunyikan
                                            tombol ubah nilai sama sekali dan tampilkan alasan yang jelas,
                                            supaya guru tidak mengira ini gagal simpan biasa. */}
                                        {p.dikirimKeWali ? (
                                          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2 flex items-center gap-1.5">
                                            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                                            Nilai sudah dikirim ke wali kelas — tidak bisa diubah lagi dari sini. Hubungi admin/wali kelas jika perlu koreksi.
                                          </p>
                                        ) : (
                                          <div className="flex items-center gap-2 flex-wrap pt-1">
                                            <button className="btn-secondary btn-sm" onClick={() => handleSimpanNilai(p.nis)} disabled={savingNis === p.nis}>
                                              {savingNis === p.nis ? <Spinner size="sm" /> : <><Save className="w-3.5 h-3.5" /> Simpan</>}
                                            </button>
                                            <button className="btn-ghost btn-sm text-red-600" onClick={() => setConfirmTakMengerjakan(p.nis)} disabled={savingNis === p.nis}>
                                              <XCircle className="w-3.5 h-3.5" /> Tidak Mengerjakan
                                            </button>
                                          </div>
                                        )}

                                        {(() => {
                                          const skorSiswa = skorInput[p.nis] ?? {}
                                          const semuaTerisi = data.soalEssay.length > 0 && data.soalEssay.every(s => {
                                            const v = skorSiswa[s.id]
                                            return v !== undefined && v.trim() !== '' && !isNaN(Number(v))
                                          })
                                          if (!semuaTerisi) {
                                            return (
                                              <p className="text-xs text-slate-400">
                                                Isi skor semua soal untuk melihat pratinjau nilai akhir.
                                              </p>
                                            )
                                          }
                                          const totalBobotMaksSoal = data.soalEssay.reduce((sum, s) => sum + Number(s.bobot_maks), 0)
                                          const totalSkorSiswa = data.soalEssay.reduce((sum, s) => sum + Number(skorSiswa[s.id]), 0)
                                          const essayFinal = totalBobotMaksSoal > 0 ? Math.round((totalSkorSiswa / totalBobotMaksSoal) * 100) : 0
                                          const nilaiPgSiswa = p.nilaiPg?.nilai ?? 0
                                          const perkiraanTotal = Math.round(nilaiPgSiswa * (data.bobotPg / 100) + essayFinal * (data.bobotEssay / 100))
                                          const kkmSiswa = p.nilaiPg?.kkm ?? 0
                                          const perkiraanLulus = perkiraanTotal >= kkmSiswa
                                          return (
                                            <div className="text-xs text-slate-500 bg-slate-50 rounded-md px-2.5 py-1.5 border border-slate-100 space-y-1">
                                              <p>
                                                Total skor essay = {totalSkorSiswa}/{totalBobotMaksSoal}
                                                {' '}→ dikonversi ke skala 100 = <strong className="text-brand-700">{essayFinal}</strong>
                                              </p>
                                              <p>
                                                Nilai Akhir = (PG {nilaiPgSiswa}×{data.bobotPg}%) + (Essay {essayFinal}×{data.bobotEssay}%)
                                                {' '}= <strong className="text-brand-700">{perkiraanTotal}</strong>
                                                {' '}· KKM {kkmSiswa} ·{' '}
                                                <strong className={perkiraanLulus ? 'text-emerald-600' : 'text-red-600'}>
                                                  {perkiraanLulus ? 'Lulus' : 'Tidak Lulus'}
                                                </strong>
                                              </p>
                                            </div>
                                          )
                                        })()}
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
                      {/* FITUR BARU (tampilkan siswa yang belum ujian): baris
                          ringkas — cuma nama + pesan — untuk siswa di kelas
                          ini yang sama sekali belum masuk daftar peserta di
                          atas (belum submit ujian sama sekali). Sengaja
                          diletakkan SETELAH semua baris siswa yang sudah
                          ujian, dan tidak bisa diklik/expand seperti baris
                          lain karena memang tidak ada apa pun untuk dinilai. */}
                      {data.siswaBelumUjian.map(s => (
                        <tr key={s.nis} className="bg-red-50">
                          <td colSpan={6} className="text-red-700">
                            <span className="font-semibold">{s.nama}</span>
                            <span className="text-red-500"> — Belum Ujian atau Belum mengirim jawaban</span>
                          </td>
                        </tr>
                      ))}
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

      {/* Modal Petunjuk — kumpulan penjelasan yang sebelumnya selalu tampil
          di atas tabel siswa (cara menilai, rumus bobot, mode Digital vs
          Kertas, cara merilis nilai). Ditambah beberapa keterangan lain
          sesuai alur kode di tab ini supaya guru tidak perlu menebak-nebak,
          tanpa memenuhi tampilan utama. */}
      <Modal
        open={showPetunjuk}
        onClose={() => setShowPetunjuk(false)}
        title="Petunjuk Penilaian Essay"
        size="sm"
        footer={
          <button onClick={() => setShowPetunjuk(false)} className="btn-primary">
            Mengerti
          </button>
        }
      >
        <div className="space-y-4 text-sm text-slate-600">
          <div>
            <p className="font-semibold text-slate-800 mb-1">Cara memberi skor</p>
            <p>
              Beri skor tiap soal essay sesuai bobot maksimalnya (rubrik yang dibuat
              di menu Buat Soal). Sistem menjumlahkan &amp; mengonversi otomatis skor
              itu ke skala 0–100 — nilai konversinya langsung terlihat sebagai
              pratinjau begitu semua soal siswa terisi, sebelum kamu menekan Simpan.
            </p>
          </div>

          <div>
            <p className="font-semibold text-slate-800 mb-1">Rumus Nilai Akhir</p>
            <p>
              Bobot ditentukan di awal pembuatan soal{data ? <>: <strong>PG {data.bobotPg}%</strong> + <strong>Essay {data.bobotEssay}%</strong></> : null}.
              {' '}Nilai Akhir = (PG × {data?.bobotPg ?? 'x'}%) + (Essay × {data?.bobotEssay ?? 'y'}%).
              Bobot ini bisa diubah lewat tombol "Edit" di sebelah keterangan bobot —
              perubahannya langsung berlaku ke nilai akhir siswa yang sudah maupun
              belum dinilai essay-nya.
            </p>
          </div>

          <div>
            <p className="font-semibold text-slate-800 mb-1">Mode Digital vs Kertas</p>
            <p>
              Mode <strong>Digital</strong>: jawaban siswa tampil sebagai teks, kolom
              skor ada langsung di tiap kartu jawaban. Mode <strong>Kertas</strong>:
              lembar jawaban dikumpulkan manual oleh pengawas ruang ujian dan
              diserahkan ke kamu — beri skor langsung dari kertas fisiknya, tidak ada
              foto/unggahan yang perlu dicek di sistem.
            </p>
          </div>

          <div>
            <p className="font-semibold text-slate-800 mb-1">Siswa tidak mengerjakan</p>
            <p>
              Kalau ada siswa yang tidak menjawab essay-nya, gunakan tombol "Tidak
              Mengerjakan" pada baris siswa itu — nilai essay-nya otomatis diberi 0.
            </p>
          </div>

          <div>
            <p className="font-semibold text-slate-800 mb-1">Merilis nilai</p>
            <p>
              Nilai bisa dirilis satu per satu ("Rilis ke Siswa Ini") begitu skor
              seorang siswa disimpan, atau sekaligus untuk semua peserta lewat tombol
              "Rilis Nilai ke Semua Siswa" — tombol ini aktif setelah seluruh siswa
              dinilai. Nilai yang sudah dirilis langsung bisa dilihat siswa, dan
              aksi ini tidak bisa dibatalkan.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Catatan: tombol rilis sekaligus ini sama persis dengan "Rilis Nilai
              Essay" di tab Kirim Nilai — cukup lakukan dari salah satu, tidak perlu
              keduanya.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
