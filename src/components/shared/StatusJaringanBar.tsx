'use client'

// Bar status jaringan yang SELALU terlihat selama ujian (tetap tampak di mode
// fullscreen karena bagian dari DOM halaman). Offline BUKAN error -- ini mode
// operasi resmi: jawaban tetap disimpan di perangkat lalu dikirim saat kembali
// online -- jadi nadanya menenangkan, bukan alarm.
import { useEffect, useState } from 'react'
import { useStatusJaringan } from '@/lib/status-jaringan'

// Setelah internet tidak tersambung selama ini, siswa diminta memberi tahu
// pengawas (pengawas tidak bisa melihat HP yang offline secara langsung).
const BATAS_PESAN_LAPOR_MS = 10_000

export function StatusJaringanBar() {
  const status = useStatusJaringan()

  // Hitung lama TIDAK-ONLINE (CHECKING + OFFLINE dihitung sama, supaya 10 detik
  // dihitung sejak koneksi mulai bermasalah, bukan sejak dinyatakan OFFLINE).
  // Kembali ONLINE sekali saja langsung mereset hitungan.
  const [perluLapor, setPerluLapor] = useState(false)
  useEffect(() => {
    if (status === 'ONLINE') { setPerluLapor(false); return }
    const t = setTimeout(() => setPerluLapor(true), BATAS_PESAN_LAPOR_MS)
    return () => clearTimeout(t)
  }, [status === 'ONLINE'])

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
    <>
    {perluLapor && (
      <div
        role="alert"
        className="fixed inset-x-0 top-8 z-[9001] mx-auto max-w-md rounded-2xl bg-red-600 px-4 py-3 text-white shadow-2xl"
        style={{ marginLeft: 12, marginRight: 12 }}
      >
        <div className="text-sm font-bold">Internet Anda terputus</div>
        <div className="mt-1 text-xs leading-snug">
          Segera beri tahu pengawas bahwa jaringan Anda mati (kuota habis atau Wi-Fi terputus).
          Jawaban Anda tetap tersimpan di HP dan akan terkirim otomatis saat internet kembali.
          Waktu ujian tetap berjalan.
        </div>
      </div>
    )}
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
    </>
  )
}
