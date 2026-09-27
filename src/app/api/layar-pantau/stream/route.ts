// src/lib/layar-pantau-boards.ts
//
// ── SUMBER TUNGGAL LOGIKA "SESI MANA YANG BOLEH DILIHAT VIEWER INI" ─────────
//
// Sebelumnya logika ini hidup langsung di dalam
// src/app/api/layar-pantau/data/route.ts. Sekarang dipisah ke sini supaya
// endpoint polling lama (/api/layar-pantau/data) DAN endpoint realtime baru
// (/api/layar-pantau/stream) memanggil fungsi YANG SAMA PERSIS — tidak ada
// risiko dua salinan aturan otorisasi yang diam-diam berbeda seiring waktu.
//
// Prinsip keamanan dari leaderboard-live.ts tetap berlaku di sini: fungsi
// ini hanya mengembalikan LiveLeaderboardSesi (agregat), tidak pernah
// kunci jawaban maupun baris jawaban mentah.

import { SupabaseClient } from '@supabase/supabase-js'
import { JWTPayload } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'
import { computeLiveLeaderboardUntukSesi, LiveLeaderboardSesi } from '@/lib/leaderboard-live'

export interface BoardsUntukViewerResult {
  boards: LiveLeaderboardSesi[]
  scopeWarning?: string
}

type ViewerUser = Pick<JWTPayload, 'role' | 'username'>

export async function ambilBoardsUntukViewer(
  db: SupabaseClient<any>,
  user: ViewerUser
): Promise<BoardsUntukViewerResult> {
  // ── 1. Tentukan sesi_ujian BERJALAN yang boleh dilihat role ini ─────────
  let sesiRows: {
    id: string; jadwal_id: string; mapel_id: string; kelas: string
    durasi: number | null; waktu_mulai: string; paket_soal_id: string | null; status: string
  }[] = []

  if (user.role === 'GURU') {
    // Sama seperti Mode Pengawas: hanya sesi dari jadwal yang pengawasnya
    // adalah guru ini sendiri.
    const { data: jadwalSaya, error: errJadwal } = await db
      .from('jadwal')
      .select('id')
      .eq('pengawas', user.username)
    if (errJadwal) throw new Error(errJadwal.message)

    const jadwalIds = (jadwalSaya ?? []).map((j: { id: string }) => j.id)
    if (jadwalIds.length === 0) return { boards: [] }

    const { data, error } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status')
      .in('jadwal_id', jadwalIds)
      .eq('status', 'BERJALAN')
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  } else if (user.role === 'KEPSEK') {
    const scope = await getKepsekScope(user.username)
    if (scope.noScope || scope.kelasList.length === 0) {
      return {
        boards: [],
        scopeWarning: scope.noScope ? 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin.' : undefined,
      }
    }
    const { data, error } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status')
      .in('kelas', scope.kelasList)
      .eq('status', 'BERJALAN')
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  } else {
    // ADMIN: semua sesi yang sedang berjalan, tanpa batasan sekolah.
    const { data, error } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status')
      .eq('status', 'BERJALAN')
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  }

  if (sesiRows.length === 0) return { boards: [] }

  // ── 2. Nama mapel untuk semua sesi sekaligus ─────────────────────────────
  const mapelIds = [...new Set(sesiRows.map(s => s.mapel_id))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const namaMapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

  // ── 3. Hitung papan live untuk tiap sesi secara paralel ──────────────────
  const boards = (await Promise.all(
    sesiRows.map(s => computeLiveLeaderboardUntukSesi(db, s, namaMapelMap))
  )).filter((b): b is LiveLeaderboardSesi => b !== null)

  boards.sort((a, b) => a.kelas.localeCompare(b.kelas) || a.namaMapel.localeCompare(b.namaMapel))

  return { boards }
}

/** Daftar sesi_id yang sedang relevan bagi viewer ini — dipakai stream route
 *  untuk tahu kapan perlu recompute tanpa menghitung papan penuh dulu. */
export function idSesiDariBoards(boards: LiveLeaderboardSesi[]): string[] {
  return boards.map(b => b.sesiId)
}
