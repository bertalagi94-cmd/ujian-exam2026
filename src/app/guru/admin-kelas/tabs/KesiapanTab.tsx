'use client'

// Tab "Kesiapan Ujian" di menu Admin Kelas (guru). HANYA BACA.
//
// Validasi Soal hanya melihat paket yang SUDAH dikirim guru. Papan ini
// menjawab pertanyaan sebelumnya: untuk tiap mapel di kelas saya, soalnya
// sudah sampai mana, sudah dijadwalkan atau belum, dan guru mana yang harus
// ditagih. Datanya dari sumber yang sama dengan Rangkuman Jadwal Super Admin
// (disaring ke kelas wilayah di server), jadi angkanya selalu sama.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, MessageCircle, RefreshCw, ClipboardCheck } from 'lucide-react'
import { Badge, EmptyState, SearchInput, Spinner, StatCard } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { LABEL_KESIAPAN, type BarisKesiapanKelas, type ResponKesiapanKelas } from '@/lib/admin-kelas-shared'
import type { StatusSoal } from '@/lib/soal-status-shared'

type FilterStatus = 'SEMUA' | StatusSoal | 'SIAP_BELUM_JADWAL'

const VARIAN_STATUS: Record<StatusSoal, 'green' | 'yellow' | 'red' | 'blue' | 'orange'> = {
  DISETUJUI: 'green',
  MENUNGGU: 'yellow',
  DITOLAK: 'red',
  DRAFT: 'blue',
  BELUM_ADA: 'orange',
}

const BATAS_AWAL = 100

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' tanpa lewat objek Date (hindari geser zona waktu).
function tampilTanggal(t: string | null): string {
  if (!t) return '-'
  const [y, m, d] = t.split('-')
  return y && m && d ? `${d}/${m}/${y}` : t
}

export function KesiapanTab({ onBukaValidasi }: { onBukaValidasi: () => void }) {
  const [respon, setRespon] = useState<ResponKesiapanKelas | null>(null)
  const [loading, setLoading] = useState(true)
  const [galat, setGalat] = useState<string | null>(null)
  const [filterKelas, setFilterKelas] = useState('SEMUA')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('SEMUA')
  const [cari, setCari] = useState('')
  const [batas, setBatas] = useState(BATAS_AWAL)

  const muat = useCallback(async () => {
    setLoading(true)
    setGalat(null)
    try {
      setRespon(await apiRequest<ResponKesiapanKelas>('/api/guru/admin-kelas/kesiapan', { timeoutMs: 20_000 }))
    } catch (e) {
      setGalat(e instanceof Error ? e.message : 'Gagal memuat papan kesiapan')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { muat() }, [muat])

  const namaKelasUnik = useMemo(
    () => [...new Set((respon?.data ?? []).map(d => d.kelas))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
    [respon]
  )

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase()
    return (respon?.data ?? []).filter((d: BarisKesiapanKelas) => {
      if (filterKelas !== 'SEMUA' && d.kelas !== filterKelas) return false
      if (filterStatus === 'SIAP_BELUM_JADWAL') {
        if (!(d.status_soal === 'DISETUJUI' && !d.sudah_dijadwalkan)) return false
      } else if (filterStatus !== 'SEMUA' && d.status_soal !== filterStatus) return false
      if (q && !`${d.nama_mapel} ${d.nama_guru ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [respon, filterKelas, filterStatus, cari])

  useEffect(() => { setBatas(BATAS_AWAL) }, [filterKelas, filterStatus, cari])

  if (loading && !respon) return <div className="flex justify-center py-16"><Spinner /></div>
  if (galat && !respon) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-600">{galat}</p>
        <button onClick={muat} className="btn-secondary btn-sm mx-auto"><RefreshCw className="w-4 h-4" /> Coba lagi</button>
      </div>
    )
  }
  if (!respon) return null

  const r = respon.ringkasan
  const tampil = tersaring.slice(0, batas)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Soal disetujui" value={`${r.per_status.DISETUJUI}/${r.total}`} icon={CheckCircle2} color="bg-emerald-500" sub="mapel × kelas" />
        <StatCard label="Menunggu validasi Anda" value={r.per_status.MENUNGGU} icon={Clock} color="bg-amber-500" sub="paket sudah dikirim guru" />
        <StatCard label="Perlu ditagih ke guru" value={r.perlu_ditagih} icon={AlertTriangle} color="bg-red-500" sub="belum dibuat / draft / ditolak" />
        <StatCard label="Sudah terjadwal" value={`${r.sudah_terjadwal}/${r.total}`} icon={CalendarCheck} color="bg-sky-500" sub={`${r.siap_belum_terjadwal} soal siap belum dijadwalkan`} />
      </div>

      {respon.kelas_tanpa_mapel.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Kelas {respon.kelas_tanpa_mapel.join(', ')} belum punya mata pelajaran di sistem, jadi belum ada yang bisa dipantau.
          Hubungi Super Admin untuk menambahkannya.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {namaKelasUnik.length > 1 && (
          <select className="input w-auto" value={filterKelas} onChange={e => setFilterKelas(e.target.value)} aria-label="Filter kelas">
            <option value="SEMUA">Semua kelas ({namaKelasUnik.length})</option>
            {namaKelasUnik.map(k => <option key={k} value={k}>Kelas {k}</option>)}
          </select>
        )}
        <select className="input w-auto" value={filterStatus} onChange={e => setFilterStatus(e.target.value as FilterStatus)} aria-label="Filter status">
          <option value="SEMUA">Semua status</option>
          <option value="MENUNGGU">{LABEL_KESIAPAN.MENUNGGU} ({r.per_status.MENUNGGU})</option>
          <option value="BELUM_ADA">{LABEL_KESIAPAN.BELUM_ADA} ({r.per_status.BELUM_ADA})</option>
          <option value="DRAFT">{LABEL_KESIAPAN.DRAFT} ({r.per_status.DRAFT})</option>
          <option value="DITOLAK">{LABEL_KESIAPAN.DITOLAK} ({r.per_status.DITOLAK})</option>
          <option value="DISETUJUI">{LABEL_KESIAPAN.DISETUJUI} ({r.per_status.DISETUJUI})</option>
          <option value="SIAP_BELUM_JADWAL">Soal siap, belum dijadwalkan ({r.siap_belum_terjadwal})</option>
        </select>
        <SearchInput value={cari} onChange={setCari} placeholder="Cari mapel atau guru..." className="flex-1 min-w-[180px] max-w-xs" />
        <button onClick={muat} disabled={loading} className="btn-secondary btn-sm ml-auto" title="Muat ulang data">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
      </div>

      {tersaring.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ClipboardCheck}
            title={respon.data.length === 0 ? 'Belum ada mapel di kelas Anda' : 'Tidak ada data yang cocok'}
            description={respon.data.length === 0 ? 'Mata pelajaran muncul di sini setelah Super Admin menambahkannya ke kelas.' : 'Ubah filter atau kata pencarian.'}
          />
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="table-wrapper rounded-none border-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mata pelajaran</th>
                    <th>Kelas</th>
                    <th>Guru</th>
                    <th>Status soal</th>
                    <th>Jadwal</th>
                    <th className="text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {tampil.map(d => (
                    <tr key={`${d.mapel_id}__${d.kelas}`}>
                      <td className="font-medium text-slate-800">{d.nama_mapel}</td>
                      <td>{d.kelas}</td>
                      <td>{d.nama_guru ?? <span className="text-slate-400">-</span>}</td>
                      <td><Badge variant={VARIAN_STATUS[d.status_soal]} dot>{LABEL_KESIAPAN[d.status_soal]}</Badge></td>
                      <td>
                        {d.sudah_dijadwalkan
                          ? <span className="text-slate-700">{tampilTanggal(d.tanggal_jadwal)}</span>
                          : <span className={d.status_soal === 'DISETUJUI' ? 'text-amber-600 font-medium' : 'text-slate-400'}>Belum</span>}
                      </td>
                      <td className="text-right">
                        {d.status_soal === 'MENUNGGU' && (
                          <button onClick={onBukaValidasi} className="btn-primary btn-sm">Validasi</button>
                        )}
                        {d.link_tagih && (
                          <a href={d.link_tagih} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" title="Kirim pengingat lewat WhatsApp">
                            <MessageCircle className="w-4 h-4" /> Tagih
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Menampilkan {tampil.length} dari {tersaring.length} baris</span>
            {tersaring.length > tampil.length && (
              <button onClick={() => setBatas(b => b + BATAS_AWAL)} className="btn-secondary btn-sm">Tampilkan lebih banyak</button>
            )}
          </div>
        </>
      )}

      <p className="text-xs text-slate-400">
        Status dihitung dari paket soal pilihan ganda, sama dengan Rangkuman Jadwal Super Admin. Tombol Tagih membuka WhatsApp
        dengan pesan siap kirim, dan hanya muncul kalau guru punya nomor HP terdaftar.
      </p>
    </div>
  )
}
