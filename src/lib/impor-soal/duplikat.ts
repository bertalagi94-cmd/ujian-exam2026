// ── DETEKSI SOAL DUPLIKAT SAAT IMPOR ────────────────────────────────────────
// Dipakai di browser (pratinjau ImporSoalModal) DAN di server (route impor)
// dengan aturan yang sama, supaya hasilnya konsisten.
//
// Dua soal dianggap sama bila teks soal + semua opsi + kunci sama setelah
// dinormalisasi (huruf kecil, spasi berlebih dibuang). Untuk essay: teks soal.
//
// Soal yang memakai GAMBAR tidak dicek (mengembalikan null): gambar belum
// diunggah saat pratinjau sehingga tidak bisa dibandingkan, dan soal yang
// teksnya sama tetapi gambarnya beda adalah soal yang berbeda.

function norm(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface BahanTandaPg {
  teks: unknown
  opsi: (unknown)[]      // teks opsi A.. sesuai jumlah opsi paket
  kunci: unknown
  adaGambar: boolean
}

export function tandaPg(b: BahanTandaPg): string | null {
  if (b.adaGambar) return null
  const t = norm(b.teks)
  if (!t) return null
  return ['pg', t, ...b.opsi.map(norm), norm(b.kunci)].join('\u0001')
}

export function tandaEssay(teks: unknown, adaGambar: boolean): string | null {
  if (adaGambar) return null
  const t = norm(teks)
  return t ? `essay\u0001${t}` : null
}

/** Tanda soal PG dari baris tabel `soal` di database. */
export function tandaPgDariDb(r: Record<string, unknown>, jumlahOpsi: number): string | null {
  const h = ['a', 'b', 'c', 'd', 'e'].slice(0, jumlahOpsi)
  const adaGambar = !!r.gambar_pertanyaan || h.some(x => !!r[`gambar_opsi_${x}`])
  return tandaPg({ teks: r.teks, opsi: h.map(x => r[`opsi_${x}`]), kunci: r.kunci, adaGambar })
}

/** Tanda soal essay dari baris tabel `soal_essay`. */
export function tandaEssayDariDb(r: Record<string, unknown>): string | null {
  return tandaEssay(r.teks, !!r.gambar_url)
}
