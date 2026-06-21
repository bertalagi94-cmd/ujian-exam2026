import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

// Fungsi generate kode reset 7 digit alfanumerik unik untuk siswa
function generateKodeReset(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// POST /api/pengawas/sesi/[id]/reset-siswa
// Body: { nis: string }
// Reset status siswa yang di-reset agar harus memasukkan kode 7 digit untuk masuk lagi
// Jawaban TIDAK dihapus
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['PENGAWAS', 'GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id
  const { nis } = await req.json()

  if (!nis) return NextResponse.json({ error: 'NIS diperlukan' }, { status: 400 })

  // Ambil batasPelanggaran dari tabel pengaturan (default 3 jika tidak ada)
  const { data: settingData } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', 'batasPelanggaran')
    .single()

  const batasPelanggaran = parseInt(settingData?.value ?? '3', 10) || 3

  // Ambil data siswa
  const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).single()
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  // Cek jumlah reset yang sudah dilakukan untuk siswa ini dalam sesi ini
  const { count: resetCount } = await db
    .from('log_reset')
    .select('*', { count: 'exact', head: true })
    .eq('nis', nis)
    .like('alasan', `sesi:${sesiId}%`)

  // Jika sudah >= batasPelanggaran reset → langsung kunci permanen / nilai 0
  if ((resetCount ?? 0) >= batasPelanggaran) {
    // Set status TERKUNCI permanen
    await db.from('siswa_ujian')
      .update({ status: 'TERKUNCI' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)

    // Simpan nilai 0 jika belum ada
    const { data: nilaiExist } = await db
      .from('nilai')
      .select('id')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (!nilaiExist) {
      const { data: sesi } = await db
        .from('sesi_ujian')
        .select('mapel_id, kelas')
        .eq('id', sesiId)
        .single()

      if (sesi) {
        const { data: mapel } = await db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single()
        await db.from('nilai').insert({
          id: generateId('NIL'),
          sesi_id: sesiId,
          nis,
          mapel_id: sesi.mapel_id,
          kelas: sesi.kelas,
          benar: 0,
          total: 0,
          nilai: 0,
          grade: 'E',
          lulus: false,
          kkm: mapel?.kkm ?? 75,
          timestamp: new Date().toISOString(),
        })

        await db.from('siswa_ujian')
          .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
          .eq('sesi_id', sesiId)
          .eq('nis', nis)
      }
    }

    return NextResponse.json({
      dikunci_permanen: true,
      message: `${siswa.nama} telah melanggar ${batasPelanggaran} kali. Siswa di-logout permanen dan nilai menjadi 0.`,
    })
  }

  // Generate kode reset 7 digit unik untuk siswa ini
  const kodeReset = generateKodeReset()

  // Hapus kode reset lama yang belum digunakan untuk siswa ini
  await db.from('log_reset')
    .delete()
    .eq('nis', nis)
    .eq('digunakan', false)

  // Simpan kode reset baru di log_reset
  await db.from('log_reset').insert({
    nis,
    reset_oleh: auth.user?.username ?? 'pengawas',
    alasan: `sesi:${sesiId} — Reset karena pelanggaran`,
    password_baru: kodeReset,
    digunakan: false,
  })

  // Set status siswa ke RESET (harus memasukkan kode untuk lanjut)
  await db.from('siswa_ujian')
    .update({ status: 'RESET' })
    .eq('sesi_id', sesiId)
    .eq('nis', nis)

  return NextResponse.json({
    dikunci_permanen: false,
    kode_reset: kodeReset,
    nama_siswa: siswa.nama,
    reset_ke: (resetCount ?? 0) + 1,
    batasPelanggaran,
    message: `Siswa ${siswa.nama} di-reset (${(resetCount ?? 0) + 1}/${batasPelanggaran}). Berikan kode ${kodeReset} kepada siswa untuk melanjutkan ujian.`,
  })
}
