import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

type AnyRow = Record<string, unknown>

function pickData(res: { data: AnyRow[] | null }): AnyRow[] {
  return res.data ?? []
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const since5m  = new Date(now.getTime() -  5 * 60 * 1000).toISOString()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const todayStr = now.toISOString().split('T')[0]

  const t0 = Date.now()

  const [r0, r1, r2, r3] = await Promise.all([
    db.from('log_aktivitas')
      .select('id, user_id, aksi, detail, created_at')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(pickData).catch(() => [] as AnyRow[]),

    db.from('sesi_ujian')
      .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta, status')
      .eq('status', 'BERJALAN')
      .order('waktu_mulai', { ascending: false })
      .then(pickData).catch(() => [] as AnyRow[]),

    db.from('pelanggaran')
      .select('id, nis, jenis, created_at')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(pickData).catch(() => [] as AnyRow[]),

    db.from('jadwal')
      .select('id, mapel_id, kelas, jam_mulai, jam_selesai, status')
      .eq('tanggal', todayStr)
      .in('status', ['BERJALAN', 'AKTIF'])
      .then(pickData).catch(() => [] as AnyRow[]),
  ])

  const dbResponseMs = Date.now() - t0

  const allLogs    = r0 as { id: string; user_id: string; aksi: string; detail: string; created_at: string }[]
  const sesiAktif  = r1 as { id: string; kelas: string; mapel_id: string; waktu_mulai: string; jumlah_peserta: number }[]
  const pelanggaran = r2 as { id: string; nis: string; jenis: string; created_at: string }[]
  const ujianBerjalan = r3

  const loginHariIni = allLogs.filter(l => l.aksi === 'LOGIN' && l.created_at >= todayStr).length
  const aktifitas5m  = allLogs.filter(l => l.created_at >= since5m).length
  const logs         = allLogs.slice(0, 30)
  const sesiCount    = sesiAktif.length

  let serverStatus: 'AMAN' | 'NORMAL' | 'WASPADA' | 'BERAT' | 'KRITIS'
  let serverScore: number

  if      (dbResponseMs < 200  && sesiCount <= 3  && aktifitas5m <= 20)  { serverStatus = 'AMAN';    serverScore = 10 }
  else if (dbResponseMs < 500  && sesiCount <= 8  && aktifitas5m <= 50)  { serverStatus = 'NORMAL';  serverScore = 35 }
  else if (dbResponseMs < 1000 && sesiCount <= 15 && aktifitas5m <= 100) { serverStatus = 'WASPADA'; serverScore = 60 }
  else if (dbResponseMs < 2000)                                           { serverStatus = 'BERAT';   serverScore = 80 }
  else                                                                    { serverStatus = 'KRITIS';  serverScore = 95 }

  return NextResponse.json({
    server: { status: serverStatus, score: serverScore, dbResponseMs, timestamp: now.toISOString() },
    aktivitas: { loginHariIni, aktifitas5MenitTerakhir: aktifitas5m, sesiUjianAktif: sesiCount, pelanggaranHariIni: pelanggaran.length },
    logs,
    sesiAktif,
    ujianHariIni: ujianBerjalan,
    pelanggaran: pelanggaran.slice(0, 5),
  })
}
