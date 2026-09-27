import { NextRequest, NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { requireRole, JWTPayload } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'
import { computeLiveLeaderboardUntukSesi, LiveLeaderboardSesi } from '@/lib/leaderboard-live'

// GET /api/layar-pantau/data
//
// Dipakai oleh halaman kios /layar-pantau sebagai MUATAN AWAL (render
// pertama, sebelum koneksi realtime tersambung) dan sebagai fallback kalau
// browser/jaringan tidak mendukung Server-Sent Events. Jalur update
// utamanya sekarang /api/layar-pantau/stream (realtime, lihat file itu).
//
// CATATAN: fungsi ambilBoardsUntukViewer() di bawah SENGAJA disalin persis
// sama di file ini dan di stream/route.ts (bukan diimpor dari satu modul
// bersama) — supaya proses deploy tidak bergantung pada satu file tambahan
// terpisah yang gampang salah taruh/salah isi saat dipindah manual. Kalau
// diubah, pastikan KEDUA salinan (di sini dan di stream/route.ts) diubah
// bersamaan, karena keduanya menentukan aturan otorisasi yang sama.
//
// SISWA ditolak eksplisit meski requireRole tidak otomatis melarangnya di
// sini — leaderboard live memuat nama + skor siswa lain, jadi akun siswa
// tidak boleh melihat papan kelas manapun lewat halaman ini.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const now = new Date()

  try {
    const { boards, scopeWarning } = await ambilBoardsUntukViewer(db, user)
    return NextResponse.json({ serverTime: now.toISOString(), viewer: viewerInfo(user), boards, scopeWarning })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memuat papan.' }, { status: 500 })
  }
}

function viewerInfo(user: { nama: string; role: string }) {
  return { nama: user.nama, role: user.role }
}

// ── Sesi mana yang boleh dilihat viewer ini + hitung papan live-nya ────────
type ViewerUser = Pick<JWTPayload, 'role' | 'username'>

// FITUR (pesan "UJIAN SELESAI" + hitung mundur di Layar Pantau, diminta
// user): sebelumnya query di sini HANYA mengambil sesi status BERJALAN —
// begitu pengawas menutup sesi (status → SELESAI), papan kelas itu langsung
// tidak ikut terambil sama sekali, sehingga lenyap dari layar TANPA pesan
// apa pun (lihat riwayat diskusi). Sekarang sesi yang BARU SAJA ditutup
// (waktu_selesai masih dalam JENDELA_TAMPIL_SETELAH_TUTUP_MS terakhir) tetap
// ikut diambil, supaya frontend (LiveLeaderboardBoard) bisa menampilkan
// overlay "UJIAN SELESAI" + hitung mundur 30 detik sebelum menyembunyikannya
// SENDIRI (client-side). Jendela di sini SENGAJA dibuat lebih longgar
// (40 detik) daripada hitung mundur yang dilihat user (30 detik) — cuma
// buffer keamanan supaya sesi tidak "kepotong" query sebelum hitung mundur
// client selesai (mis. kalau ada jeda jaringan/refresh sesaat).
const JENDELA_TAMPIL_SETELAH_TUTUP_MS = 40_000

function buildStatusFilter(): string {
  const cutoffIso = new Date(Date.now() - JENDELA_TAMPIL_SETELAH_TUTUP_MS).toISOString()
  return `status.eq.BERJALAN,and(status.eq.SELESAI,waktu_selesai.gte.${cutoffIso})`
}

async function ambilBoardsUntukViewer(
  db: SupabaseClient<any>,
  user: ViewerUser
): Promise<{ boards: LiveLeaderboardSesi[]; scopeWarning?: string }> {
  let sesiRows: {
    id: string; jadwal_id: string; mapel_id: string; kelas: string
    durasi: number | null; waktu_mulai: string; paket_soal_id: string | null; status: string
    waktu_selesai: string | null
  }[] = []

  const statusFilter = buildStatusFilter()
  const kolomSesi = 'id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status, waktu_selesai'

  if (user.role === 'GURU') {
    const { data: jadwalSaya, error: errJadwal } = await db
      .from('jadwal')
      .select('id')
      .eq('pengawas', user.username)
    if (errJadwal) throw new Error(errJadwal.message)

    const jadwalIds = (jadwalSaya ?? []).map((j: { id: string }) => j.id)
    if (jadwalIds.length === 0) return { boards: [] }

    const { data, error } = await db
      .from('sesi_ujian')
      .select(kolomSesi)
      .in('jadwal_id', jadwalIds)
      .or(statusFilter)
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
      .select(kolomSesi)
      .in('kelas', scope.kelasList)
      .or(statusFilter)
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  } else {
    const { data, error } = await db
      .from('sesi_ujian')
      .select(kolomSesi)
      .or(statusFilter)
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  }

  if (sesiRows.length === 0) return { boards: [] }

  const mapelIds = [...new Set(sesiRows.map(s => s.mapel_id))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const namaMapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

  const boards = (await Promise.all(
    sesiRows.map(s => computeLiveLeaderboardUntukSesi(db, s, namaMapelMap))
  )).filter((b): b is LiveLeaderboardSesi => b !== null)

  // Sesi yang masih BERJALAN didahulukan; sesi yang baru ditutup (tampil
  // sementara untuk pesan "UJIAN SELESAI") digeser ke belakang supaya tidak
  // mengganggu urutan kelas yang masih aktif dipantau.
  boards.sort((a, b) =>
    (a.statusSesi === 'SELESAI' ? 1 : 0) - (b.statusSesi === 'SELESAI' ? 1 : 0) ||
    a.kelas.localeCompare(b.kelas) ||
    a.namaMapel.localeCompare(b.namaMapel)
  )

  return { boards }
}
