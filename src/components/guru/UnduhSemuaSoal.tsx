'use client'

// ── Tombol "Unduh Semua Paket" (akun guru → menu Buat Soal) ────────────────────
// Guru yang mengampu banyak mapel/kelas tidak perlu mengunduh paket satu per
// satu. Tombol ini membuka daftar paket (PG dan Essay) dengan kotak centang,
// lalu membuat naskah tiap paket yang dipilih (PDF atau Word, format yang sama
// dengan tombol Unduh per paket) dan membungkus semuanya dalam SATU file ZIP.
//
// Tidak ada API baru: soal tiap paket diambil lewat endpoint guru yang sudah
// dipakai tombol Unduh per paket, satu paket pada satu waktu (tidak menambah
// beban server). Seluruh pembuatan file terjadi di browser.
//
// "Selesai" di sini = paket yang sudah berisi soal dan bukan lagi DRAFT/DITOLAK
// (yaitu MENUNGGU validasi atau DISETUJUI). Itu hanya pilihan awal: guru bebas
// mencentang paket lain, termasuk draft.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, FileType2, CheckCircle2, XCircle, Archive } from 'lucide-react'
import { Modal, Spinner } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import type { OpsiEksporSoal, SoalPgEkspor, SoalEssayEkspor } from '@/lib/ekspor-soal'

export interface PaketUnduh {
  id: string
  jenis: 'PG' | 'ESSAY'
  mapel: string
  kelas: string
  jumlah: number
  status: string
  durasiMenit?: number | null
}

const LABEL_STATUS: Record<string, { teks: string; kelas: string }> = {
  DRAFT: { teks: 'Draft', kelas: 'bg-slate-100 text-slate-600' },
  MENUNGGU: { teks: 'Menunggu validasi', kelas: 'bg-amber-100 text-amber-700' },
  DISETUJUI: { teks: 'Disetujui', kelas: 'bg-emerald-100 text-emerald-700' },
  DITOLAK: { teks: 'Ditolak', kelas: 'bg-red-100 text-red-700' },
}

const kunciPaket = (p: PaketUnduh) => `${p.jenis}:${p.id}`
const dianggapSelesai = (p: PaketUnduh) => p.jumlah > 0 && (p.status === 'MENUNGGU' || p.status === 'DISETUJUI')

type Fase = 'pilih' | 'proses' | 'selesai'
type StatusBaris = 'antre' | 'jalan' | 'ok' | 'gagal'

export function UnduhSemuaSoal({
  paket, onToast,
}: {
  paket: PaketUnduh[]
  onToast?: (msg: string, type: 'success' | 'error') => void
}) {
  const [buka, setBuka] = useState(false)
  const [fase, setFase] = useState<Fase>('pilih')
  const [dipilih, setDipilih] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<'pdf' | 'word'>('pdf')
  const [kunci, setKunci] = useState(false)
  const [status, setStatus] = useState<Record<string, { s: StatusBaris; alasan?: string }>>({})
  const [selesaiN, setSelesaiN] = useState(0)

  const punyaSoal = useMemo(() => paket.filter(p => p.jumlah > 0), [paket])
  const jumlahSelesai = useMemo(() => punyaSoal.filter(dianggapSelesai).length, [punyaSoal])

  // Kunci scroll halaman selama jendela terbuka.
  useEffect(() => {
    if (!buka) return
    const lama = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = lama }
  }, [buka])

  function bukaJendela() {
    setDipilih(new Set(punyaSoal.filter(dianggapSelesai).map(kunciPaket)))
    setStatus({})
    setSelesaiN(0)
    setFase('pilih')
    setBuka(true)
  }

  function tutup() {
    if (fase === 'proses') return
    setBuka(false)
  }

  function toggle(p: PaketUnduh) {
    setDipilih(prev => {
      const n = new Set(prev)
      const k = kunciPaket(p)
      if (n.has(k)) n.delete(k); else n.add(k)
      return n
    })
  }

  const terpilih = punyaSoal.filter(p => dipilih.has(kunciPaket(p)))
  const adaPg = terpilih.some(p => p.jenis === 'PG')

  async function mulai() {
    if (terpilih.length === 0) return
    setFase('proses')
    setSelesaiN(0)
    setStatus(Object.fromEntries(terpilih.map(p => [kunciPaket(p), { s: 'antre' as StatusBaris }])))

    // Kop sekolah & nama guru: diambil sekali untuk semua paket.
    let pengaturan: Record<string, string> = {}
    try { pengaturan = (await apiRequest<{ data: Record<string, string> }>(`/api/public/pengaturan?_t=${Date.now()}`)).data ?? {} } catch { /* kop tetap dibuat */ }
    let namaGuru: string | undefined
    try { namaGuru = (JSON.parse(localStorage.getItem('user') ?? 'null') as { nama?: string } | null)?.nama || undefined } catch { /* abaikan */ }

    const lib = await import('@/lib/ekspor-soal')
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const namaDipakai = new Set<string>()
    let font: Awaited<ReturnType<typeof lib.muatFontPdf>> | undefined
    let berhasil = 0

    for (const p of terpilih) {
      const k = kunciPaket(p)
      setStatus(prev => ({ ...prev, [k]: { s: 'jalan' } }))
      try {
        const url = p.jenis === 'PG' ? `/api/guru/paket/${p.id}/soal` : `/api/guru/paket-essay/${p.id}/soal`
        const res = await apiRequest<{ data: unknown[] }>(url)
        const daftar = res.data ?? []
        if (daftar.length === 0) throw new Error('Paket belum berisi soal')

        const opsi: OpsiEksporSoal = {
          jenis: p.jenis,
          namaMapel: p.mapel,
          namaKelas: p.kelas,
          namaSekolah: pengaturan.namaSekolah || '',
          alamat: pengaturan.alamatSekolah || '',
          npsn: pengaturan.npsnSekolah || '',
          tahunAjaran: pengaturan.tahunAjaran || '',
          logoUrl: pengaturan.logoUrl || '',
          namaGuru,
          durasiMenit: p.durasiMenit ?? null,
          soalPg: p.jenis === 'PG' ? (daftar as SoalPgEkspor[]) : undefined,
          soalEssay: p.jenis === 'ESSAY' ? (daftar as SoalEssayEkspor[]) : undefined,
          sertakanKunci: p.jenis === 'PG' && kunci,
        }

        let hasil: { blob: Blob; nama: string }
        if (format === 'pdf') {
          if (!font) font = await lib.muatFontPdf()
          hasil = await lib.buatBlobSoalPdf(opsi, font)
        } else {
          hasil = await lib.buatBlobSoalWord(opsi)
        }

        // Nama file di dalam ZIP harus unik.
        let nama = hasil.nama
        let n = 2
        while (namaDipakai.has(nama)) nama = hasil.nama.replace(/(\.[a-z]+)$/, `-${n++}$1`)
        namaDipakai.add(nama)
        zip.file(nama, hasil.blob)

        berhasil++
        setStatus(prev => ({ ...prev, [k]: { s: 'ok' } }))
      } catch (e) {
        setStatus(prev => ({ ...prev, [k]: { s: 'gagal', alasan: e instanceof Error ? e.message : 'Gagal membuat file' } }))
      }
      setSelesaiN(n => n + 1)
    }

    if (berhasil > 0) {
      try {
        const blobZip = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
        const tgl = new Date().toISOString().slice(0, 10)
        lib.unduhBlob(blobZip, `Paket-Soal-${format === 'pdf' ? 'PDF' : 'Word'}-${tgl}.zip`)
        onToast?.(`${berhasil} paket soal diunduh dalam satu file ZIP`, 'success')
      } catch {
        onToast?.('Gagal menyusun file ZIP', 'error')
      }
    } else {
      onToast?.('Tidak ada paket yang berhasil dibuat', 'error')
    }
    setFase('selesai')
  }

  if (punyaSoal.length === 0) return null

  const totalProses = terpilih.length
  const gagalN = Object.values(status).filter(x => x.s === 'gagal').length

  return (
    <>
      <button
        type="button"
        onClick={bukaJendela}
        className="btn-secondary w-full sm:w-auto flex items-center justify-center gap-2"
        title="Unduh banyak paket soal sekaligus dalam satu file ZIP"
      >
        <Archive className="w-4 h-4" />
        Unduh Semua Paket
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">{jumlahSelesai}</span>
      </button>

      {buka && typeof document !== 'undefined' && createPortal(
        <Modal open onClose={tutup} title="Unduh Semua Paket Soal" size="lg">
          {fase === 'pilih' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Pilih paket yang mau diunduh. Hasilnya <strong>satu file ZIP</strong> berisi satu naskah per paket.
                Yang tercentang awalnya adalah paket yang sudah selesai (menunggu validasi atau disetujui).
              </p>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" className="font-medium text-emerald-700 hover:underline"
                  onClick={() => setDipilih(new Set(punyaSoal.map(kunciPaket)))}>Pilih semua</button>
                <span className="text-slate-300">|</span>
                <button type="button" className="font-medium text-emerald-700 hover:underline"
                  onClick={() => setDipilih(new Set(punyaSoal.filter(dianggapSelesai).map(kunciPaket)))}>Hanya yang selesai</button>
                <span className="text-slate-300">|</span>
                <button type="button" className="font-medium text-slate-500 hover:underline"
                  onClick={() => setDipilih(new Set())}>Kosongkan</button>
                <span className="ml-auto text-slate-500">{terpilih.length} dipilih</span>
              </div>

              <ul className="max-h-[42vh] overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
                {punyaSoal.map(p => {
                  const st = LABEL_STATUS[p.status] ?? { teks: p.status, kelas: 'bg-slate-100 text-slate-600' }
                  return (
                    <li key={kunciPaket(p)}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                        <input type="checkbox" className="h-4 w-4 accent-emerald-600"
                          checked={dipilih.has(kunciPaket(p))} onChange={() => toggle(p)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{p.mapel} · Kelas {p.kelas}</span>
                          <span className="text-[11px] text-slate-500">
                            {p.jenis === 'PG' ? 'Pilihan Ganda' : 'Essay'} · {p.jumlah} soal
                          </span>
                        </span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.kelas}`}>{st.teks}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setFormat('pdf')}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${format === 'pdf' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                  <FileText className="h-4 w-4 text-red-500" /> PDF
                </button>
                <button type="button" onClick={() => setFormat('word')}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${format === 'word' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                  <FileType2 className="h-4 w-4 text-blue-600" /> Word (.docx)
                </button>
              </div>

              {adaPg && (
                <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={kunci} onChange={e => setKunci(e.target.checked)} className="mt-0.5" />
                  <span>Sertakan halaman <strong>kunci jawaban</strong> di akhir naskah PG</span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={tutup}>Batal</button>
                <button type="button" className="btn-primary flex items-center gap-2" disabled={terpilih.length === 0} onClick={mulai}>
                  <Download className="h-4 w-4" /> Unduh {terpilih.length} Paket (ZIP)
                </button>
              </div>
            </div>
          )}

          {fase !== 'pilih' && (
            <div className="space-y-3">
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${totalProses ? (selesaiN / totalProses) * 100 : 0}%` }} />
                </div>
                <p className="mt-1 text-center text-xs text-slate-500">
                  {fase === 'proses' ? `Membuat naskah ${Math.min(selesaiN + 1, totalProses)} dari ${totalProses}… jangan tutup halaman ini` : `Selesai: ${totalProses - gagalN} berhasil${gagalN ? `, ${gagalN} gagal` : ''}`}
                </p>
              </div>
              <ul className="max-h-[42vh] overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
                {terpilih.map(p => {
                  const st = status[kunciPaket(p)]?.s ?? 'antre'
                  const alasan = status[kunciPaket(p)]?.alasan
                  return (
                    <li key={kunciPaket(p)} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <span className="mt-0.5 flex-shrink-0">
                        {st === 'jalan' ? <Spinner size="sm" /> : st === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : st === 'gagal' ? <XCircle className="h-4 w-4 text-red-500" /> : <span className="block h-4 w-4 rounded-full border border-slate-300" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-800">{p.mapel} · Kelas {p.kelas} <span className="text-[11px] text-slate-400">({p.jenis === 'PG' ? 'PG' : 'Essay'})</span></span>
                        {alasan && <span className="block text-[11px] text-red-600">{alasan}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {fase === 'selesai' && (
                <div className="flex justify-end">
                  <button type="button" className="btn-primary" onClick={tutup}>Tutup</button>
                </div>
              )}
            </div>
          )}
        </Modal>,
        document.body,
      )}
    </>
  )
}
