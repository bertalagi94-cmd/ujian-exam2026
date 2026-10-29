// GET /api/developer/monitor — monitor server GLOBAL (semua sekolah), khusus developer.
//
// Dinding keamanan Panel Developer tetap dijaga: hanya metrik sistem dan HITUNGAN
// agregat (sesi berjalan, siswa aktif, login). Tidak ada nama siswa, jawaban,
// nilai, atau daftar pelanggaran.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/developer-auth'
import {
  WINDOW_MENIT, JENDELA_HISTORI_MENIT, hitungStatusServer, bucketHistori, type Baris,
} from '@/lib/status-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = Date.now()
  const windowAwal = now - WINDOW_MENIT * 60 * 1000
  const historiAwal = new Date(now - JENDELA_HISTORI_MENIT * 60 * 1000).toISOString()
  const duaPuluhEmpatJam = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  // Latensi DB nyata: waktu seluruh query paralel di bawah (sama seperti versi lama).
  const dbStart = Date.now()
  const [metrik, sesi, yayasan, login24, maint] = await Promise.all([
    db.from('metrik_sistem').select('endpoint, status, durasi_ms, created_at')
      .gte('created_at', historiAwal).order('created_at', { ascending: false }).limit(5000),
    db.from('sesi_ujian').select('id, yayasan_id').eq('status', 'BERJALAN'),
    db.from('yayasan').select('id, nama, status').order('nama'),
    db.from('log_aktivitas').select('id', { count: 'exact', head: true })
      .eq('aksi', 'LOGIN').gte('created_at', duaPuluhEmpatJam),
    db.from('pengaturan').select('yayasan_id, value').eq('key', 'maintenanceAktif'),
  ])
  const dbResponseMs = Date.now() - dbStart

  const err = metrik.error ?? sesi.error ?? yayasan.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  const semua: Baris[] = (metrik.data ?? []) as Baris[]
  const server = hitungStatusServer(
    semua.filter(b => new Date(b.created_at).getTime() >= windowAwal),
    dbResponseMs
  )
  const histori = bucketHistori(semua, now)

  // Ringkasan per sekolah: hanya hitungan.
  const sesiPerYayasan = new Map<string, string[]>()
  for (const s of (sesi.data ?? []) as any[]) {
    const k = String(s.yayasan_id)
    if (!sesiPerYayasan.has(k)) sesiPerYayasan.set(k, [])
    sesiPerYayasan.get(k)!.push(String(s.id))
  }
  const maintenanceAktif = new Set(
    ((maint.data ?? []) as any[]).filter(r => r.value === 'true').map(r => String(r.yayasan_id))
  )

  const sekolah = await Promise.all(((yayasan.data ?? []) as any[]).map(async y => {
    const ids = sesiPerYayasan.get(String(y.id)) ?? []
    let siswaAktif = 0
    if (ids.length) {
      const { count } = await db.from('siswa_ujian')
        .select('id', { count: 'exact', head: true }).eq('status', 'AKTIF').in('sesi_id', ids)
      siswaAktif = count ?? 0
    }
    return {
      id: y.id, nama: y.nama, status: y.status,
      sesiBerjalan: ids.length, siswaAktif,
      maintenance: maintenanceAktif.has(String(y.id)),
    }
  }))

  return NextResponse.json({
    server: { ...server, windowMenit: WINDOW_MENIT, timestamp: new Date(now).toISOString() },
    histori,
    total: {
      sesiBerjalan: sekolah.reduce((a, s) => a + s.sesiBerjalan, 0),
      siswaAktif: sekolah.reduce((a, s) => a + s.siswaAktif, 0),
      login24Jam: login24.count ?? 0,
    },
    sekolah,
  })
}
