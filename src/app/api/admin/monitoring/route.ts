import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

type LogRow = { id: string; user_id: string; aksi: string; detail: string; created_at: string }
type SesiRow = { id: string; kelas: string; mapel_id: string; waktu_mulai: string; jumlah_peserta: number; status: string }
type PelanggaranRow = { id: string; nis: string; jenis: string; created_at: string }
type JadwalRow = { id: string; mapel_id: string; kelas: string; jam_mulai: string; jam_selesai: string; status: string }

async function safeQuery<T>(promise: Promise<{ data: T | null; error: unknown }>, timeoutMs = 5000): Promise<T[]> {
  try {
    const result = await Promise.race([
      promise,
      new Promise<{ data: null; error: string }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ])
    return (result.data ?? []) as T[]
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const since5m   = new Date(now.getTime() -  5 * 60 * 1000).toISOString()
  const since24h  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const todayStr  = now.toISOString().split('T')[0]

  const t0 = Date.now()

  // ── 4 query paralel (sebelumnya 6, dengan 3 duplikat ke log_aktivitas) ──
  const [allLogs, sesiAktif, pelanggaran, ujianBerjalan] = await Promise.all([
    // SATU query log_aktivitas 24 jam — turunannya dihitung di JS
    safeQuery<LogRow>(
      db.from('log_aktivitas')
        .select('id, user_id, aksi, detail, created_at')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(200)
    ),
    safeQuery<SesiRow>(
      db.from('sesi_ujian')
        .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta, status')
        .eq('status', 'BERJALAN')
        .order('waktu_mulai', { ascending: false })
    ),
    safeQuery<PelanggaranRow>(
      db.from('pelanggaran')
        .select('id, nis, jenis, created_at')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(10)
    ),
    safeQuery<JadwalRow>(
      db.from('jadwal')
        .select('id, mapel_id, kelas, jam_mulai, jam_selesai, status')
        .eq('tanggal', todayStr)
        .in('status', ['BERJALAN', 'AKTIF'])
    ),
  ])

  const dbResponseMs = Date.now() - t0

  // Hitung turunan dari satu query log_aktivitas
  const loginHariIni = allLogs.filter(l => l.aksi === 'LOGIN' && l.created_at >= todayStr).length
  const aktifitas5m  = allLogs.filter(l => l.created_at >= since5m).length
  const logs         = allLogs.slice(0, 30)
  const sesiCount    = sesiAktif.length

  // Status server
  let serverStatus: 'AMAN' | 'NORMAL' | 'WASPADA' | 'BERAT' | 'KRITIS'
  let serverScore: number

  if      (dbResponseMs < 200  && sesiCount <= 3  && aktifitas5m <= 20)  { serverStatus = 'AMAN';    serverScore = 10 }
  else if (dbResponseMs < 500  && sesiCount <= 8  && aktifitas5m <= 50)  { serverStatus = 'NORMAL';  serverScore = 35 }
  else if (dbResponseMs < 1000 && sesiCount <= 15 && aktifitas5m <= 100) { serverStatus = 'WASPADA'; serverScore = 60 }
  else if (dbResponseMs < 2000)                                           { serverStatus = 'BERAT';   serverScore = 80 }
  else                                                                    { serverStatus = 'KRITIS';  serverScore = 95 }

  return NextResponse.json({
    server: { status: serverStatus, score: serverScore, dbResponseMs, timestamp: now.toISOString() },
    aktivitas: {
      loginHariIni,
      aktifitas5MenitTerakhir: aktifitas5m,
      sesiUjianAktif: sesiCount,
      pelanggaranHariIni: pelanggaran.length,
    },
    logs,
    sesiAktif,
    ujianHariIni: ujianBerjalan,
    pelanggaran: pelanggaran.slice(0, 5),
  })
}
