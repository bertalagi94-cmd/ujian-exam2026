import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { ambilTargetSiswaSesi } from '@/lib/target-siswa-sesi'
import { ambilMaksReset, hitungSemuaKodeReset } from '@/lib/reset-berurutan'

// GET /api/pengawas/sesi/[id]/kode-reset
//
// Kode reset R1/R2/R3 untuk SEMUA siswa peserta sesi ini — disiapkan SEKALI
// saat pengawas membuka sesi (saat online), lalu disimpan di perangkat
// pengawas supaya tetap bisa dipakai walau internet mati (lihat halaman Mode
// Pengawas).
//
// Kode diturunkan HMAC (src/lib/reset-berurutan.ts), jadi tidak ada yang
// dibaca dari / ditulis ke database. Endpoint ini SATU-SATUNYA tempat kode
// reset keluar dari server, dan hanya untuk pengawas sah sesi (atau ADMIN).
// Kode TIDAK PERNAH dikirim ke perangkat siswa.
//
// Urutan R1 -> R2 -> R3 dan sekali-pakai tidak bergantung pada pengawas
// menampilkan kode "dalam urutan yang benar": server menolak kode di luar
// giliran (lihat verifikasi-reset). Menampilkan R3 lebih awal tidak berguna.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  if (auth.user.role === 'GURU') {
    // Sengaja versi TANPA cache: ini membuka rahasia, jangan andalkan keputusan lama.
    const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
    if (!sah) return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  const { data: sesi, error: sesiError } = await db
    .from('sesi_ujian')
    .select('id, status, kelas, is_darurat, siswa_diizinkan')
    .eq('id', sesiId)
    .maybeSingle()
  if (sesiError) return NextResponse.json({ error: sesiError.message }, { status: 500 })
  if (!sesi) return NextResponse.json({ error: 'Sesi ujian tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi sudah tidak berjalan.' }, { status: 409 })
  }

  const { data: siswaUjian, error } = await db
    .from('siswa_ujian')
    .select('nis, reset_terpakai')
    .eq('sesi_id', sesiId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const terpakaiMap = new Map((siswaUjian ?? []).map(s => [s.nis, s.reset_terpakai ?? 0]))
  const target = await ambilTargetSiswaSesi(db, sesi, [...terpakaiMap.keys()])
  const maksReset = await ambilMaksReset(db)

  let data
  try {
    data = target
      .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
      .map(s => ({
        nis: s.nis,
        nama: s.nama,
        kelas: s.kelas,
        kode: hitungSemuaKodeReset(sesiId, s.nis, maksReset), // [R1, R2, R3] (sepanjang maksReset)
        reset_terpakai: terpakaiMap.get(s.nis) ?? 0,
      }))
  } catch (e) {
    // Rahasia server belum diset / terlalu pendek. Jangan bocorkan detail.
    console.error('[kode-reset] gagal menghitung kode:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Kode reset belum dapat disiapkan. Hubungi admin.' }, { status: 500 })
  }

  const res = NextResponse.json({
    sesiId,
    maksReset,
    dibuatPada: new Date().toISOString(),
    data,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
