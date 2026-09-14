import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/siswa/ujian/cek-sesi?sesiId=xxx&deviceId=yyy
// Digunakan siswa untuk polling apakah sesi masih BERJALAN atau sudah SELESAI.
// Sekaligus memperbarui last_heartbeat (bukti device masih aktif) dan mendeteksi
// kalau device lain telah mengambil alih sesi ini.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  const deviceId = searchParams.get('deviceId')

  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const [{ data: sesi }, { data: siswaUjian }] = await Promise.all([
    db.from('sesi_ujian').select('id, status').eq('id', sesiId).single(),
    db.from('siswa_ujian')
      .select('status, device_id')
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
      .single(),
  ])

  if (!sesi) return NextResponse.json({ sesi_status: 'TIDAK_DITEMUKAN' })

  // ── Deteksi device takeover ───────────────────────────────────────────────
  // Kalau device_id di DB berbeda dari yang mengirim request ini, berarti
  // device lain sudah login dan mengambil alih sesi ini. Device ini harus berhenti.
  //
  // FIX BUG (anti-device bisa dilewati dengan tidak mengirim deviceId): lihat
  // penjelasan lengkap di sync/route.ts — pola yang sama persis ada di sini.
  // Sekarang deteksi berjalan begitu ada device_id terdaftar di DB, tidak
  // peduli apakah request ini mengirim deviceId atau tidak.
  if (siswaUjian?.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json({
      sesi_status: sesi.status,
      siswa_status: siswaUjian?.status ?? 'TIDAK_TERDAFTAR',
      diambil_alih_device_lain: true,
    })
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Perbarui heartbeat — bukti device ini masih aktif mengerjakan ujian
  if (deviceId && siswaUjian?.status === 'AKTIF') {
    await db
      .from('siswa_ujian')
      .update({ last_heartbeat: new Date().toISOString() })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
  }

  return NextResponse.json({
    sesi_status: sesi.status,
    siswa_status: siswaUjian?.status ?? 'TIDAK_TERDAFTAR',
  })
}
