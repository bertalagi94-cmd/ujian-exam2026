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

  // Ambil sesi aktif
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, durasi, is_darurat, siswa_diizinkan')
    .eq('kode_sesi', kodeSesi.toUpperCase())
    .eq('status', 'BERJALAN')
    .single()

  if (!sesi) return NextResponse.json({ valid: false, message: 'Kode sesi tidak ditemukan atau ujian sudah selesai.' })

  // Validasi kelas
  if (user.kelas && String(user.kelas) !== String(sesi.kelas)) {
    return NextResponse.json({
      valid: false,
      message: `Anda bukan peserta ujian ini. Kelas Anda (${user.kelas}) tidak sesuai dengan kelas sesi (${sesi.kelas}).`,
    })
  }

  // Validasi sesi susulan
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    if (!sesi.siswa_diizinkan.includes(nis)) {
      return NextResponse.json({ valid: false, message: 'Anda tidak terdaftar dalam sesi ujian susulan ini. Hubungi pengawas.' })
    }
  }

  // Jalankan semua query bersamaan (paralel)
  const [
    { data: nilaiAda },
    { data: siswaUjian },
    { data: paketData },
    { data: mapel },
  ] = await Promise.all([
    db.from('nilai').select('id').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('siswa_ujian').select('status, waktu_mulai').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('paket_soal').select('id, acak').eq('mapel_id', sesi.mapel_id).eq('kelas_id', sesi.kelas).eq('status', 'DISETUJUI').limit(1).single(),
    db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
  ])

  if (nilaiAda) return NextResponse.json({ valid: false, message: 'Anda sudah menyelesaikan ujian ini.' })
  if (siswaUjian?.status === 'TERKUNCI') return NextResponse.json({ valid: false, message: 'Akun Anda dikunci permanen oleh pengawas karena pelanggaran berulang. Nilai Anda 0.' })
  if (siswaUjian?.status === 'RESET') {
    return NextResponse.json({ valid: false, perlu_kode_reset: true, sesiId: sesi.id, message: 'Akun Anda di-reset oleh pengawas karena pelanggaran. Masukkan kode 7 digit dari pengawas untuk melanjutkan ujian.' })
  }

  const isNewEntry = !siswaUjian

  // Ambil soal TANPA field kunci dan pembahasan (keamanan)
  let soalQuery = db
    .from('soal')
    .select('id, paket_id, mapel_id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, gambar_url, gambar_a, gambar_b, gambar_c, gambar_d, gambar_e, status')
    .eq('mapel_id', sesi.mapel_id)
    .eq('status', 'DISETUJUI')

  if (paketData) soalQuery = soalQuery.eq('paket_id', paketData.id)

  // Jalankan ambil soal + register siswa secara bersamaan
  const [{ data: soalList }] = await Promise.all([
    soalQuery,
    isNewEntry
      ? db.from('siswa_ujian').insert({ sesi_id: sesi.id, nis, waktu_daftar: new Date().toISOString(), waktu_mulai: new Date().toISOString(), status: 'AKTIF' })
      : db.from('siswa_ujian').update({ status: 'AKTIF' }).eq('sesi_id', sesi.id).eq('nis', nis),
  ])

  if (!soalList?.length) return NextResponse.json({ valid: false, message: 'Tidak ada soal tersedia untuk ujian ini.' })

  // Increment jumlah_peserta di background (tidak perlu ditunggu)
  if (isNewEntry) {
    db.rpc('increment_jumlah_peserta', { sesi_id_param: sesi.id })
  }

  // Acak soal
  const shouldAcak = paketData?.acak === 'YA'
  let finalSoal
  if (shouldAcak) {
    const arr = [...soalList]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    finalSoal = arr.map((s, i) => ({ ...s, nomor: i + 1 }))
  } else {
    finalSoal = soalList.map((s, i) => ({ ...s, nomor: i + 1 }))
  }

  return NextResponse.json({
    valid: true,
    sesiId: sesi.id,
    mapelId: sesi.mapel_id,
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    kelas: sesi.kelas,
    durasi: sesi.durasi,
    waktu_mulai: siswaUjian?.waktu_mulai ?? new Date().toISOString(),
    soalList: finalSoal,
  })
}
