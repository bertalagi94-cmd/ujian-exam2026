'use client'

// Unduh Massal Hasil Ujian (admin): pilih kelas × mapel yang sudah diujikan, lalu
// unduh sekaligus dalam satu file Excel (satu sheet per kelas–mapel) atau ZIP
// (satu file Excel per kelas–mapel). Data diambil satu kombinasi per request
// supaya ringan dan ada indikator progres.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Archive } from 'lucide-react'
import { Modal, Spinner, EmptyState } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import {
  type KomboNilai, type HasilKombo, type BarisNilaiEkspor,
  unduhExcelGabungan, unduhZip,
} from '@/lib/ekspor-nilai'

type FormatUnduh = 'excel' | 'zip'

const kunciKombo = (k: KomboNilai) => `${k.kelas}\u0000${k.mapel_nama}`
const BATAS_PARALEL = 3

export default function UnduhNilaiMassal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [daftar, setDaftar] = useState<KomboNilai[] | null>(null)
  const [memuat, setMemuat] = useState(false)
  const [galatMuat, setGalatMuat] = useState('')

  const [pilihan, setPilihan] = useState<Set<string>>(new Set())
  const [filterKelas, setFilterKelas] = useState('')
  const [filterMapel, setFilterMapel] = useState('')
  const [cari, setCari] = useState('')
  const [format, setFormat] = useState<FormatUnduh>('excel')

  const [bekerja, setBekerja] = useState(false)
  const [progres, setProgres] = useState({ selesai: 0, total: 0 })
  const [pesan, setPesan] = useState<{ jenis: 'ok' | 'galat'; teks: string } | null>(null)
  const batalRef = useRef(false)

  async function muatDaftar() {
    setMemuat(true)
    setGalatMuat('')
    try {
      const res = await apiRequest<{ data: KomboNilai[] }>('/api/admin/nilai/ekspor', { timeoutMs: 60_000 })
      setDaftar(res.data ?? [])
    } catch (e) {
      setGalatMuat(e instanceof Error ? e.message : 'Gagal memuat daftar mapel yang sudah diujikan')
    } finally {
      setMemuat(false)
    }
  }

  useEffect(() => {
    if (open && daftar === null && !memuat) void muatDaftar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Menutup dialog saat unduhan berjalan = membatalkan unduhan.
  useEffect(() => { if (!open) batalRef.current = true }, [open])

  const semuaKelas = useMemo(() => [...new Set((daftar ?? []).map(k => k.kelas))], [daftar])
  const semuaMapel = useMemo(
    () => [...new Set((daftar ?? []).map(k => k.mapel_nama))].sort((a, b) => a.localeCompare(b, 'id')),
    [daftar]
  )

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase()
    return (daftar ?? []).filter(k =>
      (!filterKelas || k.kelas === filterKelas) &&
      (!filterMapel || k.mapel_nama === filterMapel) &&
      (!q || k.kelas.toLowerCase().includes(q) || k.mapel_nama.toLowerCase().includes(q))
    )
  }, [daftar, filterKelas, filterMapel, cari])

  const perKelas = useMemo(() => {
    const peta = new Map<string, KomboNilai[]>()
    for (const k of tampil) peta.set(k.kelas, [...(peta.get(k.kelas) ?? []), k])
    return [...peta.entries()]
  }, [tampil])

  const dipilih = useMemo(() => (daftar ?? []).filter(k => pilihan.has(kunciKombo(k))), [daftar, pilihan])
  const totalSiswa = dipilih.reduce((a, k) => a + k.jumlah, 0)
  const semuaTampilTerpilih = tampil.length > 0 && tampil.every(k => pilihan.has(kunciKombo(k)))

  function ubahPilihan(item: KomboNilai[], nyala: boolean) {
    setPilihan(prev => {
      const baru = new Set(prev)
      for (const k of item) nyala ? baru.add(kunciKombo(k)) : baru.delete(kunciKombo(k))
      return baru
    })
  }

  async function ambilSatu(k: KomboNilai, catat: boolean): Promise<BarisNilaiEkspor[]> {
    const percobaan = async () => {
      const res = await apiRequest<{ data: BarisNilaiEkspor[] }>('/api/admin/nilai/ekspor', {
        method: 'POST',
        body: JSON.stringify({ kelas: k.kelas, mapel_nama: k.mapel_nama, catat }),
        timeoutMs: 60_000,
      })
      return res.data ?? []
    }
    try {
      return await percobaan()
    } catch {
      return await percobaan() // satu kali ulang untuk gangguan jaringan sesaat
    }
  }

  async function unduh() {
    if (dipilih.length === 0 || bekerja) return
    batalRef.current = false
    setBekerja(true)
    setPesan(null)
    setProgres({ selesai: 0, total: dipilih.length })

    const antrean = [...dipilih]
    const hasil: (HasilKombo | undefined)[] = new Array(antrean.length)
    const gagal: string[] = []
    let berikut = 0
    let selesai = 0

    async function pekerja() {
      while (!batalRef.current) {
        const i = berikut++
        if (i >= antrean.length) return
        const k = antrean[i]
        try {
          hasil[i] = { kombo: k, baris: await ambilSatu(k, i === 0) }
        } catch {
          gagal.push(`${k.kelas} – ${k.mapel_nama}`)
        }
        selesai++
        setProgres({ selesai, total: antrean.length })
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(BATAS_PARALEL, antrean.length) }, pekerja))

      if (batalRef.current) {
        setPesan({ jenis: 'galat', teks: 'Unduhan dibatalkan.' })
        return
      }
      // Tidak membuat file sebagian secara diam-diam: file yang kurang bisa disangka lengkap.
      if (gagal.length > 0) {
        setPesan({
          jenis: 'galat',
          teks: `Data ${gagal.length} kombinasi gagal diambil (${gagal.slice(0, 3).join('; ')}${gagal.length > 3 ? ', …' : ''}). File belum dibuat. Periksa koneksi lalu klik Unduh lagi.`,
        })
        return
      }

      const lengkap = hasil.filter((h): h is HasilKombo => !!h && h.baris.length > 0)
      if (lengkap.length === 0) {
        setPesan({ jenis: 'galat', teks: 'Tidak ada data nilai pada pilihan tersebut.' })
        return
      }

      const namaFile = format === 'zip' ? await unduhZip(lengkap) : await unduhExcelGabungan(lengkap)
      const baris = lengkap.reduce((a, h) => a + h.baris.length, 0)
      setPesan({ jenis: 'ok', teks: `${namaFile} diunduh: ${lengkap.length} kelas–mapel, ${baris} data nilai.` })
    } catch (e) {
      setPesan({ jenis: 'galat', teks: e instanceof Error ? e.message : 'Gagal membuat file' })
    } finally {
      setBekerja(false)
    }
  }

  function tutup() {
    batalRef.current = true
    onClose()
  }

  const persen = progres.total ? Math.round((progres.selesai / progres.total) * 100) : 0

  return (
    <Modal
      open={open}
      onClose={tutup}
      size="xl"
      title="Unduh hasil ujian"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-slate-500">
            {dipilih.length > 0 ? `${dipilih.length} kelas–mapel dipilih · ${totalSiswa} data nilai` : 'Belum ada yang dipilih'}
          </span>
          {bekerja ? (
            <button onClick={() => { batalRef.current = true }} className="btn-secondary btn-sm">Batalkan</button>
          ) : (
            <button onClick={tutup} className="btn-secondary btn-sm">Tutup</button>
          )}
          <button onClick={unduh} disabled={dipilih.length === 0 || bekerja} className="btn-primary btn-sm">
            {bekerja ? <Spinner size="sm" /> : <Download className="w-4 h-4" />} Unduh
          </button>
        </>
      }
    >
      {memuat ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : galatMuat ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm text-red-600">{galatMuat}</p>
          <button onClick={() => void muatDaftar()} className="btn-secondary btn-sm">Coba lagi</button>
        </div>
      ) : !daftar || daftar.length === 0 ? (
        <EmptyState message="Belum ada hasil ujian yang bisa diunduh" icon={Download} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Pilih kelas dan mata pelajaran yang sudah diujikan. Gunakan filter lalu &ldquo;Pilih semua yang tampil&rdquo;
            untuk memilih satu kelas, satu mapel di semua kelas, atau semuanya.
          </p>

          <div className="flex gap-2 flex-wrap">
            <select value={filterKelas} onChange={e => setFilterKelas(e.target.value)} className="select w-full sm:w-40" aria-label="Filter kelas">
              <option value="">Semua kelas</option>
              {semuaKelas.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={filterMapel} onChange={e => setFilterMapel(e.target.value)} className="select w-full sm:w-56" aria-label="Filter mata pelajaran">
              <option value="">Semua mata pelajaran</option>
              {semuaMapel.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              value={cari} onChange={e => setCari(e.target.value)}
              placeholder="Cari kelas atau mapel…" className="input flex-1 min-w-[160px]"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => ubahPilihan(tampil, !semuaTampilTerpilih)}
              disabled={tampil.length === 0}
              className="btn-secondary btn-sm"
            >
              {semuaTampilTerpilih ? 'Batal pilih yang tampil' : `Pilih semua yang tampil (${tampil.length})`}
            </button>
            <button onClick={() => setPilihan(new Set())} disabled={pilihan.size === 0} className="btn-secondary btn-sm">
              Kosongkan pilihan
            </button>
          </div>

          <div className="max-h-[38vh] overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {perKelas.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Tidak ada kelas atau mapel yang cocok dengan filter.</p>
            ) : perKelas.map(([kelas, item]) => {
              const semua = item.every(k => pilihan.has(kunciKombo(k)))
              return (
                <div key={kelas}>
                  <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={semua} onChange={() => ubahPilihan(item, !semua)} />
                    <span className="text-sm font-semibold text-slate-800">Kelas {kelas}</span>
                    <span className="text-xs text-slate-400">{item.length} mapel</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2">
                    {item.map(k => (
                      <label key={kunciKombo(k)} className="flex items-center gap-2 px-3 py-2 pl-8 cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={pilihan.has(kunciKombo(k))}
                          onChange={e => ubahPilihan([k], e.target.checked)}
                        />
                        <span className="text-sm text-slate-700 flex-1">{k.mapel_nama}</span>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{k.jumlah} siswa</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <legend className="sr-only">Format unduhan</legend>
            {([
              { id: 'excel', ikon: FileSpreadsheet, judul: 'Satu file Excel', ket: 'Satu sheet per kelas–mapel, plus sheet Ringkasan dan Semua Data.' },
              { id: 'zip', ikon: Archive, judul: 'ZIP berisi banyak Excel', ket: 'Satu file Excel per kelas–mapel, dikelompokkan per folder kelas.' },
            ] as const).map(o => (
              <label
                key={o.id}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 cursor-pointer ${format === o.id ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <input type="radio" name="format-unduh" className="mt-1" checked={format === o.id} onChange={() => setFormat(o.id)} />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    <o.ikon className="w-4 h-4 text-slate-500" /> {o.judul}
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">{o.ket}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {bekerja && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Mengambil data {progres.selesai} dari {progres.total}…</span>
                <span>{persen}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={persen} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-cyan-600 transition-all" style={{ width: `${persen}%` }} />
              </div>
            </div>
          )}

          {pesan && (
            <p role="status" className={`text-sm ${pesan.jenis === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{pesan.teks}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
