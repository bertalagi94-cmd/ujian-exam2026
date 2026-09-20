// Klaim "PG selesai (offline)", disimpan di localStorage.
//
// Latar belakang bug: saat POST /api/siswa/ujian/selesai gagal murni karena
// JARINGAN (bukan ditolak server) padahal semua jawaban PG SUDAH terverifikasi
// tersimpan di server (lihat loop verifikasi di handleSelesai,
// src/app/siswa/ujian/page.tsx), siswa sebelumnya terjebak selamanya di modal
// retry generik — tidak pernah bisa lanjut ke essay ataupun mendapat jalur
// darurat, walau jawabannya sendiri sudah 100% aman.
//
// Modul ini menyimpan KAPAN siswa menekan "Selesai" (waktu klaim), supaya:
//   (a) UI tahu harus menawarkan jalur essay offline (kode darurat) sekarang
//       juga, tanpa menunggu koneksi pulih, dan
//   (b) proses retry di background tahu waktu klaim aslinya untuk dikirim
//       sebagai `waktuSelesaiClient` ke /selesai begitu koneksi pulih —
//       dipakai server HANYA untuk jejak audit (lihat klaimkanWaktu() di
//       src/lib/klaim-offline.ts). Nilai PG tidak pernah dihitung dari klaim
//       ini, selalu dari baris `jawaban` yang sudah nyata tersimpan di server.
//
// Klaim ini juga dipulihkan saat tab di-reload sebelum sempat terkonfirmasi
// (lihat pemulihan di page.tsx), supaya siswa tidak kehilangan jalur essay
// offline hanya karena me-refresh halaman.

const KEY_PREFIX = 'pgSelesaiOfflineKlaim'

function key(sesiId: string, nis: string): string {
  return `${KEY_PREFIX}:${sesiId}:${nis}`
}

export function simpanKlaimPgSelesaiOffline(sesiId: string, nis: string, waktuIso: string): void {
  try {
    localStorage.setItem(key(sesiId, nis), waktuIso)
  } catch {
    // Private mode / storage penuh — abaikan, retry di background tetap
    // akan mencoba beberapa kali selama tab tidak ditutup.
  }
}

export function ambilKlaimPgSelesaiOffline(sesiId: string, nis: string): string | null {
  try {
    return localStorage.getItem(key(sesiId, nis))
  } catch {
    return null
  }
}

export function hapusKlaimPgSelesaiOffline(sesiId: string, nis: string): void {
  try {
    localStorage.removeItem(key(sesiId, nis))
  } catch {
    // abaikan
  }
}
