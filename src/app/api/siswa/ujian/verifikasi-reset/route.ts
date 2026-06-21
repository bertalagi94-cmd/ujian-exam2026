import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Batas percobaan kode salah sebelum dikunci sementara.
const MAX_PERCOBAAN = 5
// Lama lockout setelah percobaan gagal melebihi batas.
const LOCKOUT_MENIT = 5

// POST /api/siswa/ujian/verifikasi-reset
// Body: { sesiId: string, kodeReset: string }
// Siswa memasukkan kode 7 digit dari pengawas untuk melanjutkan ujian.
// FIX: waktu_mulai TIDAK direset — timer tetap berjalan dari waktu awal masuk.
// FIX RATE-LIMIT: kode reset hanya 7 karakter dari alfabet terbatas, dan endpoint
// ini sebelumnya bisa dipanggil berkali-kali tanpa batas — siswa bisa menulis
// script untuk brute-force kode tanpa perlu akses lain selain token miliknya
// sendiri. Sekarang setiap kegagalan dicatat di log_reset.percobaan_gagal, dan
// setelah MAX_PERCOBAAN kali salah, siswa dikunci sementara (terkunci_sampai)
// selama LOCKOUT_MENIT sebelum bisa mencoba lagi. State disimpan di database
// (bukan in-memory) karena environment serverless tidak menjamin variabel
// in-memory bertahan antar request/instance.
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
    .select('id, password_baru, percobaan_gagal, terkunci_sampai')
    .eq('nis', user.nis!)
    .eq('digunakan', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!logReset) {
    return NextResponse.json({ valid: false, message: 'Tidak ada kode reset aktif. Hubungi pengawas.' })
  }

  // RATE LIMIT: kalau sedang terkunci sementara, tolak tanpa mengecek kode sama sekali
  if (logReset.terkunci_sampai && new Date(logReset.terkunci_sampai) > new Date()) {
    const sisaMs = new Date(logReset.terkunci_sampai).getTime() - Date.now()
    const sisaMenit = Math.ceil(sisaMs / 60000)
    return NextResponse.json({
      valid: false,
      message: `Terlalu banyak percobaan salah. Coba lagi dalam ${sisaMenit} menit, atau hubungi pengawas.`,
    })
  }

  if (logReset.password_baru.toUpperCase() !== kodeReset.trim().toUpperCase()) {
    const percobaanBaru = (logReset.percobaan_gagal ?? 0) + 1
    const updatePayload: Record<string, unknown> = { percobaan_gagal: percobaanBaru }

    if (percobaanBaru >= MAX_PERCOBAAN) {
      updatePayload.terkunci_sampai = new Date(Date.now() + LOCKOUT_MENIT * 60 * 1000).toISOString()
      updatePayload.percobaan_gagal = 0 // reset counter, lockout yang menahan sekarang
    }

    await db.from('log_reset').update(updatePayload).eq('id', logReset.id)

    if (percobaanBaru >= MAX_PERCOBAAN) {
      return NextResponse.json({
        valid: false,
        message: `Terlalu banyak percobaan salah. Akun dikunci sementara selama ${LOCKOUT_MENIT} menit. Hubungi pengawas jika perlu reset ulang.`,
      })
    }

    const sisaPercobaan = MAX_PERCOBAAN - percobaanBaru
    return NextResponse.json({
      valid: false,
      message: `Kode reset salah. Cek kembali kode dari pengawas. Sisa percobaan: ${sisaPercobaan}.`,
    })
  }

  // Kode benar — tandai sudah digunakan dan bersihkan counter
  await db.from('log_reset')
    .update({ digunakan: true, percobaan_gagal: 0, terkunci_sampai: null })
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
