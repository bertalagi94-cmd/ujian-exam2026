'use client'

// Bar status jaringan yang SELALU terlihat selama ujian (tetap tampak di mode
// fullscreen karena bagian dari DOM halaman). Offline BUKAN error -- ini mode
// operasi resmi: jawaban tetap disimpan di perangkat lalu dikirim saat kembali
// online -- jadi nadanya menenangkan, bukan alarm.
import { useEffect, useRef, useState } from 'react'
import { useStatusJaringan } from '@/lib/status-jaringan'

// Setelah internet tidak tersambung selama ini, siswa diminta memberi tahu
// pengawas (pengawas tidak bisa melihat HP yang offline secara langsung).
const BATAS_PESAN_LAPOR_MS = 10_000
// Supaya TIDAK mengganggu: pil kecil hanya tampil sebentar, tidak menghalangi
// sentuhan, dan tidak muncul lagi dalam jeda ini walau sinyal naik-turun.
const DURASI_PIL_MS = 8_000
const JEDA_ULANG_PIL_MS = 60_000

export function StatusJaringanBar() {
  const status = useStatusJaringan()

  // `perluLapor` = sudah >= 10 dtk tidak online -> teks bar bawah berubah
  // (bar itu sudah ada, jadi tidak ada elemen baru yang menutupi soal).
  // `tampilPil` = pengingat singkat di atas, otomatis hilang sendiri.
  // CHECKING + OFFLINE dihitung sama, supaya 10 detik dihitung sejak koneksi
  // mulai bermasalah. Kembali ONLINE sekali langsung mereset.
  const [perluLapor, setPerluLapor] = useState(false)
  const [tampilPil, setTampilPil] = useState(false)
  const terakhirPilRef = useRef(0)
  useEffect(() => {
    if (status === 'ONLINE') { setPerluLapor(false); setTampilPil(false); return }
    const t = setTimeout(() => {
      setPerluLapor(true)
      if (Date.now() - terakhirPilRef.current >= JEDA_ULANG_PIL_MS) {
        terakhirPilRef.current = Date.now()
        setTampilPil(true)
      }
    }, BATAS_PESAN_LAPOR_MS)
    return () => clearTimeout(t)
  }, [status === 'ONLINE'])
  useEffect(() => {
    if (!tampilPil) return
    const t = setTimeout(() => setTampilPil(false), DURASI_PIL_MS)
    return () => clearTimeout(t)
  }, [tampilPil])

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
  const teksBar = perluLapor && status !== 'ONLINE'
    ? 'Internet terputus — beri tahu pengawas. Jawaban tersimpan di HP.'
    : konfigurasi.teks

  return (
    <>
    {tampilPil && (
      <div
        role="alert"
        className="pointer-events-none fixed inset-x-0 top-8 z-[9001] flex justify-center px-3"
      >
        <div className="rounded-full bg-red-600/95 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          Internet terputus — beri tahu pengawas
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
      <span className="truncate">{teksBar}</span>
    </div>
    </>
  )
}
