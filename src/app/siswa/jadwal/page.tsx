'use client'

// Menu "Jadwal" siswa: tabel "Jadwal Ujian Kelas Saya".
//
// Warna baris (dihitung dari data server, bukan dari jam di perangkat siswa):
//   HIJAU  = siswa sudah mengikuti ujian dan ada nilainya
//   MERAH  = ujian sudah lewat/ditutup dan siswa tidak ikut (pesan ujian susulan di kolom Nilai)
//   POLOS  = belum tiba waktu ujian (dan sesi yang sedang berlangsung, lihat di bawah)
//
// Sumber data: /api/siswa/jadwal (status, sudah_ikut, nilai_id; status AKTIF yang
// tanggalnya sudah lewat sudah diubah server jadi SELESAI) dan /api/siswa/nilai
// (angka nilai yang SAMA dengan menu "Nilai Saya": remedial > essay dirilis > PG).

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Calendar, BookOpen } from 'lucide-react'
import { PageLoader, EmptyState } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Jadwal } from '@/types'

interface NilaiRingkas {
  id: string
  nilai: number
  nilai_final?: number | null
  ada_remedial?: boolean
  essay_belum_dirilis?: boolean
}

type Kondisi = 'ikut' | 'terlewat' | 'berlangsung' | 'belum'

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

// "2026-11-12" -> "Kamis, 12-11-2026". Hari dihitung dari tanggalnya sendiri
// (UTC), jadi tidak bergeser oleh zona waktu perangkat.
function formatHariTanggal(tanggal: string): string {
  const [y, m, d] = String(tanggal).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(tanggal)
  const hari = NAMA_HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${hari}, ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`
}

function tentukanKondisi(j: Jadwal): Kondisi {
  if (j.sudah_ikut) return 'ikut'
  if (j.status === 'BERJALAN') return 'berlangsung'
  if (j.status === 'SELESAI') return 'terlewat'
  return 'belum'
}

const formatNilai = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

export default function SiswaJadwalPage() {
  const [jadwal, setJadwal] = useState<Jadwal[]>([])
  const [nilaiMap, setNilaiMap] = useState<Record<string, NilaiRingkas>>({})
  const [loading, setLoading] = useState(true)
  const [gagal, setGagal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setGagal(false)
    try {
      const [resJadwal, resNilai] = await Promise.all([
        apiRequest<{ data: Jadwal[] }>('/api/siswa/jadwal?pengawas=1'),
        // Angka nilai bersifat pelengkap: kalau gagal, baris tetap hijau dan
        // kolom Nilai menampilkan tautan ke menu Nilai Saya.
        apiRequest<{ data: NilaiRingkas[] }>('/api/siswa/nilai').catch(() => null),
      ])
      setJadwal(resJadwal.data ?? [])
      const peta: Record<string, NilaiRingkas> = {}
      for (const n of resNilai?.data ?? []) peta[n.id] = n
      setNilaiMap(peta)
    } catch {
      setGagal(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Urut dari tanggal terdekat ke terjauh, lalu per sesi.
  const baris = useMemo(
    () => [...jadwal].sort((a, b) =>
      String(a.tanggal).slice(0, 10).localeCompare(String(b.tanggal).slice(0, 10)) || (a.sesi ?? 0) - (b.sesi ?? 0)
    ),
    [jadwal]
  )

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Jadwal Ujian Kelas Saya</h1>
        <p className="page-subtitle">Jadwal dan hasil ujian untuk kelas Anda</p>
      </div>

      {gagal ? (
        <div className="card text-center space-y-3 py-8">
          <p className="text-sm text-slate-600">Jadwal belum bisa dimuat. Periksa koneksi internet Anda.</p>
          <button type="button" className="btn-primary btn-sm" onClick={load}>Coba Lagi</button>
        </div>
      ) : baris.length === 0 ? (
        <div className="card"><EmptyState message="Tidak ada jadwal ujian" icon={Calendar} /></div>
      ) : (
        <div className="table-wrapper bg-white">
          <table className="table min-w-[600px] sm:min-w-[780px] text-xs sm:text-sm [&_th]:px-2.5 [&_td]:px-2.5 sm:[&_th]:px-4 sm:[&_td]:px-4">
            <thead>
              <tr>
                <th className="w-12">No</th>
                <th>Mapel</th>
                <th>Pengawas</th>
                <th>Hari/Tanggal</th>
                <th className="w-16">Sesi</th>
                <th>Status</th>
                <th>Nilai</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((j, i) => {
                const kondisi = tentukanKondisi(j)
                const warnaBaris =
                  kondisi === 'ikut' ? 'bg-emerald-100 hover:bg-emerald-100' :
                  kondisi === 'terlewat' ? 'bg-red-100 hover:bg-red-100' : ''
                const warnaSel =
                  kondisi === 'ikut' ? 'text-emerald-900 border-emerald-200' :
                  kondisi === 'terlewat' ? 'text-red-900 border-red-200' : ''
                const nilai = j.nilai_id ? nilaiMap[j.nilai_id] : undefined
                const angka = nilai ? (nilai.nilai_final ?? nilai.nilai) : null
                const essayTertunda = !!nilai && !nilai.ada_remedial && nilai.essay_belum_dirilis === true

                return (
                  <tr key={j.id} className={warnaBaris}>
                    <td className={`align-top ${warnaSel}`}>{i + 1}</td>
                    <td className={`align-top font-medium ${warnaSel || 'text-slate-800'}`}>{j.nama_mapel}</td>
                    <td className={`align-top ${warnaSel}`}>{j.nama_pengawas || '-'}</td>
                    <td className={`align-top sm:whitespace-nowrap ${warnaSel}`}>{formatHariTanggal(j.tanggal)}</td>
                    <td className={`align-top ${warnaSel}`}>{j.sesi}</td>
                    <td className={`align-top ${warnaSel}`}>
                      {kondisi === 'ikut' || kondisi === 'terlewat' ? (
                        'Ujian Selesai'
                      ) : kondisi === 'berlangsung' ? (
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="font-medium text-brand-700">Sedang Berlangsung</span>
                          <Link href="/siswa/ujian" className="btn-primary btn-sm whitespace-nowrap">
                            <BookOpen className="w-3.5 h-3.5" /> Masuk Ujian
                          </Link>
                        </div>
                      ) : (
                        'Belum mulai'
                      )}
                    </td>
                    <td className={`align-top ${warnaSel}`}>
                      {kondisi === 'ikut' ? (
                        <div className="space-y-0.5">
                          {angka !== null ? (
                            <div className="text-base font-bold">{formatNilai(Number(angka))}</div>
                          ) : null}
                          {essayTertunda && (
                            <div className="text-xs">Nilai PG. Nilai essay belum dirilis guru.</div>
                          )}
                          {j.nilai_id && (
                            <Link href={`/siswa/nilai/${j.nilai_id}`} className="text-xs font-medium underline whitespace-nowrap">
                              {angka !== null ? 'Lihat detail' : 'Lihat nilai'} →
                            </Link>
                          )}
                        </div>
                      ) : kondisi === 'terlewat' ? (
                        <span className="font-medium">
                          Belum Ikut Ujian. Cari Panitia ujian untuk ikut Ujian Susulan
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
