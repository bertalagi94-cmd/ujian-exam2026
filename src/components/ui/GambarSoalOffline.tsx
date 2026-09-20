// Precache gambar soal (PG & essay) pakai Cache API bawaan browser, supaya
// gambar tetap tampil walau internet mati SELAMA gambar sudah sempat
// diunduh saat ujian dimulai (mirip perlakuan paket soal PG offline yang
// sudah lebih dulu ada, lihat useEffect pengambilan amplop essay di
// siswa/ujian/page.tsx).
//
// Latar belakang bug: sebelumnya elemen <img> selalu diberi `src={gambar_url}`
// mentah-mentah. Teks soal aman karena sudah ikut tersimpan di paket
// soal/amplop terenkripsi, tapi gambar TIDAK — begitu internet mati, browser
// tetap harus mengambil gambar itu dari jaringan tiap kali dirender, dan
// gagal (ikon gambar rusak) walau soalnya sendiri sudah bisa dikerjakan
// offline.
//
// Solusi dipilih: Cache API (bukan Service Worker) — cukup untuk kebutuhan
// "sudah pasti terlihat sekali online, tetap terlihat walau offline
// belakangan", tanpa menambah lapisan service-worker/registrasi baru ke
// aplikasi Next.js yang belum punya satupun.

const CACHE_NAME = 'ujian-gambar-soal-v1'

function cacheTersedia(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

/**
 * Unduh & simpan semua URL gambar yang diberikan ke Cache API. Dipanggil
 * SEDINI mungkin — begitu paket soal PG atau soal essay diterima dari
 * server/amplop — supaya sempat tersimpan sebelum siswa keburu offline.
 * Aman dipanggil berkali-kali (mis. tiap kali paket soal berganti): URL yang
 * sudah ada di cache dilewati, tidak diunduh ulang.
 */
export async function precacheGambarSoal(urls: (string | null | undefined)[]): Promise<void> {
  if (!cacheTersedia()) return
  const unik = Array.from(new Set(urls.filter((u): u is string => !!u)))
  if (unik.length === 0) return
  try {
    const cache = await caches.open(CACHE_NAME)
    await Promise.all(
      unik.map(async (url) => {
        try {
          const sudahAda = await cache.match(url)
          if (sudahAda) return
          // no-store: kita yang mengatur sendiri penyimpanannya lewat Cache API,
          // tidak perlu double-cache lewat HTTP cache browser.
          const res = await fetch(url, { cache: 'no-store' })
          if (res.ok) await cache.put(url, res)
        } catch {
          // Satu gambar gagal diunduh (mis. memang sedang offline saat
          // paket soal pertama kali diambil) tidak boleh menggagalkan
          // gambar lain — abaikan, akan dicoba lagi lain kali fungsi ini
          // dipanggil selama koneksi tersedia.
        }
      })
    )
  } catch {
    // Cache API tidak tersedia/diblokir (mis. mode privat ketat) — biarkan
    // <img> jatuh ke perilaku normal (langsung ke jaringan).
  }
}

/**
 * Ambil kembali gambar dari cache sebagai object URL untuk dipakai di
 * elemen <img src=...>. Mengembalikan null kalau tidak ada di cache (elemen
 * pemanggil tinggal jatuh ke `src={url}` biasa sebagai fallback).
 */
export async function ambilGambarDariCache(url: string | null | undefined): Promise<string | null> {
  if (!url || !cacheTersedia()) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(url)
    if (!res) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}
