// app/api/siswa/ujian/validasi/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { kodeSesi, nis } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ valid: false, message: 'NIS tidak sesuai' })

  // Find active sesi
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('*')
    .eq('kode_sesi', kodeSesi.toUpperCase())
    .eq('status', 'BERJALAN')
    .single()

  if (!sesi) {
    return NextResponse.json({ valid: false, message: 'Kode sesi tidak ditemukan atau ujian sudah selesai.' })
  }

  // Validasi kelas: kelas siswa harus cocok dengan kelas sesi
  if (user.kelas && String(user.kelas) !== String(sesi.kelas)) {
    return NextResponse.json({
      valid: false,
      message: `Anda bukan peserta ujian ini. Kelas Anda (${user.kelas}) tidak sesuai dengan kelas sesi (${sesi.kelas}).`,
    })
  }

  // Jika sesi susulan (is_darurat=true), cek apakah siswa ini termasuk yang diizinkan
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    if (!sesi.siswa_diizinkan.includes(nis)) {
      return NextResponse.json({
        valid: false,
        message: 'Anda tidak terdaftar dalam sesi ujian susulan ini. Hubungi pengawas.',
      })
    }
  }

  // Check siswa already finished
  const { data: nilaiAda } = await db
    .from('nilai')
    .select('id')
    .eq('sesi_id', sesi.id)
    .eq('nis', nis)
    .single()

  if (nilaiAda) {
    return NextResponse.json({ valid: false, message: 'Anda sudah menyelesaikan ujian ini.' })
  }

  // Check siswa_ujian status (terkunci?)
  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status')
    .eq('sesi_id', sesi.id)
    .eq('nis', nis)
    .single()

  if (siswaUjian?.status === 'TERKUNCI') {
    return NextResponse.json({ valid: false, message: 'Akun Anda dikunci oleh pengawas. Hubungi pengawas.' })
  }

  // Cek apakah siswa ini belum pernah daftar sebelumnya (baru masuk pertama kali)
  const isNewEntry = !siswaUjian

  // Register or re-enter siswa
  await db.from('siswa_ujian').upsert({
    sesi_id: sesi.id,
    nis,
    waktu_daftar: new Date().toISOString(),
    waktu_mulai: new Date().toISOString(),
    status: 'AKTIF',
  }, { onConflict: 'sesi_id,nis' })

  // Increment jumlah_peserta hanya jika siswa ini baru pertama kali masuk
  if (isNewEntry) {
    await db.rpc('increment_jumlah_peserta', { sesi_id_param: sesi.id })
      .then(async ({ error }) => {
        // Fallback jika RPC belum ada: update manual
        if (error) {
          const { data: currentSesi } = await db
            .from('sesi_ujian')
            .select('jumlah_peserta')
            .eq('id', sesi.id)
            .single()
          await db
            .from('sesi_ujian')
            .update({ jumlah_peserta: (currentSesi?.jumlah_peserta ?? 0) + 1 })
            .eq('id', sesi.id)
        }
      })
  }

  // Get paket soal untuk kelas dan mapel ini
  // acak diatur di level paket, bukan di tiap soal
  const { data: paketData } = await db
    .from('paket_soal')
    .select('id, acak')
    .eq('mapel_id', sesi.mapel_id)
    .eq('kelas_id', sesi.kelas)
    .eq('status', 'DISETUJUI')
    .limit(1)
    .single()

  let soalQuery = db
    .from('soal')
    .select('*')
    .eq('mapel_id', sesi.mapel_id)
    .eq('status', 'DISETUJUI')

  if (paketData) soalQuery = soalQuery.eq('paket_id', paketData.id)

  const { data: soalList } = await soalQuery

  if (!soalList?.length) {
    return NextResponse.json({ valid: false, message: 'Tidak ada soal tersedia untuk ujian ini.' })
  }

  // Shuffle berdasarkan pengaturan acak di paket_soal
  const shouldAcak = paketData?.acak === 'YA'

  let finalSoal
  if (shouldAcak) {
    // Fisher-Yates shuffle
    const arr = [...soalList]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    finalSoal = arr.map((s, i) => ({ ...s, nomor: i + 1 }))
  } else {
    finalSoal = soalList.map((s, i) => ({ ...s, nomor: i + 1 }))
  }

  // Get mapel name
  const { data: mapel } = await db.from('mapel').select('nama').eq('id', sesi.mapel_id).single()

  return NextResponse.json({
    valid: true,
    sesiId: sesi.id,
    mapelId: sesi.mapel_id,
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    kelas: sesi.kelas,
    durasi: sesi.durasi,
    soalList: finalSoal,
  })
}
