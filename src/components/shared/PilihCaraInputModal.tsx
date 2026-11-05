'use client'

// Pop up 2 kartu: guru memilih cara memasukkan soal setelah menekan "Lanjut"
// (paket baru) atau "Lanjutkan" (paket draft yang sudah ada).
//   • Ketik manual satu per satu → halaman input soal seperti biasa.
//   • Impor dari Word            → halaman impor (unggah → preview → impor).
import { PenLine, FileUp, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui'

interface Props {
  open: boolean
  onClose: () => void
  jenis: 'pg' | 'essay'
  namaMapel: string
  namaKelas: string
  /** Jumlah soal yang sudah ada di paket (0 = paket baru). */
  jumlahSoal?: number
  onManual: () => void
  onImpor: () => void
}

export function PilihCaraInputModal(p: Props) {
  const namaJenis = p.jenis === 'pg' ? 'Pilihan Ganda' : 'Essay'
  const ada = p.jumlahSoal ?? 0
  return (
    <Modal
      open={p.open}
      onClose={p.onClose}
      title="Pilih Cara Input Soal"
      size="lg"
      footer={<button className="btn-secondary" onClick={p.onClose}>Kembali</button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Soal {namaJenis} · {p.namaMapel} · Kelas {p.namaKelas}
          {ada > 0 ? ` · sudah berisi ${ada} soal` : ''}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={p.onManual}
            className="group text-left rounded-2xl border-2 border-slate-200 bg-white p-5 transition-all hover:border-brand-400 hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <span className="w-12 h-12 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center mb-3 transition-transform group-hover:scale-110">
              <PenLine className="w-6 h-6" />
            </span>
            <div className="font-bold text-slate-900">Ketik Manual</div>
            <p className="text-sm text-slate-600 mt-1">
              Isi soal satu per satu langsung di aplikasi. Cocok untuk soal yang sedikit.
            </p>
          </button>

          <button type="button" onClick={p.onImpor}
            className="group relative text-left rounded-2xl border-2 border-slate-200 bg-white p-5 transition-all hover:border-brand-400 hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5">
              <Sparkles className="w-3 h-3" /> Lebih cepat
            </span>
            <span className="w-12 h-12 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center mb-3 transition-transform group-hover:scale-110">
              <FileUp className="w-6 h-6" />
            </span>
            <div className="font-bold text-slate-900">Impor dari Word</div>
            <p className="text-sm text-slate-600 mt-1">
              Unggah file Word berisi banyak soal sekaligus, periksa preview, lalu impor.
            </p>
          </button>
        </div>
      </div>
    </Modal>
  )
}
