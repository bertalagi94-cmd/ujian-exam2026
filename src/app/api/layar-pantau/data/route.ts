import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { ambilBoardsUntukViewer } from '@/lib/layar-pantau-boards'

// GET /api/layar-pantau/data
//
// Dipakai oleh halaman kios /layar-pantau sebagai MUATAN AWAL (render
// pertama, sebelum koneksi realtime tersambung) dan sebagai fallback kalau
// browser/jaringan tidak mendukung Server-Sent Events. Jalur update
// utamanya sekarang /api/layar-pantau/stream (realtime, lihat file itu).
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
