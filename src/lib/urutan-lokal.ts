// src/lib/urutan-lokal.ts
//
// Nomor urut KEJADIAN untuk antrean offline (pelanggaran + reset).
//
// MASALAH YANG DIPERBAIKI: antrean gabungan dulu diurutkan memakai `dibuatIso`
// (new Date() = jam perangkat). Kalau jam HP bergeser MUNDUR saat offline
// (sinkron waktu otomatis, atau sengaja diubah), R1 bisa terurut sebelum V1.
// Server menjawab "Tidak ada kode reset aktif" (retryable) untuk R1 karena V1
// belum tercatat, flush berhenti di R1, dan V1 tidak pernah terkirim: antrean
// macet permanen dan siswa tidak pernah terkunci di sisi server.
//
// SOLUSI: pengurutan tidak lagi bergantung pada jarum jam. Tiap kejadian
// diberi nomor `urut` yang SELALU NAIK, disimpan di localStorage (bertahan
// walau tab di-refresh) dan di memori (cadangan kalau localStorage mati).
//
//   urut = max(urut_terakhir + 1, Date.now())
//
// Selama jam normal, nilainya ~ waktu sebenarnya (tetap enak dibaca untuk
// audit). Kalau jam mundur, nilainya TIDAK ikut mundur: lanjut dari
// urut_terakhir + 1. Kalau semua penyimpanan gagal, perilakunya kembali ke
// Date.now() seperti sebelumnya (tidak lebih buruk dari versi lama).

const KUNCI = 'antreanUrutan:v1'
let terakhirDiMemori = 0

/** Nomor urut baru, dijamin lebih besar dari semua nomor urut yang pernah dikeluarkan di perangkat ini. */
export function urutanBerikutnya(): number {
  let tersimpan = 0
  try {
    const raw = localStorage.getItem(KUNCI)
    const n = raw ? Number(raw) : 0
    if (Number.isFinite(n) && n > 0) tersimpan = n
  } catch {
    // localStorage tidak tersedia: pakai memori saja.
  }
  const berikut = Math.max(tersimpan + 1, terakhirDiMemori + 1, Date.now())
  terakhirDiMemori = berikut
  try { localStorage.setItem(KUNCI, String(berikut)) } catch { /* abaikan */ }
  return berikut
}

/**
 * Nomor urut sebuah entri. Entri LAMA (dibuat sebelum patch ini) belum punya
 * field `urut`, jadi dipakai waktu `dibuatIso` sebagai cadangan.
 */
export function urutEntri(e: { urut?: number; dibuatIso: string }): number {
  return typeof e.urut === 'number' && Number.isFinite(e.urut) ? e.urut : (Date.parse(e.dibuatIso) || 0)
}
