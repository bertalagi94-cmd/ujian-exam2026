import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000)

  const dbStart = Date.now()
  const [
    { data: logs },
    { data: sesiAktif },
    { data: pelanggaran },
    { count: loginHariIni },
    { count: aktifitas5Menit },
    { count: sesiUjianAktif },
    { count: pelanggaranHariIni },
  ] = await Promise.all([
    db.from('log_aktivitas')
      .select('id, user_id, aksi, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('sesi_ujian')
      .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta')
      .eq('status', 'BERLANGSUNG')
      .order('waktu_mulai', { ascending: false }),
    db.from('pelanggaran')
      .select('id, nis, jenis, created_at')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('log_aktivitas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString())
      .eq('aksi', 'LOGIN'),
    db.from('log_aktivitas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinsAgo.toISOString()),
    db.from('sesi_ujian')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'BERLANGSUNG'),
    db.from('pelanggaran')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString()),
  ])

  const dbResponseMs = Date.now() - dbStart

  const sesiCount = sesiUjianAktif ?? 0
  const score = Math.min(
    100,
    Math.round(
      (sesiCount / 20) * 40 +
      ((aktifitas5Menit ?? 0) / 100) * 30 +
      ((pelanggaranHariIni ?? 0) / 5) * 30
    )
  )

  const status =
    score >= 80 ? 'KRITIS' :
    score >= 60 ? 'BERAT' :
    score >= 40 ? 'WASPADA' :
    score >= 20 ? 'NORMAL' : 'AMAN'

  return NextResponse.json({
    server: {
      status,
      score,
      dbResponseMs,
      timestamp: now.toISOString(),
    },
    aktivitas: {
      loginHariIni: loginHariIni ?? 0,
      aktifitas5MenitTerakhir: aktifitas5Menit ?? 0,
      sesiUjianAktif: sesiCount,
      pelanggaranHariIni: pelanggaranHariIni ?? 0,
    },
    logs: logs ?? [],
    sesiAktif: sesiAktif ?? [],
    pelanggaran: pelanggaran ?? [],
  })
}
