'use client'

// Bar status jaringan yang SELALU terlihat selama ujian (tetap tampak di mode
// fullscreen karena bagian dari DOM halaman). Offline BUKAN error -- ini mode
// operasi resmi: jawaban tetap disimpan di perangkat lalu dikirim saat kembali
// online -- jadi nadanya menenangkan, bukan alarm.
import { useStatusJaringan } from '@/lib/status-jaringan'

export function StatusJaringanBar() {
  const status = useStatusJaringan()

  const konfigurasi = {
    ONLINE: {
      kelas: 'bg-emerald-600 text-white',
      titik: 'bg-emerald-200',
      teks: 'Internet : Online',
    },
    CHECKING: {
      kelas: 'bg-amber-500 text-white',
      titik: 'bg-amber-100 animate-pulse',
      teks: 'Internet : Memeriksa koneksi...',
    },
    OFFLINE: {
      kelas: 'bg-red-600 text-white',
      titik: 'bg-red-200 animate-pulse',
      teks: 'Internet : Offline — Mode offline aktif, jawaban disimpan di perangkat.',
    },
  }[status]

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-0 inset-x-0 z-[9000] flex h-7 items-center justify-center gap-2 px-3 text-xs font-medium ${konfigurasi.kelas}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${konfigurasi.titik}`} />
      <span className="truncate">{konfigurasi.teks}</span>
    </div>
  )
}
