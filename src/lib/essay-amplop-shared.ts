// src/lib/essay-amplop-shared.ts
//
// Konstanta & tipe yang dipakai BERSAMA oleh sisi server
// (essay-amplop-server.ts, node:crypto) dan sisi client
// (essay-amplop-client.ts, WebCrypto). File ini sengaja tidak meng-import
// apa pun supaya aman di-bundle ke browser.
//
// Lihat supabase/19_essay_amplop_offline.sql untuk gambaran desain lengkap.

/** Versi format amplop — naikkan kalau format berubah supaya client lama bisa menolak dengan pesan jelas. */
export const AMPLOP_VERSI = 1

/**
 * Jumlah iterasi PBKDF2-SHA256. Ini satu-satunya "rem" terhadap tebak-kode
 * offline (brute force terhadap amplop yang sudah ada di perangkat siswa).
 * 600.000 = rekomendasi OWASP untuk PBKDF2-HMAC-SHA256; di HP kelas
 * menengah kira-kira 0,3–1,5 detik sekali coba.
 * Nilai ini ikut disimpan di dalam amplop (`iter`), jadi mengubahnya di sini
 * tidak merusak amplop yang sudah terlanjur terkirim.
 */
export const PBKDF2_ITERASI = 600_000

/** Batas atas iterasi yang mau dijalankan client (jaga-jaga amplop rusak/berbahaya membuat HP hang). */
export const PBKDF2_ITERASI_MAKS_CLIENT = 2_000_000

/**
 * Jumlah digit kode darurat.
 *
 * CATATAN KEAMANAN (baca sebelum mengecilkan nilai ini): siapa pun yang
 * memegang amplop (siswa bisa melihatnya di tab Network / localStorage) bisa
 * mencoba SEMUA kode secara offline dengan tool sendiri, tanpa lewat UI kita.
 * KDF yang lambat hanya memperlambat, tidak mencegah. Ruang kode 10^N:
 *   - 4 digit  = 10.000 kombinasi    → praktis hancur dalam hitungan detik–menit
 *                                       di laptop/GPU yang niat.
 *   - 6 digit  = 1.000.000 kombinasi → butuh waktu jauh lebih lama; cukup untuk
 *                                       menghalangi siswa biasa selama ujian,
 *                                       tapi bukan tahan terhadap penyerang serius.
 * 6 digit masih mudah dibacakan/ditulis di papan. Ubah ke 4 kalau
 * kemudahan lebih penting daripada ketahanan.
 */
export const PANJANG_KODE_DARURAT = 6

/** Maksimum kali kode boleh dikirim ke server /essay/mulai per siswa per sesi. */
export const MAKS_PERCOBAAN_SERVER = 10

/** Amplop terenkripsi — semua field biner di-encode base64. */
export interface EssayAmplop {
  v: number
  /** Salt PBKDF2 (bukan rahasia). */
  salt: string
  /** IV AES-GCM 12 byte. */
  iv: string
  /** Ciphertext DIGABUNG dengan tag otentikasi 16 byte di ujungnya (format yang diharapkan WebCrypto). */
  ct: string
  /** Iterasi PBKDF2 yang dipakai saat membuat amplop ini. */
  iter: number
}

/** Isi (plaintext) amplop setelah didekripsi. */
export interface IsiAmplopEssay {
  info: {
    namaMapel: string
    namaGuru: string | null
    jumlahSoal: number
    durasiMenit: number
    modeJawaban: 'DIGITAL' | 'KERTAS'
    instruksi: string | null
  }
  // FIX (audit: gambar essay gagal dimuat saat offline murni/kode darurat):
  // `gambar_url` saja TIDAK CUKUP untuk jalur offline. URL itu memang
  // ada di amplop sejak awal PG (lihat essay/amplop/route.ts), tapi ISI
  // gambarnya (byte-nya) sengaja BARU boleh diunduh setelah amplop dibuka —
  // dan pada saat itu, kalau siswa memakai kode darurat, internet memang
  // sudah mati total (itulah alasan kode darurat dipakai). Akibatnya
  // precacheGambarSoal() tidak pernah punya kesempatan mengunduh gambar
  // essay sama sekali di jalur offline murni.
  // Perbaikannya: sertakan BYTE gambar (data URL base64) di dalam amplop
  // terenkripsi itu sendiri — aman karena seluruh amplop sudah terenkripsi
  // AES-256-GCM, jadi menambah data di dalamnya tidak menambah risiko baru.
  // `gambar_data` null berarti soal tidak bergambar ATAU pengambilan gambar
  // di server gagal/kelewat besar (lihat ambilGambarSebagaiDataUrl) — dalam
  // kasus itu jalur online (gambar_url + precacheGambarSoal) tetap jadi
  // cadangan seperti sebelumnya.
  soal: { id: string; teks: string; gambar_url: string | null; gambar_data: string | null; urutan: number }[]
}

/** Additional Authenticated Data — mengikat amplop ke sesi tertentu supaya tidak bisa ditukar antar sesi. */
export function aadAmplop(sesiId: string): string {
  return `essay-amplop:v${AMPLOP_VERSI}:${sesiId}`
}
