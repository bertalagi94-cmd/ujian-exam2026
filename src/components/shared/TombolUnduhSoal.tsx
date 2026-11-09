'use client'

// Tombol "Unduh" untuk satu paket soal guru (PG atau Essay) → PDF / Word.
// Seluruh pembuatan file terjadi di browser (src/lib/ekspor-soal.ts); soal
// diambil dari endpoint guru yang sudah ada, jadi tidak ada API baru.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, FileType2 } from 'lucide-react'
import { Modal, Spinner } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import type { OpsiEksporSoal, SoalPgEkspor, SoalEssayEkspor } from '@/lib/ekspor-soal'

interface Props {
  jenis: 'PG' | 'ESSAY'
  paketId: string
  namaMapel: string
  namaKelas: string
  /** Durasi (menit) bila diketahui, ditampilkan di kotak identitas. */
  durasiMenit?: number | null
  onToast?: (msg: string, type: 'success' | 'error') => void
}

export function TombolUnduhSoal({ jenis, paketId, namaMapel, namaKelas, durasiMenit, onToast }: Props) {
  const [open, setOpen] = useState(false)
  const [kerja, setKerja] = useState<'pdf' | 'word' | null>(null)
  const [kunci, setKunci] = useState(false)
  async function unduh(format: 'pdf' | 'word') {
    if (kerja) return
    setKerja(format)
    try {
      const url = jenis === 'PG' ? `/api/guru/paket/${paketId}/soal` : `/api/guru/paket-essay/${paketId}/soal`
      const res = await apiRequest<{ data: unknown[] }>(url)
      const daftar = res.data ?? []
      if (daftar.length === 0) throw new Error('Paket ini belum berisi soal')

      // Data sekolah untuk kop (nama, logo, alamat, NPSN, tahun ajaran).
      let p: Record<string, string> = {}
      try { p = (await apiRequest<{ data: Record<string, string> }>(`/api/public/pengaturan?_t=${Date.now()}`)).data ?? {} } catch { /* kop tetap dibuat */ }

      let namaGuru: string | undefined
      try { namaGuru = (JSON.parse(localStorage.getItem('user') ?? 'null') as { nama?: string } | null)?.nama || undefined } catch { /* abaikan */ }

      const opsi: OpsiEksporSoal = {
        jenis,
        namaMapel,
        namaKelas,
        namaSekolah: p.namaSekolah || '',
        alamat: p.alamatSekolah || '',
        npsn: p.npsnSekolah || '',
        tahunAjaran: p.tahunAjaran || '',
        logoUrl: p.logoUrl || '',
        namaGuru,
        durasiMenit: durasiMenit ?? null,
        soalPg: jenis === 'PG' ? (daftar as SoalPgEkspor[]) : undefined,
        soalEssay: jenis === 'ESSAY' ? (daftar as SoalEssayEkspor[]) : undefined,
        sertakanKunci: jenis === 'PG' && kunci,
      }

      // Dimuat saat dibutuhkan saja (jsPDF & docx cukup besar).
      const lib = await import('@/lib/ekspor-soal')
      const nama = format === 'pdf' ? await lib.unduhSoalPdf(opsi) : await lib.unduhSoalWord(opsi)
      onToast?.(`Berhasil diunduh: ${nama}`, 'success')
      setOpen(false)
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Gagal membuat file', 'error')
    } finally {
      setKerja(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary !px-2 !py-1 !text-[11px] lg:!px-3 lg:!py-1.5 lg:!text-xs !rounded-lg"
        title="Unduh soal sebagai PDF atau Word"
      >
        <Download className="w-3 h-3 lg:w-3.5 lg:h-3.5" /> Unduh
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <Modal open onClose={() => { if (!kerja) setOpen(false) }} title={`Unduh Soal ${jenis === 'PG' ? 'Pilihan Ganda' : 'Essay'}`} size="sm">
          <p className="text-sm text-slate-600 mb-3">
            {namaMapel} · Kelas {namaKelas}
          </p>
          <div className="space-y-2">
            <button type="button" disabled={!!kerja} onClick={() => unduh('pdf')}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {kerja === 'pdf' ? <Spinner size="sm" /> : <FileText className="w-4 h-4 text-red-500" />} Unduh PDF
            </button>
            <button type="button" disabled={!!kerja} onClick={() => unduh('word')}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {kerja === 'word' ? <Spinner size="sm" /> : <FileType2 className="w-4 h-4 text-blue-600" />} Unduh Word (.docx)
            </button>
            {jenis === 'PG' && (
              <label className="flex items-start gap-2 pt-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={kunci} onChange={e => setKunci(e.target.checked)} className="mt-0.5" />
                <span>Sertakan halaman <strong>kunci jawaban</strong> di akhir file</span>
              </label>
            )}
          </div>
        </Modal>,
        document.body,
      )}
    </>
  )
}
