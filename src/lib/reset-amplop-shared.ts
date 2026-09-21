// src/lib/reset-amplop-shared.ts
//
// Konstanta & tipe yang dipakai BERSAMA oleh sisi server (reset-amplop-server.ts,
// node:crypto) dan sisi client (reset-offline-client.ts, WebCrypto). File ini
// sengaja tidak meng-import apa pun supaya aman di-bundle ke browser.
//
// ── LATAR BELAKANG ──────────────────────────────────────────────────────────
// Kode R1/R2/R3 (src/lib/reset-berurutan.ts) diturunkan deterministik dari
// RESET_PELANGGARAN_SECRET lewat HMAC. Itu aman untuk verifikasi ONLINE
// (server yang membandingkan), tapi TIDAK BOLEH langsung dipakai untuk
// verifikasi OFFLINE: mengirim kode plaintext R1/R2/R3 ke perangkat siswa
// SEBELUM dipakai akan membocorkan jawaban pelanggaran-nya sendiri lebih awal
// dari seharusnya (siswa bisa membuka DevTools dan membaca R2/R3 sebelum
// pelanggaran itu terjadi).
//
// Modul amplop ini memakai pola YANG SAMA dengan essay-amplop-shared.ts:
// server mengenkripsi sebuah "amplop" kecil dengan kunci yang DITURUNKAN dari
// kode reset itu sendiri (PBKDF2). Client menyimpan amplop terenkripsi di
// perangkat SEJAK AWAL (saat pre-cache, sebelum ujian dimulai), tapi tidak
// bisa membukanya tanpa kode yang benar dari pengawas. Konsekuensinya:
//   + Client TIDAK PERNAH memegang kode plaintext sebelum pengawas
//     memberikannya — hanya ciphertext yang tidak berguna tanpa kode.
//   + Client TIDAK PERNAH memegang rahasia server (RESET_PELANGGARAN_SECRET)
//     — tidak bisa dipakai untuk membuat/menebak reset siswa lain.
//   + Verifikasi murni lokal: cocok/tidaknya kode ditentukan oleh berhasil/
//     gagalnya dekripsi AES-GCM (tag otentikasi), tidak ada variabel
//     "kode benar" yang bisa dibaca lewat DevTools.
//   - Sama seperti essay-amplop: ini melindungi dari siswa biasa, bukan dari
//     penyerang yang menjalankan brute force sendiri terhadap amplop yang
//     sudah ada di perangkatnya. Ruang kode reset (7 karakter, alfabet 32
//     tanpa karakter ambigu) = 32^7 ≈ 3,4 × 10^10 kombinasi — jauh lebih
//     besar dari kode darurat essay (10^6) — dan PBKDF2 lambat di atasnya
//     menambah rem lagi. Cukup untuk mengamankan pelaksanaan ujian yang
//     berdurasi terbatas, bukan diklaim tahan-serangan tanpa batas waktu.

/** Versi format amplop reset — naikkan kalau format berubah. */
export const RESET_AMPLOP_VERSI = 1

/**
 * Iterasi PBKDF2-SHA256. Dipakai nilai yang sama dengan amplop essay supaya
 * biaya komputasi di perangkat siswa (yang bisa saja HP kelas menengah)
 * konsisten dan sudah teruji di produksi.
 */
export const RESET_PBKDF2_ITERASI = 600_000

/** Batas atas iterasi yang mau dijalankan client (jaga-jaga amplop rusak/berbahaya). */
export const RESET_PBKDF2_ITERASI_MAKS_CLIENT = 2_000_000

/** Amplop reset terenkripsi untuk SATU nomor (R1, R2, atau R3). Semua field biner base64. */
export interface ResetAmplop {
  v: number
  /** Nomor reset yang diwakili amplop ini (1..3). Ikut dicek di dalam plaintext (AAD saja tidak cukup karena AAD dibuat dari data yang sama, ini lapisan kedua). */
  nomor: number
  /** Salt PBKDF2 (bukan rahasia). */
  salt: string
  /** IV AES-GCM 12 byte. */
  iv: string
  /** Ciphertext DIGABUNG dengan tag otentikasi 16 byte di ujungnya. */
  ct: string
  /** Iterasi PBKDF2 yang dipakai saat membuat amplop ini. */
  iter: number
}

/** Isi (plaintext) amplop setelah didekripsi — sekadar bukti pengikatan, tidak ada data rahasia lain. */
export interface IsiAmplopReset {
  sesiId: string
  nis: string
  nomor: number
}

/** Additional Authenticated Data — mengikat amplop ke (sesi, siswa, nomor) supaya tidak bisa ditukar-tukar. */
export function aadAmplopReset(sesiId: string, nis: string, nomor: number): string {
  return `reset-amplop:v${RESET_AMPLOP_VERSI}:${sesiId}:${nis}:${nomor}`
}
