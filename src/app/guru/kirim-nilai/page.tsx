'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Send, Save, RotateCcw, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, Clock, BarChart3, MessageSquare,
} from 'lucide-react'
import { apiRequest, nilaiColor, formatDateTime } from '@/lib/utils'
import { PageLoader, Toast } from '@/components/ui'

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
}

interface MapelInfo { id: string; nama: string; kkm: number }

interface ApiData {
  data: NilaiRow[]
  mapelList: MapelInfo[]
  deadline: string | null
  reminderJam: number
}

// Kelompokkan per mapel+kelas
interface Kelompok {
  kunciMapel: string
  mapel_id: string
  nama_mapel: string
  kelas: string
  rows: NilaiRow[]
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

      // Buka kelompok pertama yang belum dikirim secara default
      const kelompokList = buatKelompok(res.data ?? [])
      const belumDikirim = kelompokList.find(k => k.sudahDikirim < k.total)
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
          sudahDikirim: 0,
          total: 0,
        }
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

  async function kirimKelompok(mapel_id: string, kelas: string, kunci: string) {
    setSending(kunci)
    try {
      await apiRequest('/api/guru/kirim-nilai', {
        method: 'PATCH',
        body: JSON.stringify({ aksi: 'kirim_ke_wali', mapel_id, kelas }),
      })
      showToast(`Nilai ${kelas} berhasil dikirim ke wali kelas ✓`)
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengirim', 'error')
    } finally {
      setSending(null)
    }
  }

  if (loading) return <PageLoader />
  if (!apiData) return null

  const kelompokList = buatKelompok(apiData.data)

  // Hitung info deadline
  let deadlineInfo: { label: string; sisa: string; lewat: boolean; dekat: boolean } | null = null
  if (apiData.deadline) {
    const dl = new Date(apiData.deadline)
    const now = new Date()
    const selisihMs = dl.getTime() - now.getTime()
    const selisihJam = selisihMs / (1000 * 60 * 60)
    deadlineInfo = {
      label: dl.toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      sisa: selisihJam > 0 ? `${Math.round(selisihJam)} jam lagi` : 'Sudah lewat',
      lewat: selisihJam <= 0,
      dekat: selisihJam > 0 && selisihJam <= (apiData.reminderJam ?? 24),
    }
  }

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

      {/* Info deadline */}
      {deadlineInfo && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${
          deadlineInfo.lewat
            ? 'bg-red-50 border-red-200 text-red-800'
            : deadlineInfo.dekat
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <Clock className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold text-sm">
              {deadlineInfo.lewat ? '⚠ Deadline sudah lewat — nilai sudah otomatis terkirim' : `Deadline: ${deadlineInfo.label}`}
            </div>
            {!deadlineInfo.lewat && (
              <div className="text-xs mt-0.5">{deadlineInfo.sisa} · Jika belum kirim manual, nilai akan otomatis terkirim saat deadline</div>
            )}
          </div>
        </div>
      )}

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
                  <div className="font-semibold text-slate-900">{grup.nama_mapel}</div>
                  <div className="text-xs text-slate-400">Kelas {grup.kelas}</div>
                </div>
                {adaDikembalikan && (
                  <span className="ml-2 flex items-center gap-1 text-xs bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-medium">
                    <AlertTriangle className="w-3 h-3" /> Dikembalikan wali kelas
                  </span>
                )}
                {semuaDikirim && !adaDikembalikan && (
                  <span className="ml-2 flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                    <CheckCircle className="w-3 h-3" /> Sudah terkirim semua
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-slate-500">{grup.sudahDikirim}/{grup.total} terkirim</span>
                {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>
            </button>

            {/* Tabel nilai — hanya tampil kalau open */}
            {isOpen && (
              <div className="border-t border-slate-100">
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
                              <div className="font-medium text-slate-800">{n.nama_siswa}</div>
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

                {/* Tombol kirim semua di kelompok ini */}
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
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
