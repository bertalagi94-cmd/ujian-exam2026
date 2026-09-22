// src/lib/guru-scope.ts
//
// ── OTORISASI KEPEMILIKAN MAPEL/KELAS/PAKET UNTUK ENDPOINT GURU ────────────
//
// LATAR BELAKANG BUG (audit keamanan): beberapa endpoint guru (buat paket PG,
// buat paket essay, buat soal PG, buat kisi-kisi) menerima `mapel_id` dan
// `kelas_id` langsung dari body request lalu memakainya apa adanya untuk
// INSERT, TANPA memverifikasi bahwa mapel tersebut memang diampu guru yang
// login dan bahwa kelas tersebut memang termasuk kelas_list mapel itu.
// Frontend membatasi pilihan dropdown, tapi itu tidak cukup — guru yang
// mengirim request langsung (curl/devtools) bisa mengirim mapel_id/kelas_id
// milik guru lain dan server akan tetap memprosesnya (IDOR).
//
// Endpoint guru/paket/[id]/duplicate/route.ts SUDAH melakukan validasi yang
// benar (lihat komentar "FIX BUG" di file itu) — fungsi di bawah ini
// mengekstrak pola yang sama itu supaya dipakai konsisten di semua endpoint
// yang butuh validasi serupa, bukan mengubah logika yang sudah benar.
//
// PRINSIP FAIL-CLOSED: setiap query Supabase di sini memeriksa `error`. Kalau
// query gagal (bukan sekadar "tidak ketemu"), fungsi mengembalikan status 500
// dan endpoint pemanggil HARUS berhenti — jangan pernah menafsirkan error
// query sebagai "berarti bukan milik guru ini, tolak" ataupun "berarti boleh
// lanjut". Keduanya salah: yang benar adalah proses berhenti dan melaporkan
// error ke guru supaya dicoba lagi, bukan diam-diam menolak atau meloloskan.

import { createAdminClient } from '@/lib/supabase'

type DbClient = ReturnType<typeof createAdminClient>

export interface HasilVerifikasi {
  ok: boolean
  status: number
  error?: string
  /** Nama kelas (bukan id) — dikembalikan supaya pemanggil tidak perlu query ulang. */
  kelasNama?: string
}

function ok(kelasNama: string): HasilVerifikasi {
  return { ok: true, status: 200, kelasNama }
}

function gagal(status: number, error: string): HasilVerifikasi {
  return { ok: false, status, error }
}

/**
 * Pastikan `mapelId` benar-benar diampu oleh `guruUsername`, DAN `kelasId`
 * benar-benar termasuk dalam `kelas_list` mapel tersebut (dicocokkan lewat
 * nama kelas, karena `mapel.kelas_list` menyimpan nama, bukan id — lihat
 * skema di supabase/01_schema.sql).
 *
 * Dipakai SEBELUM insert/update apa pun yang menyimpan mapel_id+kelas_id
 * pilihan guru (buat paket PG, buat paket essay, buat soal, buat kisi-kisi).
 */
export async function verifikasiKepemilikanMapelKelas(
  db: DbClient,
  guruUsername: string,
  mapelId: unknown,
  kelasId: unknown
): Promise<HasilVerifikasi> {
  if (!mapelId || typeof mapelId !== 'string') {
    return gagal(400, 'Mata pelajaran wajib dipilih')
  }
  if (!kelasId || typeof kelasId !== 'string') {
    return gagal(400, 'Kelas wajib dipilih')
  }

  const { data: mapel, error: mapelError } = await db
    .from('mapel')
    .select('guru_id, kelas_list')
    .eq('id', mapelId)
    .maybeSingle()

  if (mapelError) {
    return gagal(500, `Gagal memverifikasi mata pelajaran: ${mapelError.message}`)
  }
  if (!mapel) {
    return gagal(404, 'Mata pelajaran tidak ditemukan')
  }
  if (mapel.guru_id !== guruUsername) {
    return gagal(403, 'Anda tidak mengampu mata pelajaran ini')
  }

  const { data: kelas, error: kelasError } = await db
    .from('kelas')
    .select('nama')
    .eq('id', kelasId)
    .maybeSingle()

  if (kelasError) {
    return gagal(500, `Gagal memverifikasi kelas: ${kelasError.message}`)
  }
  if (!kelas) {
    return gagal(404, 'Kelas tidak ditemukan')
  }

  const kelasDiMapel = (mapel.kelas_list ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)

  if (!kelasDiMapel.includes(String(kelas.nama))) {
    return gagal(403, 'Anda tidak mengampu mata pelajaran ini di kelas tersebut')
  }

  return ok(String(kelas.nama))
}

/**
 * Pastikan `paketId` (paket_soal) benar-benar milik `guruUsername` DAN
 * mapel_id/kelas_id paket tersebut cocok dengan mapel_id/kelas_id yang
 * sedang dipakai guru saat ini. Mencegah guru menyisipkan soal ke paket
 * milik guru lain (atau ke paket miliknya sendiri tapi untuk mapel/kelas
 * yang berbeda dari yang sedang divalidasi).
 *
 * `paketId` boleh kosong/null — dalam kasus itu fungsi mengembalikan ok
 * (soal tanpa paket_id tetap didukung, sesuai perilaku lama).
 */
export async function verifikasiKepemilikanPaketSoal(
  db: DbClient,
  guruUsername: string,
  paketId: unknown,
  mapelId: string,
  kelasId: string
): Promise<HasilVerifikasi> {
  if (!paketId) return ok('')
  if (typeof paketId !== 'string') return gagal(400, 'paket_id tidak valid')

  const { data: paket, error } = await db
    .from('paket_soal')
    .select('guru_id, mapel_id, kelas_id')
    .eq('id', paketId)
    .maybeSingle()

  if (error) {
    return gagal(500, `Gagal memverifikasi paket: ${error.message}`)
  }
  if (!paket) {
    return gagal(404, 'Paket tidak ditemukan')
  }
  if (paket.guru_id !== guruUsername) {
    return gagal(403, 'Paket tersebut bukan milik Anda')
  }
  if (paket.mapel_id !== mapelId || paket.kelas_id !== kelasId) {
    return gagal(400, 'Paket tidak sesuai dengan mata pelajaran/kelas yang dipilih')
  }

  return ok('')
}
