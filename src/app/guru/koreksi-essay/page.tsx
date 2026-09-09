'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CheckSquare, Calendar, Users, ChevronRight, FileText, Image as ImageIcon,
  CheckCircle2, XCircle, Save, Send, AlertTriangle, Clock,
} from 'lucide-react'
import { Confirm, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
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
  statusEssay: string
  waktuKirimEssay: string | null
  jawabanTeks?: JawabanTeks[]
  fotoUrl?: string | null
  nilaiPg: { benar: number; total: number; kkm: number } | null
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
  const [savingNis, setSavingNis] = useState<string | null>(null)
  const [confirmTakMengerjakan, setConfirmTakMengerjakan] = useState<string | null>(null)
  const [confirmRilisSemua, setConfirmRilisSemua] = useState(false)
  const [rilisingSemua, setRilisingSemua] = useState(false)
  const [rilisingNis, setRilisingNis] = useState<string | null>(null)

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

  async function selectSesi(j: JadwalKoreksi) {
    if (!j.sesi_ujian) return
    setSelectedSesiId(j.sesi_ujian.id)
    setSelectedJadwal(j)
    setLoadingData(true)
    setData(null)
    try {
      const res = await apiRequest<KoreksiData>(`/api/guru/koreksi-essay?sesiId=${j.sesi_ujian.id}`)
      setData(res)
      const init: Record<string, string> = {}
      for (const p of res.peserta) {
        if (p.nilaiEssay !== null && p.nilaiEssay !== undefined && res.totalBobotMaks > 0) {
          // Nilai tersimpan dalam skala 0-100 — tampilkan kembali dalam skala bobot maks asli
          init[p.nis] = String(Math.round((p.nilaiEssay / 100) * res.totalBobotMaks))
        }
      }
      setNilaiInput(init)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data koreksi', 'error')
    } finally {
      setLoadingData(false)
    }
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

  const semuaSudahDinilai = !!data && data.peserta.length > 0 && data.peserta.every(p => p.sudahDinilai)
  const semuaSudahDirilis = !!data && data.peserta.length > 0 && data.peserta.every(p => p.dirilis)

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Koreksi Essay</h1>
        <p className="page-subtitle">Lihat jawaban/foto siswa, beri nilai essay, dan rilis nilai akhir ke siswa</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : jadwalList.length === 0 ? (
        <div className="card">
          <EmptyState icon={CheckSquare} title="Belum ada sesi essay" description="Sesi ujian dengan essay yang sudah pernah dibuka akan muncul di sini." />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Daftar sesi */}
          <div className="lg:col-span-2 space-y-2">
            {jadwalList.map(j => (
              <button
                key={j.id}
                onClick={() => selectSesi(j)}
                className={`w-full text-left card p-3.5 transition-all ${selectedSesiId === j.sesi_ujian?.id ? 'ring-2 ring-brand-400 border-brand-300' : 'hover:border-slate-300'}`}
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

          {/* Detail koreksi */}
          <div className="lg:col-span-3 space-y-4">
            {!selectedSesiId ? (
              <div className="card">
                <EmptyState icon={CheckSquare} title="Pilih sesi" description="Pilih sesi di sebelah kiri untuk mulai mengoreksi essay." />
              </div>
            ) : loadingData ? (
              <div className="flex justify-center py-16"><Spinner size="lg" /></div>
            ) : !data || data.peserta.length === 0 ? (
              <div className="card">
                <EmptyState icon={Clock} title="Belum ada yang selesai" description="Belum ada siswa yang mengirim essay pada sesi ini." />
              </div>
            ) : (
              <>
                <div className="card space-y-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-brand-600" />
                      <h2 className="font-semibold text-slate-900">
                        {data.soalEssay.length} Soal Essay · Mode {data.modeJawaban === 'DIGITAL' ? 'Digital' : 'Kertas'}
                      </h2>
                    </div>
                    <span className="text-xs text-slate-400">Total bobot maks: {data.totalBobotMaks}</span>
                  </div>

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
                </div>

                {/* Daftar peserta */}
                <div className="space-y-3">
                  {data.peserta.map(p => {
                    const nilaiSaatIni = nilaiInput[p.nis] ?? ''
                    return (
                      <div key={p.nis} className="card space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{p.nama}</p>
                            <p className="text-xs text-slate-400">
                              NIS {p.nis} · Dikirim {p.waktuKirimEssay ? formatDateTime(p.waktuKirimEssay) : '-'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {p.nilaiPg && (
                              <Badge variant="blue">PG: {p.nilaiPg.benar}/{p.nilaiPg.total}</Badge>
                            )}
                            {p.statusEssay === 'TIDAK_MENGERJAKAN' && <Badge variant="red">Tidak Mengerjakan</Badge>}
                            {p.sudahDinilai && <Badge variant="green">Sudah Dinilai</Badge>}
                            {p.dirilis && <Badge variant="purple">Dirilis</Badge>}
                          </div>
                        </div>

                        {/* Jawaban */}
                        {data.modeJawaban === 'DIGITAL' ? (
                          <div className="space-y-2">
                            {data.soalEssay.map((soal, i) => {
                              const jawaban = p.jawabanTeks?.find(j => j.soal_essay_id === soal.id)
                              return (
                                <div key={soal.id} className="bg-slate-50 rounded-lg p-3 text-sm">
                                  <p className="text-xs text-slate-400 mb-1">Soal {i + 1} · Bobot maks {soal.bobot_maks}</p>
                                  <p className="text-slate-700 font-medium mb-1.5">{soal.teks}</p>
                                  <p className="text-slate-600 whitespace-pre-wrap">{jawaban?.jawaban_teks || <span className="italic text-slate-400">Tidak dijawab</span>}</p>
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

                        {/* Input nilai */}
                        {p.statusEssay !== 'TIDAK_MENGERJAKAN' && (
                          <div className="flex items-end gap-2 flex-wrap pt-1 border-t border-slate-100">
                            <div className="flex-1 min-w-[140px]">
                              <label className="label">Nilai Essay (skala 0–{data.totalBobotMaks})</label>
                              <input
                                type="number" className="input" min={0} max={data.totalBobotMaks}
                                value={nilaiSaatIni}
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
                        )}

                        {p.nilaiTotal !== null && (
                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-sm">
                            <span className="text-slate-500 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              Nilai Essay: <strong>{p.nilaiEssay}</strong> · Nilai Total: <strong>{p.nilaiTotal}</strong>
                            </span>
                            {!p.dirilis && (
                              <button className="btn-ghost btn-sm text-brand-600" onClick={() => handleRilisIndividu(p.nis)} disabled={rilisingNis === p.nis}>
                                {rilisingNis === p.nis ? <Spinner size="sm" /> : <><Send className="w-3.5 h-3.5" /> Rilis ke Siswa Ini</>}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
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
    </div>
  )
}
