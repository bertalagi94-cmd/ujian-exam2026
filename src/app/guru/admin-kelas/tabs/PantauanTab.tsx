'use client'

// Tab "Pantauan Ujian" di menu Admin Kelas (guru). HANYA LIHAT.
//
// Dua hal yang paling sering jadi masalah di hari ujian:
//   1. Sesi yang masih berjalan padahal waktunya sudah lewat / semua siswa
//      sudah selesai (pengawas lupa menutup) - nilai siswa tertahan.
//   2. Siswa yang terkunci karena pelanggaran.
// Membuka kunci dan menutup sesi tetap hak Super Admin / pengawas, jadi di sini
// Admin Kelas hanya melihat dan bisa mengingatkan pengawas lewat WhatsApp.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Lock, MessageCircle, PlayCircle, RefreshCw, ShieldCheck, Activity } from 'lucide-react'
import { Badge, EmptyState, SearchInput, Spinner, StatCard } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { LABEL_MASALAH_SESI, type ResponPantauanKelas } from '@/lib/admin-kelas-shared'

const JEDA_OTOMATIS_MS = 30_000

export function PantauanTab() {
  const [respon, setRespon] = useState<ResponPantauanKelas | null>(null)
  const [loading, setLoading] = useState(true)
  const [galat, setGalat] = useState<string | null>(null)
  const [filterKelas, setFilterKelas] = useState('SEMUA')
  const [cari, setCari] = useState('')

  // senyap = pembaruan otomatis: tidak menampilkan spinner dan tidak menghapus data lama kalau gagal.
  const muat = useCallback(async (senyap = false) => {
    if (!senyap) { setLoading(true); setGalat(null) }
    try {
      setRespon(await apiRequest<ResponPantauanKelas>('/api/guru/admin-kelas/pantauan', { timeoutMs: 25_000 }))
      if (senyap) setGalat(null)
    } catch (e) {
      if (!senyap) setGalat(e instanceof Error ? e.message : 'Gagal memuat pantauan ujian')
    } finally {
      if (!senyap) setLoading(false)
    }
  }, [])

  useEffect(() => { muat() }, [muat])
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') muat(true) }, JEDA_OTOMATIS_MS)
    return () => clearInterval(id)
  }, [muat])

  const namaKelasUnik = useMemo(() => {
    const semua = [...(respon?.sesi ?? []).map(s => s.kelas), ...(respon?.terkunci ?? []).map(t => t.kelas)]
    return [...new Set(semua)].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
  }, [respon])

  const sesi = useMemo(
    () => (respon?.sesi ?? []).filter(s => filterKelas === 'SEMUA' || s.kelas === filterKelas),
    [respon, filterKelas]
  )
  const terkunci = useMemo(() => {
    const q = cari.trim().toLowerCase()
    return (respon?.terkunci ?? []).filter(t =>
      (filterKelas === 'SEMUA' || t.kelas === filterKelas) &&
      (!q || t.nama.toLowerCase().includes(q) || t.nis.toLowerCase().includes(q))
    )
  }, [respon, filterKelas, cari])

  if (loading && !respon) return <div className="flex justify-center py-16"><Spinner /></div>
  if (galat && !respon) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-600">{galat}</p>
        <button onClick={() => muat()} className="btn-secondary btn-sm mx-auto"><RefreshCw className="w-4 h-4" /> Coba lagi</button>
      </div>
    )
  }
  if (!respon) return null

  const r = respon.ringkasan

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sesi berjalan" value={r.sesi_berjalan} icon={PlayCircle} color="bg-sky-500" sub="di kelas Anda sekarang" />
        <StatCard label="Sesi bermasalah" value={r.sesi_bermasalah} icon={AlertTriangle} color={r.sesi_bermasalah > 0 ? 'bg-red-500' : 'bg-emerald-500'} sub="belum ditutup" />
        <StatCard label="Siswa terkunci" value={r.siswa_terkunci} icon={Lock} color={r.siswa_terkunci > 0 ? 'bg-amber-500' : 'bg-emerald-500'} sub={`${respon.hari_riwayat} hari terakhir`} />
        <StatCard label="Terkunci, sesi berjalan" value={r.terkunci_di_sesi_berjalan} icon={Activity} color="bg-orange-500" sub="mungkin sedang menunggu" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {namaKelasUnik.length > 1 && (
          <select className="input w-auto" value={filterKelas} onChange={e => setFilterKelas(e.target.value)} aria-label="Filter kelas">
            <option value="SEMUA">Semua kelas ({namaKelasUnik.length})</option>
            {namaKelasUnik.map(k => <option key={k} value={k}>Kelas {k}</option>)}
          </select>
        )}
        <span className="text-xs text-slate-400 ml-auto">Diperbarui otomatis tiap 30 detik</span>
        <button onClick={() => muat()} disabled={loading} className="btn-secondary btn-sm" title="Muat ulang data">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
      </div>

      {/* ── Sesi berjalan ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Sesi yang sedang berjalan</h2>
        {sesi.length === 0 ? (
          <div className="card"><EmptyState icon={ShieldCheck} title="Tidak ada sesi berjalan" description="Tidak ada ujian yang sedang berlangsung di kelas Anda." /></div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="table-wrapper rounded-none border-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mata pelajaran</th>
                    <th>Kelas</th>
                    <th>Mulai</th>
                    <th>Siswa</th>
                    <th>Kondisi</th>
                    <th>Pengawas</th>
                    <th className="text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {sesi.map(s => (
                    <tr key={s.sesi_id}>
                      <td className="font-medium text-slate-800">
                        {s.nama_mapel}
                        {s.is_susulan && <span className="ml-1.5"><Badge variant="purple">Susulan</Badge></span>}
                      </td>
                      <td>{s.kelas}</td>
                      <td className="text-xs text-slate-600">{s.label_tanggal}<br />{s.label_jam_mulai} · {s.durasi_menit} mnt</td>
                      <td className="text-xs text-slate-600">
                        <span title="Masih mengerjakan">{s.peserta.aktif} aktif</span> · {s.peserta.selesai} selesai
                        {s.peserta.reset > 0 && <> · <span className="text-amber-600">{s.peserta.reset} menunggu reset</span></>}
                        {s.peserta.terkunci > 0 && <> · <span className="text-red-600">{s.peserta.terkunci} terkunci</span></>}
                      </td>
                      <td>
                        {s.jenis_masalah
                          ? <Badge variant={s.jenis_masalah === 'SEMUA_SELESAI' ? 'yellow' : 'red'} dot>{LABEL_MASALAH_SESI[s.jenis_masalah]}</Badge>
                          : <Badge variant="green" dot>Berjalan normal</Badge>}
                      </td>
                      <td>{s.pengawas_nama ?? <span className="text-slate-400">-</span>}</td>
                      <td className="text-right">
                        {s.link_ingatkan && (
                          <a href={s.link_ingatkan} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" title="Ingatkan pengawas lewat WhatsApp">
                            <MessageCircle className="w-4 h-4" /> Ingatkan
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Siswa terkunci ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Siswa terkunci karena pelanggaran</h2>
          <SearchInput value={cari} onChange={setCari} placeholder="Cari nama atau NISN..." className="ml-auto min-w-[200px] max-w-xs" />
        </div>
        {terkunci.length === 0 ? (
          <div className="card"><EmptyState icon={ShieldCheck} title="Tidak ada siswa terkunci" description={`Tidak ada siswa terkunci di kelas Anda dalam ${respon.hari_riwayat} hari terakhir.`} /></div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="table-wrapper rounded-none border-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>Siswa</th>
                    <th>Kelas</th>
                    <th>Ujian</th>
                    <th>Pelanggaran</th>
                    <th>Sesi</th>
                  </tr>
                </thead>
                <tbody>
                  {terkunci.map(t => (
                    <tr key={`${t.sesi_id}__${t.nis}`}>
                      <td>
                        <div className="font-medium text-slate-800">{t.nama}</div>
                        <div className="font-mono text-[11px] text-slate-400">{t.nis}</div>
                      </td>
                      <td>{t.kelas}</td>
                      <td className="text-xs text-slate-600">{t.nama_mapel}<br />{t.label_tanggal}</td>
                      <td className="text-xs text-slate-600">
                        <span className="font-semibold text-red-600">{t.jumlah_pelanggaran}×</span>
                        {t.jenis_pelanggaran.length > 0 && <> {t.jenis_pelanggaran.join(', ')}</>}
                      </td>
                      <td>{t.sesi_berjalan ? <Badge variant="blue" dot>Masih berjalan</Badge> : <Badge variant="slate">Sudah ditutup</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Tab ini hanya untuk melihat. Membuka kunci siswa dan menutup sesi dilakukan Super Admin atau pengawas; tombol Ingatkan
        membuka WhatsApp ke pengawas dan hanya muncul kalau pengawas punya nomor HP terdaftar.
      </p>
    </div>
  )
}
