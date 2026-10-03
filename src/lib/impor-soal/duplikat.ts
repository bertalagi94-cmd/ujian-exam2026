// ── DETEKSI SOAL DUPLIKAT SAAT IMPOR ────────────────────────────────────────
// Dipakai di browser (pratinjau ImporSoalModal) DAN di server (route impor)
// dengan aturan yang sama, supaya hasilnya konsisten.
//
// Dua soal dianggap sama bila teks soal + semua opsi + kunci sama setelah
// dinormalisasi (huruf kecil, spasi berlebih dibuang). Untuk essay: teks soal.
//
// Gambar TIDAK ikut dibandingkan (gambar baru diunggah saat tombol Impor
// ditekan), tetapi soal bergambar tetap dicek lewat teks soal + teks opsi +
// kunci. Soal yang benar-benar tanpa teks sama sekali (soal dan semua opsinya
// hanya gambar) tidak bisa dicek (mengembalikan null).

function norm(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface BahanTandaPg {
  teks: unknown
  opsi: (unknown)[]      // teks opsi A.. sesuai jumlah opsi paket
  kunci: unknown
}

export function tandaPg(b: BahanTandaPg): string | null {
  const bagian = [norm(b.teks), ...b.opsi.map(norm)]
  if (bagian.every(x => !x)) return null // tidak ada teks sama sekali
  return ['pg', ...bagian, norm(b.kunci)].join('\u0001')
}

export function tandaEssay(teks: unknown): string | null {
  const t = norm(teks)
  return t ? `essay\u0001${t}` : null
}

/** Tanda soal PG dari baris tabel `soal` di database. */
export function tandaPgDariDb(r: Record<string, unknown>, jumlahOpsi: number): string | null {
  const h = ['a', 'b', 'c', 'd', 'e'].slice(0, jumlahOpsi)
  return tandaPg({ teks: r.teks, opsi: h.map(x => r[`opsi_${x}`]), kunci: r.kunci })
}

/** Tanda soal essay dari baris tabel `soal_essay`. */
export function tandaEssayDariDb(r: Record<string, unknown>): string | null {
  return tandaEssay(r.teks)
}
