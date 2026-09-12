'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Send, Save, RotateCcw, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, BarChart3, MessageSquare,
  FileText, CheckCircle2,
} from 'lucide-react'
import { apiRequest, nilaiColor, formatDateTime } from '@/lib/utils'
import { PageLoader, Toast } from '@/components/ui'
import { EssayFlowGuide } from '@/components/shared/EssayFlowGuide'

interface NilaiRow {
  id: string
  nis: string
  nama_siswa: string
  kelas: string
  mapel_id: string
  nama_mapel: string
  nilai: number
  grade: string
  lulus: boolean
  kkm: number
  timestamp: string
  nilai_edit: number | null
  grade_edit: string | null
  lulus_edit: boolean | null
  dikirim_ke_wali: boolean
  dikirim_at: string | null
  dikembalikan: boolean
  catatan_guru: string | null
  // FIX (fitur essay): field tambahan dari nilai — dipakai untuk menampilkan
  // status nilai essay & tombol rilis di halaman ini (lihat GET di
  // /api/guru/kirim-nilai, kolom ditambahkan ke select).
  sesi_id?: string | null
  nilai_essay?: number | null
  nilai_total?: number | null
  dirilis?: boolean
  dirilis_pada?: string | null
  // true kalau sesi ini pakai essay TAPI guru belum merilis nilai essay
  // untuk siswa ini — dihitung server-side di GET /api/guru/kirim-nilai
  // (lihat `essay_belum_dirilis` di route.ts), bukan kolom asli tabel `nilai`.
  essay_belum_dirilis?: boolean
  // true kalau siswa ini belum sama sekali mengerjakan ujian mapel ini —
  // tidak ada nilai untuk diedit/dikirim, hanya ditampilkan sebagai info.
  belum_ujian?: boolean
}

interface MapelInfo { id: string; nama: string; kkm: number }

interface ApiData {
  data: NilaiRow[]
  mapelList: MapelInfo[]
}

// Kelompokkan per mapel+kelas
interface Kelompok {
  kunciMapel: string
  mapel_id: string
  nama_mapel: string
  kelas: string
  rows: NilaiRow[]
  belumUjian: NilaiRow[]
  sudahDikirim: number
  total: number
}

export default function KirimNilaiPage() {
  const [apiData, setApiData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  // Map id nilai → nilai edit sementara di form
  const [editMap, setEditMap] = useState<Record<string, string>>({})
  // Map id nilai → catatan sementara
  const [catatanMap, setCatatanMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  // FIX (fitur essay): rilis nilai essay/total ke siswa
  const [rilisNis, setRilisNis] = useState<string | null>(null)
  const [rilisSesi, setRilisSesi] = useState<string | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<ApiData>('/api/guru/kirim-nilai')
      setApiData(res)

      // Isi editMap dari data yang ada di DB
      const em: Record<string, string> = {}
      const cm: Record<string, string> = {}
      for (const n of res.data ?? []) {
        em[n.id] = n.nilai_edit != null ? String(n.nilai_edit) : ''
        cm[n.id] = n.catatan_guru ?? ''
      }
      setEditMap(em)
      setCatatanMap(cm)

      // Buka kelompok pertama yang butuh perhatian: masih ada yang belum
      // dikirim, ATAU ada siswa yang belum ujian sama sekali (kelompok
      // yang isinya cuma "belum ujian" tetap perlu terlihat, jangan
      // tersembunyi begitu saja).
      const kelompokList = buatKelompok(res.data ?? [])
      const belumDikirim = kelompokList.find(k => k.sudahDikirim < k.total || k.belumUjian.length > 0)
      if (belumDikirim) setExpandedGroup(belumDikirim.kunciMapel)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function buatKelompok(data: NilaiRow[]): Kelompok[] {
    const map: Record<string, Kelompok> = {}
    for (const n of data) {
      const kunci = `${n.mapel_id}__${n.kelas}`
      if (!map[kunci]) {
        map[kunci] = {
          kunciMapel: kunci,
          mapel_id: n.mapel_id,
          nama_mapel: n.nama_mapel,
          kelas: n.kelas,
          rows: [],
          belumUjian: [],
          sudahDikirim: 0,
          total: 0,
        }
      }
      if (n.belum_ujian) {
        map[kunci].belumUjian.push(n)
        continue
      }
      map[kunci].rows.push(n)
      map[kunci].total++
      if (n.dikirim_ke_wali) map[kunci].sudahDikirim++
    }
    // Urutkan: yang ada dikembalikan pertama, lalu yang belum dikirim, lalu yang sudah
    return Object.values(map).sort((a, b) => {
      const adaA = a.rows.some(r => r.dikembalikan) ? 0 : a.sudahDikirim === a.total ? 2 : 1
      const adaB = b.rows.some(r => r.dikembalikan) ? 0 : b.sudahDikirim === b.total ? 2 : 1
      return adaA - adaB || a.nama_mapel.localeCompare(b.nama_mapel)
    })
  }

  // FITUR BARU (status kirim per mapel): guru sebelumnya harus membuka &
  // menghitung sendiri baris mana yang belum terkirim untuk tahu apakah
  // sebuah mapel+kelas masih perlu ditindaklanjuti. Fungsi ini menyimpulkan
  // satu status ringkas yang ditampilkan langsung di sebelah nama mapel:
  //  - "Belum terkirim"                              → belum pernah dikirim sama sekali
  //  - "Sudah terkirim"                               → semua baris nilai sudah terkirim
  //  - "Ada nilai siswa baru masuk..."                → sudah pernah dikirim, TAPI ada
  //    siswa yang baru selesai ujian (timestamp-nya) SETELAH pengiriman terakhir —
  //    ini beda dari sekadar "belum semua terkirim", karena tertunda essay sudah
  //    punya indikatornya sendiri (lihat badge "menunggu essay").
  function statusKirimKelompok(grup: Kelompok): { label: string; className: string } | null {
    if (grup.total === 0) return null

    const dikirimRows = grup.rows.filter(r => r.dikirim_ke_wali)
    if (dikirimRows.length === 0) {
      return { label: 'Belum terkirim', className: 'bg-red-100 text-red-700 border border-red-200 font-semibold' }
    }
    if (grup.sudahDikirim === grup.total) {
      return { label: 'Sudah terkirim', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold' }
    }

    // Sudah pernah kirim, tapi belum semua — bedakan siswa yang memang baru
    // selesai ujian SETELAH pengiriman terakhir vs sekadar masih menunggu
    // rilis essay (kasus itu sudah tertangani badge lain, jangan dobel-labeli
    // sebagai "siswa baru").
    const waktuKirimTerakhir = dikirimRows
      .map(r => r.dikirim_at)
      .filter((t): t is string => !!t)
      .sort()
      .pop()

    const siswaBaru = grup.rows.filter(r =>
      !r.dikirim_ke_wali && !r.essay_belum_dirilis && r.timestamp &&
      (!waktuKirimTerakhir || r.timestamp > waktuKirimTerakhir)
    )

    if (siswaBaru.length > 0) {
      return {
        label: 'Ada nilai siswa baru masuk. Cek dan Kirim lagi ke wali kelas.',
        className: 'bg-red-100 text-red-700 border border-red-300 font-bold',
      }
    }

    return { label: 'Belum terkirim', className: 'bg-red-100 text-red-700 border border-red-200 font-semibold' }
  }

  async function simpanEdit(nilaiId: string) {
    setSaving(nilaiId)
    try {
      const nilaiEditStr = editMap[nilaiId] ?? ''
      const nilai_edit = nilaiEditStr.trim() === '' ? null : parseFloat(nilaiEditStr)
      await apiRequest('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({
          aksi: 'simpan_edit',
          id: nilaiId,
          nilai_edit,
          catatan_guru: catatanMap[nilaiId]?.trim() || null,
        }),
      })
      showToast('Nilai edit berhasil disimpan')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(null)
    }
  }

  // FIX (kelas campuran PG-only vs PG+Essay): backend sekarang bisa mengirim
  // SEBAGIAN saja (siswa yang siap) dan melewati siswa yang essay-nya belum
  // dirilis guru — lihat `tertunda` di response PATCH kirim_ke_wali. Toast di
  // sini SEBELUMNYA statis ("berhasil dikirim ✓") tanpa peduli isi response,
  // jadi guru tidak pernah tahu ada siswa yang di-skip. Sekarang dibaca dari
  // `res.message` (sudah menyebutkan jumlah & nama yang tertunda kalau ada),
  // dan tipe toast jadi 'error' kalau TIDAK ADA siswa yang berhasil dikirim
  // sama sekali (semuanya tertunda), supaya guru sadar perlu koreksi/rilis
  // essay dulu sebelum kirim ulang.
  async function kirimKelompok(mapel_id: string, kelas: string, kunci: string) {
    setSending(kunci)
    try {
      const res = await apiRequest<{ message: string; jumlah: number; tertunda: { nis: string; nama: string }[] }>(
        '/api/guru/kirim-nilai',
        {
          method: 'PATCH',
          body: JSON.stringify({ aksi: 'kirim_ke_wali', mapel_id, kelas }),
        }
      )
      const adaTertunda = (res.tertunda?.length ?? 0) > 0
      const tidakAdaYangTerkirim = res.jumlah === 0 && adaTertunda
      showToast(res.message ?? `Nilai ${kelas} berhasil dikirim ke wali kelas ✓`, tidakAdaYangTerkirim ? 'error' : 'success')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengirim', 'error')
    } finally {
      setSending(null)
    }
  }

  // FIX (fitur essay): rilis nilai essay/total per-individu — begitu dirilis,
  // siswa yang bersangkutan baru bisa melihat nilai_essay/nilai_total-nya.
  async function rilisEssayIndividu(sesiId: string, nis: string) {
    setRilisNis(nis)
    try {
      await apiRequest('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({ aksi: 'rilis_essay_individu', sesiId, nis }),
      })
      showToast(`Nilai essay untuk ${nis} berhasil dirilis`)
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal merilis nilai', 'error')
    } finally {
      setRilisNis(null)
    }
  }

  // FIX (fitur essay): rilis nilai essay/total sekaligus untuk satu sesi —
  // backend akan menolak kalau masih ada peserta essay yang belum dinilai.
  async function rilisEssaySekaligus(sesiId: string) {
    setRilisSesi(sesiId)
    try {
      const res = await apiRequest<{ message: string; jumlah: number }>('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({ aksi: 'rilis_essay_sekaligus', sesiId }),
      })
      showToast(res.message ?? 'Nilai essay berhasil dirilis ke semua siswa')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal merilis nilai', 'error')
    } finally {
      setRilisSesi(null)
    }
  }

  if (loading) return <PageLoader />
  if (!apiData) return null

  const kelompokList = buatKelompok(apiData.data)

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Header */}
      <div>
        <h1 className="page-title">Kirim Nilai ke Wali Kelas</h1>
        <p className="page-subtitle">
          Isi nilai edit untuk remedial (opsional), lalu kirim ke wali kelas.
          Jika kolom nilai edit dikosongkan, nilai asli yang akan dikirim.
        </p>
      </div>

      {/* FIX (kejelasan istilah): halaman ini menggabungkan dua AKSI yang
          beda tujuan (rilis ke SISWA vs kirim ke WALI KELAS) dan beberapa
          ANGKA nilai (asli/edit/essay/total) di satu layar — sebelumnya
          tidak ada penjelasan eksplisit, guru harus menyimpulkan sendiri
          dari konteks. Kotak ini murni informasi (tidak mengubah alur atau
          logika apa pun), tujuannya cuma jadi "peta" sebelum guru mulai
          mengisi tabel di bawah. */}
      <div className="card-sm bg-slate-50 border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
          <div className="flex gap-2">
            <Send className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">Kirim ke Wali Kelas</span> — tombol hijau
              di bagian bawah tiap mapel. Mengirim nilai <em>akhir</em> siswa (nilai edit kalau diisi,
              kalau tidak pakai nilai asli) ke wali kelas untuk mapel &amp; kelas itu.
            </div>
          </div>
          <div className="flex gap-2">
            <FileText className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">Rilis Nilai Essay</span> — panel ungu (kalau
              ada soal Essay). Membuka nilai Essay &amp; nilai Total (PG+Essay) agar bisa dilihat
              <em> siswa</em>. Harus dirilis dulu sebelum siswa itu ikut terkirim ke wali kelas.
            </div>
          </div>
        </div>
      </div>

      <EssayFlowGuide current="rilis" />

      {kelompokList.length === 0 && (
        <div className="card text-center py-16 text-slate-400">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p>Belum ada data nilai dari mata pelajaran yang Anda ampu.</p>
        </div>
      )}

      {kelompokList.map(grup => {
        const semuaDikirim = grup.sudahDikirim === grup.total && grup.total > 0
        const adaDikembalikan = grup.rows.some(r => r.dikembalikan)
        const isOpen = expandedGroup === grup.kunciMapel

        // FIX (fitur essay): siswa di kelompok ini yang essay-nya sudah
        // dinilai guru (nilai_essay tidak null) — dikelompokkan lagi per
        // sesi_id karena rilis sekaligus dilakukan per-sesi, bukan per
        // mapel+kelas (satu jadwal bisa punya sesi reguler & susulan).
        const esaiPerSesi: Record<string, NilaiRow[]> = {}
        for (const r of grup.rows) {
          if (r.nilai_essay === null || r.nilai_essay === undefined || !r.sesi_id) continue
          if (!esaiPerSesi[r.sesi_id]) esaiPerSesi[r.sesi_id] = []
          esaiPerSesi[r.sesi_id].push(r)
        }
        const sesiEssayIds = Object.keys(esaiPerSesi)
        const jumlahTertunda = grup.rows.filter(r => r.essay_belum_dirilis).length
        const statusKirim = statusKirimKelompok(grup)

        return (
          <div
            key={grup.kunciMapel}
            className={`card p-0 overflow-hidden border ${
              adaDikembalikan
                ? 'border-orange-300'
                : semuaDikirim
                  ? 'border-emerald-200'
                  : 'border-slate-200'
            }`}
          >
            {/* Header kelompok */}
            <button
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
              onClick={() => setExpandedGroup(isOpen ? null : grup.kunciMapel)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  adaDikembalikan ? 'bg-orange-500' : semuaDikirim ? 'bg-emerald-500' : 'bg-amber-400'
                }`} />
                <div>
                  <div className="font-semibold text-slate-900">
                    {grup.nama_mapel}
                    {!adaDikembalikan && statusKirim && (
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs align-middle ${statusKirim.className}`}>
                        {statusKirim.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">Kelas {grup.kelas}</div>
                </div>
                {adaDikembalikan && (
                  <span className="ml-2 flex items-center gap-1 text-xs bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-medium">
                    <AlertTriangle className="w-3 h-3" /> Dikembalikan wali kelas
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-slate-500">{grup.sudahDikirim}/{grup.total} terkirim</span>
                {jumlahTertunda > 0 && (
                  <span className="text-xs text-indigo-500">· {jumlahTertunda} menunggu essay</span>
                )}
                {grup.belumUjian.length > 0 && (
                  <span className="text-xs text-slate-400">· {grup.belumUjian.length} belum ujian</span>
                )}
                {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>
            </button>

            {/* Tabel nilai — hanya tampil kalau open */}
            {isOpen && (
              <div className="border-t border-slate-100">
                {grup.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="table text-sm w-full">
                    <thead>
                      <tr>
                        <th className="text-left">#</th>
                        <th className="text-left">Nama Siswa</th>
                        <th className="text-center">Nilai Asli</th>
                        <th className="text-center">Grade</th>
                        <th className="text-center">Status</th>
                        <th className="text-center w-32">Nilai Edit<br /><span className="font-normal text-slate-400 text-xs">(kosongkan = pakai asli)</span></th>
                        <th className="text-left w-48">Catatan</th>
                        <th className="text-center">Kirim?</th>
                        <th className="text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {grup.rows.map((n, i) => {
                        const nilaiEditStr = editMap[n.id] ?? ''
                        const nilaiEditNum = nilaiEditStr.trim() !== '' ? parseFloat(nilaiEditStr) : null
                        const kkm = n.kkm ?? 75
                        const lulusEdit = nilaiEditNum != null ? nilaiEditNum >= kkm : null
                        const isSaving = saving === n.id

                        return (
                          <tr key={n.id} className={n.dikembalikan ? 'bg-orange-50' : n.dikirim_ke_wali ? 'bg-emerald-50/40' : ''}>
                            <td className="text-slate-400 text-xs">{i + 1}</td>
                            <td>
                              <div className="font-medium text-slate-800 flex items-center gap-1.5 flex-wrap">
                                {n.nama_siswa}
                                {/* FIX (kelas campuran PG-only vs PG+Essay): badge ini muncul
                                    SEBELUM guru menekan tombol kirim, bukan cuma lewat toast
                                    sesudahnya — supaya kelihatan dari awal siswa mana yang akan
                                    dilewati saat "Kirim ke Wali Kelas" ditekan. */}
                                {n.essay_belum_dirilis && (
                                  <span className="flex items-center gap-1 text-[11px] bg-indigo-100 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-full font-medium">
                                    <FileText className="w-3 h-3" /> Menunggu essay
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400">{n.nis}</div>
                            </td>
                            <td className="text-center">
                              <span className={`text-base font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</span>
                            </td>
                            <td className="text-center">
                              <span className={`badge font-bold ${
                                n.grade === 'A' ? 'badge-green' :
                                n.grade === 'B' ? 'badge-blue' :
                                n.grade === 'C' ? 'badge-yellow' : 'badge-red'
                              }`}>{n.grade}</span>
                            </td>
                            <td className="text-center">
                              <span className={`badge ${n.lulus ? 'badge-green' : 'badge-red'}`}>
                                {n.lulus ? '✓ Lulus' : '✗ Tidak'}
                              </span>
                            </td>
                            <td className="text-center">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                placeholder="—"
                                value={nilaiEditStr}
                                onChange={e => setEditMap(m => ({ ...m, [n.id]: e.target.value }))}
                                className="input w-24 text-center text-sm"
                                disabled={n.dikirim_ke_wali && !n.dikembalikan}
                              />
                              {nilaiEditNum != null && (
                                <div className={`text-xs mt-1 ${lulusEdit ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {lulusEdit ? '✓ Lulus' : '✗ Tidak'}
                                </div>
                              )}
                            </td>
                            <td>
                              <input
                                type="text"
                                placeholder="Catatan opsional..."
                                value={catatanMap[n.id] ?? ''}
                                onChange={e => setCatatanMap(m => ({ ...m, [n.id]: e.target.value }))}
                                className="input w-full text-sm"
                                disabled={n.dikirim_ke_wali && !n.dikembalikan}
                              />
                              {n.catatan_guru && (
                                <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" /> {n.catatan_guru}
                                </div>
                              )}
                            </td>
                            <td className="text-center">
                              {n.dikirim_ke_wali && !n.dikembalikan ? (
                                <span className="flex items-center gap-1 justify-center text-xs text-emerald-600 font-medium">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  {n.dikirim_at ? formatDateTime(n.dikirim_at) : 'Terkirim'}
                                </span>
                              ) : n.dikembalikan ? (
                                <span className="flex items-center gap-1 justify-center text-xs text-orange-600 font-medium">
                                  <RotateCcw className="w-3.5 h-3.5" /> Dikembalikan
                                </span>
                              ) : n.essay_belum_dirilis ? (
                                <span className="flex items-center gap-1 justify-center text-xs text-indigo-600 font-medium" title="Akan dilewati saat 'Kirim ke Wali Kelas' ditekan, sampai nilai essay-nya dirilis">
                                  <FileText className="w-3.5 h-3.5" /> Tertunda
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">Belum</span>
                              )}
                            </td>
                            <td className="text-center">
                              <button
                                onClick={() => simpanEdit(n.id)}
                                disabled={isSaving || (n.dikirim_ke_wali && !n.dikembalikan)}
                                className="btn-secondary btn-sm text-xs"
                                title="Simpan nilai edit"
                              >
                                {isSaving ? (
                                  <span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Save className="w-3.5 h-3.5" />
                                )}
                                Simpan
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )}

                {/* FIX (fitur essay): panel rilis nilai essay — hanya tampil
                    kalau ada siswa di kelompok ini yang sudah dinilai
                    essay-nya oleh guru (lihat Koreksi Essay). */}
                {sesiEssayIds.length > 0 && (
                  <div className="border-t border-slate-100">
                    {sesiEssayIds.map(sesiId => {
                      const rowsSesi = esaiPerSesi[sesiId]
                      const semuaDirilis = rowsSesi.every(r => r.dirilis)
                      const isRilisSesi = rilisSesi === sesiId
                      return (
                        <div key={sesiId} className="px-5 py-4 bg-indigo-50/40">
                          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                              <FileText className="w-4 h-4 text-indigo-500" />
                              Nilai Essay ({rowsSesi.length} siswa dinilai)
                            </div>
                            <button
                              onClick={() => rilisEssaySekaligus(sesiId)}
                              disabled={isRilisSesi || semuaDirilis}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isRilisSesi ? (
                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              {semuaDirilis ? 'Semua Sudah Dirilis' : 'Rilis Semua ke Siswa'}
                            </button>
                          </div>
                          <p className="text-[11px] text-indigo-400 mb-2">
                            Sama dengan tombol rilis di menu Koreksi Essay — cukup dari salah satu.
                          </p>
                          <div className="space-y-1.5">
                            {rowsSesi.map(r => (
                              <div key={r.id} className="flex items-center justify-between gap-2 text-sm bg-white rounded-lg px-3 py-2 border border-indigo-100">
                                <div>
                                  <span className="font-medium text-slate-800">{r.nama_siswa}</span>
                                  <span className="text-xs text-slate-400 ml-2">
                                    Essay: {r.nilai_essay} · Total: {r.nilai_total ?? '-'}
                                  </span>
                                </div>
                                {r.dirilis ? (
                                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Dirilis
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => rilisEssayIndividu(sesiId, r.nis)}
                                    disabled={rilisNis === r.nis}
                                    className="btn-ghost btn-sm text-indigo-600 text-xs"
                                  >
                                    {rilisNis === r.nis ? (
                                      <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <Send className="w-3.5 h-3.5" />
                                    )}
                                    Rilis
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Info siswa yang essay-nya belum dirilis guru — nama-nama ini
                    akan DILEWATI kalau tombol "Kirim ke Wali Kelas" di bawah
                    ditekan sekarang, sampai nilai essay-nya dirilis lewat
                    panel "Nilai Essay" di atas (atau dikoreksi dulu kalau
                    belum muncul di panel itu sama sekali). */}
                {jumlahTertunda > 0 && (
                  <div className="px-5 py-3 bg-indigo-50 border-t border-indigo-100 text-xs text-indigo-800">
                    <strong>{jumlahTertunda} siswa menunggu rilis nilai essay:</strong>{' '}
                    {grup.rows.filter(r => r.essay_belum_dirilis).map(s => s.nama_siswa).join(', ')}
                  </div>
                )}

                {/* Info siswa yang belum mengikuti ujian ini sama sekali */}
                {grup.belumUjian.length > 0 && (
                  <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                    <strong>{grup.belumUjian.length} siswa belum mengikuti ujian ini:</strong>{' '}
                    {grup.belumUjian.map(s => s.nama_siswa).join(', ')}
                  </div>
                )}

                {/* Tombol kirim semua di kelompok ini — hanya relevan kalau ada nilai untuk dikirim */}
                {grup.total > 0 && (
                <div className="flex items-center justify-between px-5 py-4 bg-slate-50 border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    Nilai edit yang kosong akan otomatis menggunakan nilai asli saat dikirim.
                  </p>
                  <button
                    onClick={() => kirimKelompok(grup.mapel_id, grup.kelas, grup.kunciMapel)}
                    disabled={sending === grup.kunciMapel || semuaDikirim}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending === grup.kunciMapel ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {semuaDikirim ? 'Sudah Terkirim' : `Kirim Semua ke Wali Kelas`}
                  </button>
                </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
