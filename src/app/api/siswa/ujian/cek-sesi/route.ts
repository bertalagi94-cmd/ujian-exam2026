import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { sidDipantauUntuk } from '@/lib/dipantau'

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

  // Perbarui heartbeat — bukti device ini masih aktif mengerjakan ujian.
  //
  // PENGECUALIAN mode "Lihat sebagai": ini SATU-SATUNYA GET dengan efek
  // samping tulis. Kalau admin yang sedang "melihat sebagai" siswa ikut
  // meng-update last_heartbeat, siswa asli yang sedang ujian di device-nya
  // bisa salah dianggap tidak aktif / device berganti. Jadi untuk token
  // viewAs: baca boleh, tulis heartbeat dilewati.
  if (!user.viewAs && deviceId && siswaUjian?.status === 'AKTIF') {
    await db
      .from('siswa_ujian')
      .update({ last_heartbeat: new Date().toISOString() })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
  }

  // Status "sedang dipantau admin" dititipkan di respons polling yang SUDAH ada
  // (tiap 10 detik selama ujian) — banner di halaman ujian tidak perlu request
  // tambahan. Sesi Lihat-sebagai itu sendiri tidak pernah ditandai dipantau.
  const sidDipantau = user.viewAs ? null : await sidDipantauUntuk(db, user.nis!)

  // FIX BUG (pesan "Ujian Dihentikan" selalu bunyi "melanggar {batas} kali"
  // walau siswa baru melanggar 1x): sebelumnya layar itu di client cuma
  // menampilkan angka batasPelanggaran dari pengaturan, bukan jumlah
  // pelanggaran ASLI siswa. Sertakan jumlah pelanggaran sungguhan di sini
  // supaya client bisa menampilkan angka yang benar begitu status TERKUNCI
  // terdeteksi lewat polling ini (siswa sedang aktif mengerjakan saat
  // dikunci pengawas/admin).
  let jumlahPelanggaran: number | undefined
  if (siswaUjian?.status === 'TERKUNCI') {
    const { count } = await db
      .from('pelanggaran')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
      .neq('status', 'DIABAIKAN')
    jumlahPelanggaran = count ?? undefined
  }

  return NextResponse.json({
    sesi_status: sesi.status,
    siswa_status: siswaUjian?.status ?? 'TIDAK_TERDAFTAR',
    jumlah_pelanggaran: jumlahPelanggaran,
    dipantau: !!sidDipantau,
    dipantau_sid: sidDipantau ?? undefined,
  })
}
