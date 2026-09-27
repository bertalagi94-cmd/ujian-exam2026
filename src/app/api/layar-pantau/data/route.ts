import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'
import { computeLiveLeaderboardUntukSesi, LiveLeaderboardSesi } from '@/lib/leaderboard-live'

// GET /api/layar-pantau/data
//
// Dipakai HANYA oleh halaman kios /layar-pantau (lihat halaman itu untuk
// alur login). Endpoint ini SENGAJA memakai token JWT yang SAMA persis
// dengan yang dikeluarkan /api/auth/login biasa (GURU/KEPSEK/ADMIN) —
// tidak ada mekanisme login terpisah di server, supaya tidak ada jalur
// otentikasi kedua yang perlu diaudit terpisah. Yang membuat halaman ini
// terasa seperti "mode kios" murni ada di sisi client (tampilan
// full-screen, tanpa sidebar/menu dashboard biasa).
//
// SISWA ditolak eksplisit meski requireRole tidak otomatis melarangnya di
// sini — leaderboard live memuat nama + skor siswa lain, jadi akun siswa
// tidak boleh melihat papan kelas manapun lewat halaman ini.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const now = new Date()

  // ── 1. Tentukan sesi_ujian BERJALAN yang boleh dilihat role ini ─────────
  let sesiRows: {
    id: string; jadwal_id: string; mapel_id: string; kelas: string
    durasi: number | null; waktu_mulai: string; paket_soal_id: string | null; status: string
  }[] = []

  if (user.role === 'GURU') {
    // Sama seperti Mode Pengawas: hanya sesi dari jadwal yang pengawasnya
    // adalah guru ini sendiri. Sesi susulan yang diambil-alih admin untuk
    // guru LAIN sengaja tidak disertakan di sini (guru ini bukan yang
    // bertugas memantau sesi tersebut sekarang).
    const { data: jadwalSaya, error: errJadwal } = await db
      .from('jadwal')
      .select('id')
      .eq('pengawas', user.username)
    if (errJadwal) return NextResponse.json({ error: errJadwal.message }, { status: 500 })

    const jadwalIds = (jadwalSaya ?? []).map(j => j.id)
    if (jadwalIds.length === 0) {
      return NextResponse.json({ serverTime: now.toISOString(), viewer: viewerInfo(user), boards: [] })
    }

    const { data, error } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status')
      .in('jadwal_id', jadwalIds)
      .eq('status', 'BERJALAN')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    sesiRows = data ?? []
  } else if (user.role === 'KEPSEK') {
    const scope = await getKepsekScope(user.username)
    if (scope.noScope || scope.kelasList.length === 0) {
      return NextResponse.json({
        serverTime: now.toISOString(),
        viewer: viewerInfo(user),
        boards: [],
        scopeWarning: scope.noScope ? 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin.' : undefined,
      })
    }
    const { data, error } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status')
      .in('kelas', scope.kelasList)
      .eq('status', 'BERJALAN')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    sesiRows = data ?? []
  } else {
    // ADMIN: semua sesi yang sedang berjalan, tanpa batasan sekolah.
    const { data, error } = await db
      .from('sesi_ujian')
      .select('id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status')
      .eq('status', 'BERJALAN')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    sesiRows = data ?? []
  }

  if (sesiRows.length === 0) {
    return NextResponse.json({ serverTime: now.toISOString(), viewer: viewerInfo(user), boards: [] })
  }

  // ── 2. Nama mapel untuk semua sesi sekaligus ─────────────────────────────
  const mapelIds = [...new Set(sesiRows.map(s => s.mapel_id))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const namaMapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

  // ── 3. Hitung papan live untuk tiap sesi secara paralel ──────────────────
  const boards = (await Promise.all(
    sesiRows.map(s => computeLiveLeaderboardUntukSesi(db, s, namaMapelMap))
  )).filter((b): b is LiveLeaderboardSesi => b !== null)

  boards.sort((a, b) => a.kelas.localeCompare(b.kelas) || a.namaMapel.localeCompare(b.namaMapel))

  return NextResponse.json({ serverTime: now.toISOString(), viewer: viewerInfo(user), boards })
}

function viewerInfo(user: { nama: string; role: string }) {
  return { nama: user.nama, role: user.role }
}
