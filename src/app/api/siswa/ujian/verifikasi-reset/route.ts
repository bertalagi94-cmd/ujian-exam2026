import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/siswa/ujian/verifikasi-reset
// Body: { sesiId: string, kodeReset: string }
// Siswa memasukkan kode 7 digit dari pengawas untuk melanjutkan ujian.
// FIX: waktu_mulai TIDAK direset — timer tetap berjalan dari waktu awal masuk.
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, kodeReset } = await req.json()

  if (!kodeReset?.trim()) {
    return NextResponse.json({ valid: false, message: 'Masukkan kode reset dari pengawas' })
  }

  // Cek apakah sesi masih aktif
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, status')
    .eq('id', sesiId)
    .single()

  if (!sesi || sesi.status !== 'BERJALAN') {
    return NextResponse.json({ valid: false, message: 'Sesi ujian sudah ditutup.' })
  }

  // Cek status siswa + ambil waktu_mulai_awal sekaligus
  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal, waktu_mulai')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (siswaUjian?.status === 'TERKUNCI') {
    return NextResponse.json({ valid: false, message: 'Akun Anda dikunci permanen. Hubungi pengawas.' })
  }

  // Cari kode reset yang valid (belum digunakan) untuk siswa ini
  const { data: logReset } = await db
    .from('log_reset')
    .select('id, password_baru')
    .eq('nis', user.nis!)
    .eq('digunakan', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!logReset) {
    return NextResponse.json({ valid: false, message: 'Tidak ada kode reset aktif. Hubungi pengawas.' })
  }

  if (logReset.password_baru.toUpperCase() !== kodeReset.trim().toUpperCase()) {
    return NextResponse.json({ valid: false, message: 'Kode reset salah. Cek kembali kode dari pengawas.' })
  }

  // Kode valid — tandai sudah digunakan
  await db.from('log_reset')
    .update({ digunakan: true })
    .eq('id', logReset.id)

  // FIX: Aktifkan kembali siswa TANPA mengubah waktu_mulai
  // Timer tetap berjalan dari waktu awal masuk, bukan dari sekarang
  await db.from('siswa_ujian')
    .update({ status: 'AKTIF' })   // ← tidak ada waktu_mulai: new Date() lagi
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  // Kembalikan waktu_mulai_awal agar client bisa hitung sisa waktu yang benar
  const waktuMulaiAwal = siswaUjian?.waktu_mulai_awal ?? siswaUjian?.waktu_mulai ?? new Date().toISOString()

  return NextResponse.json({
    valid: true,
    waktu_mulai: waktuMulaiAwal,
    message: 'Kode benar. Ujian dilanjutkan.',
  })
}
