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
      // FIX (permintaan: bar ini menutupi sebagian tombol Sebelumnya/
      // Berikutnya di halaman ujian): tinggi dulu selalu tepat h-7 (28px)
      // tanpa memperhitungkan area gesture-bar di iPhone tanpa tombol Home,
      // jadi bar tombol navigasi soal yang menempel tepat di atasnya bisa
      // hitung posisi meleset di perangkat begitu. `min-h` (bukan `h` tetap)
      // + `paddingBottom: env(safe-area-inset-bottom)` membuat total tinggi
      // elemen ini SELALU 1.75rem + inset aman perangkat — nilai yang sama
      // persis dipakai StatusNav (lihat `bottom` di bar Sebelumnya/
      // Berikutnya, src/app/siswa/ujian/page.tsx) supaya keduanya menumpuk
      // rapi tanpa saling menutupi, di perangkat apa pun.
      className={`fixed bottom-0 inset-x-0 z-[9000] flex min-h-[1.75rem] items-center justify-center gap-2 px-3 text-xs font-medium ${konfigurasi.kelas}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${konfigurasi.titik}`} />
      <span className="truncate">{konfigurasi.teks}</span>
    </div>
  )
}
