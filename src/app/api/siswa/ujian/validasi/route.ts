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

  // FIX kelas_id: sesi.kelas = nama kelas, paket_soal.kelas_id = ID dari tabel kelas
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  const [
    { data: nilaiAda },
    { data: siswaUjian },
    { data: paketData },
    { data: mapel },
  ] = await Promise.all([
    db.from('nilai').select('id').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('siswa_ujian').select('status, waktu_mulai, waktu_mulai_awal').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('paket_soal').select('id, acak').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI').limit(1).single(),
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
    .select('id, paket_id, mapel_id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e, status')
    .eq('mapel_id', sesi.mapel_id)
    .eq('status', 'DISETUJUI')

  if (paketData) soalQuery = soalQuery.eq('paket_id', paketData.id)

  const now = new Date().toISOString()

  // FIX race condition: gunakan upsert dengan ignoreDuplicates
  // agar submit ganda dari klik 2x tidak menghasilkan 2 row di siswa_ujian
  const [{ data: soalList }] = await Promise.all([
    soalQuery,
    isNewEntry
      ? db.from('siswa_ujian').upsert({   // ← FIX: was insert
          sesi_id: sesi.id, nis,
          waktu_daftar: now,
          waktu_mulai: now,
          waktu_mulai_awal: now,
          status: 'AKTIF',
        }, { onConflict: 'sesi_id,nis', ignoreDuplicates: true })
      : db.from('siswa_ujian').update({ status: 'AKTIF' }).eq('sesi_id', sesi.id).eq('nis', nis),
  ])

  if (!soalList?.length) return NextResponse.json({ valid: false, message: 'Tidak ada soal tersedia untuk ujian ini. Pastikan paket soal sudah disetujui.' })

  // Increment jumlah_peserta di background
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

  // Gunakan waktu_mulai_awal sebagai referensi timer
  const waktuMulaiRef = siswaUjian?.waktu_mulai_awal ?? siswaUjian?.waktu_mulai ?? now

  return NextResponse.json({
    valid: true,
    sesiId: sesi.id,
    mapelId: sesi.mapel_id,
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    kelas: sesi.kelas,
    durasi: sesi.durasi,
    waktu_mulai: waktuMulaiRef,
    soalList: finalSoal,
  })
}
