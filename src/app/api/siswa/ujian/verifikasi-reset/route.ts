import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { ambilMaksReset, kodeResetCocok } from '@/lib/reset-berurutan'
import { cekDeviceSiswa, pesanDevice } from '@/lib/device-guard'

// Batas percobaan kode salah sebelum dikunci sementara, dan lama lockout-nya.
const MAX_PERCOBAAN = 5
const LOCKOUT_MENIT = 5

// POST /api/siswa/ujian/verifikasi-reset
// Body: { sesiId: string, kodeReset: string, nomor?: number, deviceId?: string }
//
// PERANGKAT: deviceId dibandingkan dengan siswa_ujian.device_id (lihat
// src/lib/device-guard.ts). Perangkat lain tidak boleh mengubah status sesi
// hanya dengan memakai akun yang sama.
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

  let body: { sesiId?: unknown; kodeReset?: unknown; nomor?: unknown; deviceId?: unknown }
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
  const db = tenantDb(yayasanIdDari(auth.user))

  // Sesi masih aktif?
  const { data: sesi } = await db.from('sesi_ujian').select('id, status').eq('id', sesiId).single()
  if (!sesi || sesi.status !== 'BERJALAN') {
    return NextResponse.json({ valid: false, message: 'Sesi ujian sudah ditutup.' })
  }

  const { data: siswaUjian, error: siswaErr } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal, waktu_mulai, reset_terpakai, reset_terkunci_sampai, device_id')
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

  // Satu siswa satu perangkat — diperiksa SEBELUM apa pun yang membuka atau
  // mengubah status. `permanen: true` supaya antrean reset offline berhenti
  // mengulang (kondisi ini tidak pulih dengan sendirinya).
  const cekDevice = cekDeviceSiswa(siswaUjian.device_id, body.deviceId, 'verifikasi-reset')
  if (cekDevice !== 'OK') {
    return NextResponse.json({ valid: false, permanen: true, message: pesanDevice(cekDevice) })
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

  // Retry idempoten untuk nomor LAMA: antrean offline mengirim `nomor` yang ia
  // maksud. Kalau server sudah melewati nomor itu (respons ACK hilang lalu
  // jatah sudah maju) dan kodenya cocok HMAC nomor tsb, itu sukses — bukan
  // "kode salah" (yang menaikkan jatah gagal & menandai entri GAGAL).
  const nomorKlien = typeof body.nomor === 'number' && Number.isInteger(body.nomor) ? body.nomor : undefined
  if (nomorKlien !== undefined && nomorKlien >= 1 && nomorKlien <= terpakai && kodeResetCocok(sesiId, nis, nomorKlien, kodeReset)) {
    return NextResponse.json({ valid: true, waktu_mulai: waktuMulai, reset_terpakai: terpakai, message: 'Kode benar. Ujian dilanjutkan.' })
  }

  // Retry yang sah: respons "kode benar" sebelumnya hilang di jaringan, siswa
  // sudah AKTIF, lalu mengetik kode yang sama lagi. Kode yang barusan dipakai
  // dianggap sukses (idempoten) — TIDAK mengubah state apa pun.
  if (siswaUjian.status !== 'RESET') {
    if (terpakai >= 1 && kodeResetCocok(sesiId, nis, terpakai, kodeReset)) {
      return NextResponse.json({ valid: true, waktu_mulai: waktuMulai, reset_terpakai: terpakai, message: 'Kode benar. Ujian dilanjutkan.' })
    }
    // BUG P0 (race rekonsiliasi offline — lihat reset-offline-client.ts): ini
    // BISA berarti siswa memang tidak butuh reset, TAPI juga bisa berarti
    // antrean rekonsiliasi R(N) offline ini sampai ke server LEBIH DULU
    // daripada event pelanggaran offline yang seharusnya men-set status ke
    // 'RESET' (dua outbox berjalan paralel tanpa urutan terjamin saat
    // koneksi pulih). Kalau kita bilang ini FINAL, client akan menghapus
    // entri dari antrean-nya padahal reset belum pernah benar-benar
    // tersimpan di server — pelanggaran yang menyusul lalu men-set status
    // 'RESET' tanpa reset_terpakai pernah naik, dan siswa "tersangkut". Tandai
    // `retryable: true` supaya client TIDAK menghapus dari antrean dan
    // mencoba lagi setelah event pelanggaran yang tertunda selesai disinkron.
    return NextResponse.json({ valid: false, retryable: true, message: 'Tidak ada kode reset aktif. Hubungi pengawas.' })
  }

  const maks = await ambilMaksReset(db, yayasanIdDari(auth.user))
  const nomor = terpakai + 1
  if (nomor > maks) {
    // Hanya mungkin bila batasPelanggaran diturunkan saat ujian berjalan.
    // Ini keadaan final (bukan soal urutan/waktu) — jangan diulang otomatis.
    return NextResponse.json({ valid: false, permanen: true, message: 'Batas reset tercapai. Hubungi pengawas.' })
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
      // Sementara (menunggu lockout habis) — aman diulang nanti, TAPI jangan
      // sampai retry outbox memicu percobaan salah lagi selagi terkunci; guard
      // di atas (reset_terkunci_sampai) sudah menolak sebelum sampai sini
      // lagi, jadi menandainya retryable di sini tidak menambah risiko.
      return NextResponse.json({
        valid: false,
        retryable: true,
        message: `Terlalu banyak percobaan salah. Akun dikunci sementara selama ${g.menit ?? LOCKOUT_MENIT} menit. Hubungi pengawas jika perlu reset ulang.`,
      })
    }
    const sisa = typeof g.sisa === 'number' ? g.sisa : undefined
    // Kode BENAR-BENAR ditolak (tidak cocok HMAC untuk nomor giliran saat
    // ini) — kalau ini berasal dari antrean offline yang otomatis, mengulang
    // terus-menerus hanya akan menghabiskan jatah percobaan siswa dan bisa
    // mengunci akunnya sendiri. Tandai FINAL supaya client berhenti mencoba
    // dan menyimpannya untuk audit manual, bukan menghapusnya diam-diam.
    return NextResponse.json({
      valid: false,
      permanen: true,
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

  const p = pakai as { hasil: string; waktu_mulai?: string; sampai?: string; reset_terpakai?: number }
  switch (p.hasil) {
    case 'OK':
    case 'SUDAH_DIPAKAI':
    case 'TIDAK_PERLU_RESET':
      return NextResponse.json({
        valid: true,
        waktu_mulai: p.waktu_mulai ?? waktuMulai,
        reset_terpakai: p.reset_terpakai ?? nomor,
        message: 'Kode benar. Ujian dilanjutkan.',
      })
    case 'TERKUNCI':
      return balasTerkunci()
    case 'DIKUNCI_SEMENTARA':
      return NextResponse.json({ valid: false, retryable: true, message: 'Terlalu banyak percobaan salah. Coba lagi beberapa menit lagi.' })
    case 'SESI_DITUTUP':
      // Final — sesi sudah ditutup, tidak ada gunanya mengulang.
      return NextResponse.json({ valid: false, permanen: true, message: 'Sesi ujian sudah ditutup.' })
    default:
      // URUTAN_SALAH (balapan dengan request lain, mis. R2 diproses sebelum
      // R1 sempat tersinkron) dan sisanya: ini justru kasus race yang sama
      // dengan komentar di atas — aman dan PERLU diulang otomatis.
      return NextResponse.json({ valid: false, retryable: true, message: 'Kode belum dapat diproses. Coba lagi.' })
  }
}
