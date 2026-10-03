'use client'

// ── POPUP PENJELASAN SETELAH IMPOR SOAL BERHASIL ────────────────────────────
// Setelah impor, halaman langsung menampilkan form "Soal ke-(N+1)". Guru yang
// baru pertama kali memakai fitur ini bisa bingung ("kok langsung nomor 6?
// yang 5 tadi mana?"). Popup ini menjelaskan apa yang terjadi dan apa
// langkah selanjutnya.

import { CheckCircle2, ArrowDown, Plus } from 'lucide-react'
import { Modal } from '@/components/ui'

export interface ImporSelesaiInfo {
  jenis: 'pg' | 'essay'
  /** Jumlah soal yang baru saja diimpor. */
  diimpor: number
  /** Total soal dalam paket setelah impor (termasuk yang sudah ada sebelumnya). */
  total: number
}

interface Props {
  info: ImporSelesaiInfo | null
  onTutup: () => void
  /** Dipanggil saat guru memilih melihat daftar soal (scroll ke daftar). */
  onLihatSoal: () => void
}

export function ImporSelesaiPopup({ info, onTutup, onLihatSoal }: Props) {
  const sebelumnya = info ? info.total - info.diimpor : 0
  const dari = sebelumnya + 1
  const rentang = info
    ? info.diimpor === 1 ? `nomor ${dari}` : `nomor ${dari}–${info.total}`
    : ''
  const berikutnya = info ? info.total + 1 : 0
  const namaJenis = info?.jenis === 'essay' ? 'essay' : 'pilihan ganda'

  return (
    <Modal
      open={!!info}
      onClose={onTutup}
      title="Impor Berhasil"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onTutup}>
            <Plus className="w-4 h-4" /> Tambah Soal Lagi
          </button>
          <button className="btn-primary" onClick={onLihatSoal}>
            <ArrowDown className="w-4 h-4" /> Lihat Soal yang Diimpor
          </button>
        </>
      }
    >
      {info && (
        <div className="space-y-4 text-sm text-slate-700">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-slate-900 text-base">
                {info.diimpor} soal {namaJenis} berhasil diimpor
              </p>
              <p className="text-slate-600">
                Soal {rentang} sudah tersimpan di paket ini.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="font-medium text-slate-800">Mengapa form menampilkan &ldquo;Soal ke-{berikutnya}&rdquo;?</p>
            <p>
              Form pada halaman ini digunakan untuk <b>menambahkan soal berikutnya</b>. Karena paket sudah berisi {info.total} soal,
              form otomatis menampilkan soal ke-{berikutnya}. Seluruh soal hasil impor <b>telah tersimpan</b> dan dapat
              dilihat pada bagian <b>&ldquo;Soal yang sudah dibuat&rdquo;</b> di bawah form.
            </p>
          </div>

          <div>
            <p className="font-medium text-slate-800 mb-1">Langkah selanjutnya</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li>Periksa soal hasil impor pada daftar di bawah form. Setiap soal dapat diedit atau dihapus.</li>
              <li>Untuk menambah soal, isi form soal ke-{berikutnya} atau impor file Word lainnya.</li>
              <li>Apabila soal sudah lengkap, klik tombol <b>&ldquo;Selesai&rdquo;</b> di bagian atas halaman.</li>
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}
