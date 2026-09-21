import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { ambilMaksReset, kodeResetCocok } from '@/lib/reset-berurutan'

// Batas percobaan kode salah sebelum dikunci sementara, dan lama lockout-nya.
const MAX_PERCOBAAN = 5
const LOCKOUT_MENIT = 5

// POST /api/siswa/ujian/verifikasi-reset
// Body: { sesiId: string, kodeReset: string }
//
// Siswa memasukkan kode 7 karakter dari pengawas untuk melanjutkan ujian.
//
// SISTEM R1/R2/R3 (supabase/24_reset_berurutan.sql, src/lib/reset-berurutan.ts):
//   - Kode yang sah SEKARANG hanya satu: R(reset_terpakai + 1). R2 tidak
//     berlaku sebelum R1, R3 tidak berlaku sebelum R2, dan kode yang sudah
//     dipakai tidak berlaku lagi — dijaga oleh penghitung di database yang
//     berubah atomik (konsumsi_reset_berurutan), bukan oleh pengecekan di sini.
//   - Kode diturunkan lewat HMAC; TIDAK ada kode yang tersimpan di database.
//   - Reset TIDAK menghapus riwayat pelanggaran dan TIDAK mengubah waktu mulai:
//     timer tetap berjalan dari waktu_mulai_awal.
//
// RATE-LIMIT: kegagalan dihitung atomik di database (catat_reset_gagal) —
// bukan in-memory, karena environment serverless tidak menjamin variabel
// bertahan antar request/instance. Setelah MAX_PERCOBAAN kali salah, siswa
// dikunci sementara LOCKOUT_MENIT menit.
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: { sesiId?: unknown; kodeReset?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ valid: false, message: 'Permintaan tidak valid.' }, { status: 400 })
  }
  const { sesiId, kodeReset } = body

  if (typeof sesiId !== 'string' || !sesiId) {
    return NextResponse.json({ valid: false, message: 'Sesi tidak valid.' }, { status: 400 })
  }
  if (typeof kodeReset !== 'string' || !kodeReset.trim()) {
    return NextResponse.json({ valid: false, message: 'Masukkan kode reset dari pengawas' })
  }

  const nis = user.nis!
  const db = createAdminClient()

  // Sesi masih aktif?
  const { data: sesi } = await db.from('sesi_ujian').select('id, status').eq('id', sesiId).single()
  if (!sesi || sesi.status !== 'BERJALAN') {
    return NextResponse.json({ valid: false, message: 'Sesi ujian sudah ditutup.' })
  }

  const { data: siswaUjian, error: siswaErr } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal, waktu_mulai, reset_terpakai, reset_terkunci_sampai')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .maybeSingle()

  // Fail-closed: error database (mis. migrasi 24 belum dijalankan) BUKAN
  // berarti "siswa tidak terdaftar" — jangan menyesatkan siswa dengan pesan itu.
  if (siswaErr) {
    console.error('[verifikasi-reset] gagal membaca siswa_ujian:', siswaErr.message)
    return NextResponse.json({ valid: false, message: 'Kode belum dapat diproses. Coba lagi sebentar lagi.' }, { status: 503 })
  }

  if (!siswaUjian) {
    return NextResponse.json({ valid: false, message: 'Anda belum terdaftar di sesi ujian ini.' })
  }

  const waktuMulai = siswaUjian.waktu_mulai_awal ?? siswaUjian.waktu_mulai ?? new Date().toISOString()

  // Terkunci permanen: kirim flag eksplisit + jumlah pelanggaran ASLI supaya
  // client langsung pindah ke layar "Ujian Dihentikan" tanpa menunggu polling.
  const balasTerkunci = async () => {
    const { count } = await db
      .from('pelanggaran')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .neq('status', 'DIABAIKAN')
    return NextResponse.json({
      valid: false,
      terkunci_permanen: true,
      jumlah_pelanggaran: count ?? undefined,
      message: 'Akun Anda dikunci permanen. Hubungi pengawas.',
    })
  }
  if (siswaUjian.status === 'TERKUNCI') return balasTerkunci()

  // Lockout sementara: tolak TANPA memeriksa kode sama sekali.
  if (siswaUjian.reset_terkunci_sampai && new Date(siswaUjian.reset_terkunci_sampai) > new Date()) {
    const sisaMenit = Math.ceil((new Date(siswaUjian.reset_terkunci_sampai).getTime() - Date.now()) / 60000)
    return NextResponse.json({
      valid: false,
      message: `Terlalu banyak percobaan salah. Coba lagi dalam ${sisaMenit} menit, atau hubungi pengawas.`,
    })
  }

  const terpakai = siswaUjian.reset_terpakai ?? 0

  // Retry yang sah: respons "kode benar" sebelumnya hilang di jaringan, siswa
  // sudah AKTIF, lalu mengetik kode yang sama lagi. Kode yang barusan dipakai
  // dianggap sukses (idempoten) — TIDAK mengubah state apa pun.
  if (siswaUjian.status !== 'RESET') {
    if (terpakai >= 1 && kodeResetCocok(sesiId, nis, terpakai, kodeReset)) {
      return NextResponse.json({ valid: true, waktu_mulai: waktuMulai, message: 'Kode benar. Ujian dilanjutkan.' })
    }
    return NextResponse.json({ valid: false, message: 'Tidak ada kode reset aktif. Hubungi pengawas.' })
  }

  const maks = await ambilMaksReset(db)
  const nomor = terpakai + 1
  if (nomor > maks) {
    // Hanya mungkin bila batasPelanggaran diturunkan saat ujian berjalan.
    return NextResponse.json({ valid: false, message: 'Batas reset tercapai. Hubungi pengawas.' })
  }

  // ── Kode salah → hitung percobaan ────────────────────────────────────────
  if (!kodeResetCocok(sesiId, nis, nomor, kodeReset)) {
    const { data: gagal, error } = await db.rpc('catat_reset_gagal', {
      p_sesi_id: sesiId,
      p_nis: nis,
      p_maks_gagal: MAX_PERCOBAAN,
      p_menit: LOCKOUT_MENIT,
    })
    if (error) console.error('[verifikasi-reset] catat_reset_gagal gagal:', error.message)
    const g = (gagal ?? {}) as { hasil?: string; sisa?: number; menit?: number }
    if (g.hasil === 'DIKUNCI_SEMENTARA') {
      return NextResponse.json({
        valid: false,
        message: `Terlalu banyak percobaan salah. Akun dikunci sementara selama ${g.menit ?? LOCKOUT_MENIT} menit. Hubungi pengawas jika perlu reset ulang.`,
      })
    }
    const sisa = typeof g.sisa === 'number' ? g.sisa : undefined
    return NextResponse.json({
      valid: false,
      message: sisa !== undefined
        ? `Kode reset salah. Cek kembali kode dari pengawas. Sisa percobaan: ${sisa}.`
        : 'Kode reset salah. Cek kembali kode dari pengawas.',
    })
  }

  // ── Kode benar → pakai (atomik, berurutan, sekali pakai) ─────────────────
  const { data: pakai, error: pakaiErr } = await db.rpc('konsumsi_reset_berurutan', {
    p_sesi_id: sesiId,
    p_nis: nis,
    p_nomor: nomor,
    p_maks: maks,
    p_oleh: 'siswa',
  })
  if (pakaiErr || !pakai) {
    // Fail-closed: JANGAN meloloskan siswa kalau penggunaan kode tidak tercatat.
    console.error('[verifikasi-reset] konsumsi_reset_berurutan gagal:', pakaiErr?.message)
    return NextResponse.json({ valid: false, message: 'Kode belum dapat diproses. Coba lagi sebentar lagi.' }, { status: 503 })
  }

  const p = pakai as { hasil: string; waktu_mulai?: string; sampai?: string }
  switch (p.hasil) {
    case 'OK':
    case 'SUDAH_DIPAKAI':
    case 'TIDAK_PERLU_RESET':
      return NextResponse.json({
        valid: true,
        waktu_mulai: p.waktu_mulai ?? waktuMulai,
        message: 'Kode benar. Ujian dilanjutkan.',
      })
    case 'TERKUNCI':
      return balasTerkunci()
    case 'DIKUNCI_SEMENTARA':
      return NextResponse.json({ valid: false, message: 'Terlalu banyak percobaan salah. Coba lagi beberapa menit lagi.' })
    case 'SESI_DITUTUP':
      return NextResponse.json({ valid: false, message: 'Sesi ujian sudah ditutup.' })
    default:
      // URUTAN_SALAH (balapan dengan request lain) dan sisanya: aman diulang.
      return NextResponse.json({ valid: false, message: 'Kode belum dapat diproses. Coba lagi.' })
  }
}
