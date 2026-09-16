// src/lib/validasi-soal.ts
//
// FIX BUG (kunci jawaban tidak divalidasi server terhadap jumlah opsi):
// sebelumnya guru/soal/route.ts (POST) dan guru/soal/[id]/route.ts (PUT)
// memvalidasi bahwa TEKS opsi A-E terisi sesuai jumlah_opsi, tapi tidak
// pernah memvalidasi bahwa field `kunci` benar-benar salah satu huruf opsi
// yang valid untuk jumlah_opsi tersebut. Akibatnya request nakal / bug
// frontend bisa menyimpan soal dengan jumlah_opsi=4 tapi kunci='E', atau
// bahkan kunci='Z' — soal tetap tersimpan, dan mesin penilaian
// (hitungHasilPenilaian di penilaian-ujian.ts, `kunciMap[j.soal_id] ===
// j.jawaban`) akan SELALU menyalahkan semua siswa untuk soal itu karena
// tidak ada jawaban siswa yang bisa cocok dengan kunci yang tidak valid.
//
// Fungsi ini dipakai di endpoint pembuatan & pengeditan soal PG untuk
// menolak permintaan seperti itu di server, sebelum tersimpan.

const HURUF_OPSI = ['A', 'B', 'C', 'D', 'E'] as const

/**
 * Validasi bahwa `kunci` adalah salah satu huruf opsi yang valid untuk
 * `jumlahOpsi` (mis. jumlahOpsi=4 → hanya A/B/C/D yang valid, E ditolak).
 * Mengembalikan pesan error (string) kalau tidak valid, atau `null` kalau
 * valid — supaya pemanggil cukup menulis:
 *
 *   const err = validasiKunciOpsi(body.kunci, jumlahOpsi)
 *   if (err) return NextResponse.json({ error: err }, { status: 400 })
 */
export function validasiKunciOpsi(kunci: unknown, jumlahOpsi: number): string | null {
  const opsiValid = HURUF_OPSI.slice(0, Math.max(2, Math.min(5, jumlahOpsi || 4)))

  if (typeof kunci !== 'string' || !kunci.trim()) {
    return 'Kunci jawaban wajib diisi.'
  }

  const kunciNormal = kunci.trim().toUpperCase()

  if (!opsiValid.includes(kunciNormal as (typeof HURUF_OPSI)[number])) {
    return `Kunci jawaban harus salah satu dari ${opsiValid.join(', ')} (soal ini punya ${opsiValid.length} opsi), bukan "${kunci}".`
  }

  return null
}
