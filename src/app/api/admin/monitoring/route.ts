import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Timeout helper — bungkus promise dengan batas waktu
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
    ),
  ])
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const since5m = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const todayStr = now.toISOString().split('T')[0]

  const t0 = Date.now()

  // ── Ambil log_aktivitas SEKALI, lalu hitung turunannya di sisi server ──
  // Sebelumnya ada 3 query ke log_aktivitas (logs, loginHariIni, aktifitasBaru).
  // Sekarang digabung jadi 1 query dengan filter paling luas (24 jam),
  // lalu dihitung di JS — jauh lebih cepat.
  const [
    { data: logAktivitas, error: logErr },
    { data: sesiAktif },
    { data: pelanggaran },
    { data: ujianBerjalan },
  ] = await Promise.all([
    // SATU query log_aktivitas 24 jam terakhir (menggantikan 3 query sebelumnya)
    withTimeout(
      db.from('log_aktivitas')
        .select('id, user_id, aksi, detail, created_at')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(200),
      5000
    ).catch(() => ({ data: null as null, error: 'timeout' as string })),

    // sesi ujian yang sedang berjalan
    withTimeout(
      db.from('sesi_ujian')
        .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta, status')
        .eq('status', 'BERJALAN')
        .order('waktu_mulai', { ascending: false }),
      5000
    ).catch(() => ({ data: null as null })),

    // pelanggaran terbaru (24 jam)
    withTimeout(
      db.from('pelanggaran')
        .select('id, nis, jenis, created_at')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(10),
      5000
    ).catch(() => ({ data: null as null })),

    // jadwal ujian berjalan hari ini
    withTimeout(
      db.from('jadwal')
        .select('id, mapel_id, kelas, jam_mulai, jam_selesai, status')
        .eq('tanggal', todayStr)
        .in('status', ['BERJALAN', 'AKTIF']),
      5000
    ).catch(() => ({ data: null as null })),
  ])

  const dbResponseMs = Date.now() - t0

  // Hitung turunan dari satu query log_aktivitas
  const allLogs = (logAktivitas ?? []) as { id: string; user_id: string; aksi: string; detail: string; created_at: string }[]
  const loginHariIni = allLogs.filter(l => l.aksi === 'LOGIN' && l.created_at >= todayStr).length
  const aktifitas5m   = allLogs.filter(l => l.created_at >= since5m).length
  const logs          = allLogs.slice(0, 30) // 30 terbaru untuk tab log

  // Hitung status server berdasarkan response time DB dan beban aktif
  const sesiCount = (sesiAktif ?? []).length

  let serverStatus: 'AMAN' | 'NORMAL' | 'WASPADA' | 'BERAT' | 'KRITIS'
  let serverScore: number // 0-100

  if (dbResponseMs < 200 && sesiCount <= 3 && aktifitas5m <= 20) {
    serverStatus = 'AMAN'; serverScore = 10
  } else if (dbResponseMs < 500 && sesiCount <= 8 && aktifitas5m <= 50) {
    serverStatus = 'NORMAL'; serverScore = 35
  } else if (dbResponseMs < 1000 && sesiCount <= 15 && aktifitas5m <= 100) {
    serverStatus = 'WASPADA'; serverScore = 60
  } else if (dbResponseMs < 2000) {
    serverStatus = 'BERAT'; serverScore = 80
  } else {
    serverStatus = 'KRITIS'; serverScore = 95
  }

  return NextResponse.json({
    server: {
      status: serverStatus,
      score: serverScore,
      dbResponseMs,
      timestamp: now.toISOString(),
    },
    aktivitas: {
      loginHariIni: loginHariIni ?? 0,
      aktifitas5MenitTerakhir: aktifitas5m,
      sesiUjianAktif: sesiCount,
      pelanggaranHariIni: (pelanggaran ?? []).length,
    },
    logs,
    sesiAktif: sesiAktif ?? [],
    ujianHariIni: ujianBerjalan ?? [],
    pelanggaran: (pelanggaran ?? []).slice(0, 5),
  })
}
