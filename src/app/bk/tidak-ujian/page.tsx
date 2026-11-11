'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { UserX, Users, Clock, DoorOpen, CalendarDays, RefreshCw, Info } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { PageLoader, EmptyState, StatCard, ScopeWarningBanner, SearchInput, Pagination } from '@/components/ui'

type StatusTidakUjian = 'TIDAK_IKUT' | 'BELUM_MASUK' | 'RUANG_KHUSUS'

interface BarisTidakUjian {
  kunci: string
  nis: string
  nama: string
  kelas: string
  jadwal_id: string
  nama_mapel: string
  tanggal: string
  jam_mulai: string
  jam_selesai: string
  status: StatusTidakUjian
  keterangan: string
  susulan_dibuka: boolean
}

interface Ringkasan {
  tidakIkut: number
  siswaTidakIkut: number
  belumMasuk: number
  ruangKhusus: number
  jumlahJadwal: number
}

interface TidakUjianResponse {
  scopeWarning?: string
  data: BarisTidakUjian[]
  ringkasan: Ringkasan
}

type FilterStatus = 'SEMUA' | StatusTidakUjian

const PER_HALAMAN = 25

const LABEL_STATUS: Record<StatusTidakUjian, { teks: string; kelas: string }> = {
  TIDAK_IKUT: { teks: 'Tidak mengikuti', kelas: 'badge-red' },
  BELUM_MASUK: { teks: 'Belum masuk', kelas: 'badge-yellow' },
  RUANG_KHUSUS: { teks: 'Di ruang khusus', kelas: 'badge-blue' },
}

function formatTanggal(t: string): string {
  const d = new Date(`${t}T00:00:00`)
  if (Number.isNaN(d.getTime())) return t || '-'
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BkTidakUjianPage() {
  const [result, setResult] = useState<TidakUjianResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('SEMUA')
  const [kelas, setKelas] = useState('')
  const [mapel, setMapel] = useState('')
  const [search, setSearch] = useState('')
  const [halaman, setHalaman] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setResult(await apiRequest<TidakUjianResponse>('/api/bk/tidak-ujian', { timeoutMs: 30_000 }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat daftar siswa tidak mengikuti ujian')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const semua = useMemo(() => result?.data ?? [], [result])

  const daftarKelas = useMemo(
    () => [...new Set(semua.map(b => b.kelas))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
    [semua]
  )
  const daftarMapel = useMemo(
    () => [...new Set(semua.map(b => b.nama_mapel))].sort((a, b) => a.localeCompare(b, 'id')),
    [semua]
  )

  const tersaring = useMemo(() => {
    const kata = search.trim().toLowerCase()
    return semua.filter(b =>
      (filterStatus === 'SEMUA' || b.status === filterStatus) &&
      (!kelas || b.kelas === kelas) &&
      (!mapel || b.nama_mapel === mapel) &&
      (!kata || b.nama.toLowerCase().includes(kata) || b.nis.toLowerCase().includes(kata))
    )
  }, [semua, filterStatus, kelas, mapel, search])

  const totalHalaman = Math.max(1, Math.ceil(tersaring.length / PER_HALAMAN))
  const halamanAktif = Math.min(halaman, totalHalaman)
  const tampil = useMemo(
    () => tersaring.slice((halamanAktif - 1) * PER_HALAMAN, halamanAktif * PER_HALAMAN),
    [tersaring, halamanAktif]
  )

  const ringkasan = result?.ringkasan
  const pilihanStatus: { nilai: FilterStatus; label: string; jumlah: number }[] = [
    { nilai: 'SEMUA', label: 'Semua', jumlah: semua.length },
    { nilai: 'TIDAK_IKUT', label: 'Tidak mengikuti', jumlah: ringkasan?.tidakIkut ?? 0 },
    { nilai: 'BELUM_MASUK', label: 'Belum masuk', jumlah: ringkasan?.belumMasuk ?? 0 },
    { nilai: 'RUANG_KHUSUS', label: 'Di ruang khusus', jumlah: ringkasan?.ruangKhusus ?? 0 },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <UserX className="w-6 h-6 text-pink-600" />
            Siswa Tidak Mengikuti Ujian
          </h1>
          <p className="page-subtitle">
            Siswa kelas binaan Anda yang belum mengerjakan ujian pada jadwal yang sesinya sudah dibuka
            (sedang berjalan atau sudah selesai). Hanya lihat.
          </p>
        </div>
        <button className="btn-secondary flex items-center gap-2" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
      </div>

      {error && <div className="card-sm border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}
      {result?.scopeWarning && <ScopeWarningBanner title="Kelas binaan belum diatur" message={result.scopeWarning} />}

      {loading && !result ? <PageLoader /> : result && !result.scopeWarning && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Tidak Mengikuti Ujian" value={ringkasan?.tidakIkut ?? 0} icon={UserX} color="bg-red-500"
              sub={`${ringkasan?.siswaTidakIkut ?? 0} siswa`} />
            <StatCard label="Belum Masuk (ujian berjalan)" value={ringkasan?.belumMasuk ?? 0} icon={Clock} color="bg-amber-500" />
            <StatCard label="Di Ruang Khusus" value={ringkasan?.ruangKhusus ?? 0} icon={DoorOpen} color="bg-sky-500" />
            <StatCard label="Jadwal Dihitung" value={ringkasan?.jumlahJadwal ?? 0} icon={CalendarDays} color="bg-pink-600"
              sub="sesinya sudah dibuka" />
          </div>

          <div className="card-sm flex items-start gap-3 text-sm text-slate-600">
            <Info className="w-4 h-4 mt-0.5 text-pink-600 flex-shrink-0" />
            <div className="space-y-1.5">
              <p className="font-medium text-slate-800">Cara membaca daftar ini</p>
              <p>Satu baris berarti satu siswa pada satu mapel. Status menunjukkan apakah siswa itu benar-benar tidak ikut atau masih punya kesempatan:</p>
              <ul className="space-y-1">
                <li><span className="badge-red mr-2">Tidak mengikuti</span>Ujian sudah selesai dan siswa tidak mengerjakan sama sekali. Ini yang perlu ditindaklanjuti.</li>
                <li><span className="badge-yellow mr-2">Belum masuk</span>Ujian masih berlangsung, siswa belum login. Belum bisa disebut tidak ikut.</li>
                <li><span className="badge-blue mr-2">Di ruang khusus</span>Siswa dijadwalkan ujian di ruang khusus dan belum mengerjakan. Diawasi pengawas ruang.</li>
              </ul>
              <p className="text-xs text-slate-500">
                Siswa yang sudah mengikuti ujian susulan tidak tampil lagi di sini. Siswa yang terkunci karena pelanggaran
                dianggap sudah mengikuti ujian dan dapat dilihat di menu Pelanggaran Siswa.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {pilihanStatus.map(p => (
              <button
                key={p.nilai}
                onClick={() => { setFilterStatus(p.nilai); setHalaman(1) }}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  filterStatus === p.nilai
                    ? 'bg-pink-600 border-pink-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-pink-300'
                }`}
              >
                {p.label} <span className="opacity-80">({p.jumlah})</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <select className="select w-auto" value={kelas} onChange={e => { setKelas(e.target.value); setHalaman(1) }}>
              <option value="">Semua kelas</option>
              {daftarKelas.map(k => <option key={k} value={k}>Kelas {k}</option>)}
            </select>
            <select className="select w-auto" value={mapel} onChange={e => { setMapel(e.target.value); setHalaman(1) }}>
              <option value="">Semua mapel</option>
              {daftarMapel.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <SearchInput value={search} onChange={v => { setSearch(v); setHalaman(1) }} placeholder="Cari nama atau NIS..." className="w-64" />
          </div>

          <div className="card">
            {tersaring.length === 0 ? (
              <EmptyState
                icon={Users}
                title={semua.length === 0 ? 'Tidak ada siswa yang tercatat tidak mengikuti ujian' : 'Tidak ada data yang cocok dengan pilihan Anda'}
                description={semua.length === 0
                  ? 'Semua siswa pada jadwal yang sesinya sudah dibuka sudah mengerjakan, atau belum ada ujian yang dibuka.'
                  : 'Ubah pilihan status, kelas, mapel, atau kata pencarian.'}
              />
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Siswa</th>
                        <th>Kelas</th>
                        <th>Mapel</th>
                        <th>Jadwal Ujian</th>
                        <th>Status</th>
                        <th>Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tampil.map(b => (
                        <tr key={b.kunci}>
                          <td>
                            <div className="font-medium text-slate-800">{b.nama}</div>
                            <div className="text-xs text-slate-400">{b.nis}</div>
                          </td>
                          <td className="text-slate-600">{b.kelas}</td>
                          <td className="text-slate-700">{b.nama_mapel}</td>
                          <td className="text-slate-600">
                            <div>{formatTanggal(b.tanggal)}</div>
                            <div className="text-xs text-slate-400">{b.jam_mulai}–{b.jam_selesai}</div>
                          </td>
                          <td><span className={LABEL_STATUS[b.status].kelas}>{LABEL_STATUS[b.status].teks}</span></td>
                          <td className="text-xs text-slate-500 max-w-xs">{b.keterangan}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={halamanAktif} totalPages={totalHalaman} onPage={setHalaman} total={tersaring.length} perPage={PER_HALAMAN} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
