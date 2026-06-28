import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id, mapel_id, kelas, durasi')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Close sesi
  await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId)

  // Update jadwal status
  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
  }

  // Ambil semua siswa yang masih AKTIF atau RESET — mereka perlu dinilai otomatis
  const { data: siswaAktif } = await db
    .from('siswa_ujian')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  // Force-finish status dulu
  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  // ── AUTO-GRADE siswa yang belum submit sendiri ────────────────────────────
  // Siswa yang waktunya habis, devicenya mati, atau sekarang ditolak validasi
  // waktu server — mereka sudah SELESAI statusnya tapi belum punya baris nilai.
  // Hitung nilai dari jawaban yang sudah tersimpan di server sejauh ini,
  // menggunakan logika penilaian yang sama dengan endpoint /selesai.
  if (siswaAktif && siswaAktif.length > 0) {
    // Ambil data yang dibutuhkan untuk penilaian — satu kali, dipakai semua siswa
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const [{ data: mapel }, { data: paketData }] = await Promise.all([
      db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
      db.from('paket_soal')
        .select('id, jumlah_soal')
        .eq('mapel_id', sesi.mapel_id)
        .eq('kelas_id', kelasId)
        .eq('status', 'DISETUJUI')
        .limit(1)
        .single(),
    ])

    const kkm = mapel?.kkm ?? 75

    const [{ count: totalSoalCount }, { data: semuaKunci }] = await Promise.all([
      db.from('soal')
        .select('*', { count: 'exact', head: true })
        .eq('mapel_id', sesi.mapel_id)
        .eq('status', 'DISETUJUI')
        .eq('paket_id', paketData?.id ?? ''),
      db.from('soal')
        .select('id, kunci')
        .eq('mapel_id', sesi.mapel_id)
        .eq('status', 'DISETUJUI')
        .eq('paket_id', paketData?.id ?? ''),
    ])

    const totalSoal = totalSoalCount ?? paketData?.jumlah_soal ?? 0
    const kunciMap: Record<string, string> = Object.fromEntries(
      (semuaKunci ?? []).map(s => [s.id, s.kunci])
    )

    // Nilai tiap siswa secara paralel
    await Promise.all(siswaAktif.map(async ({ nis }) => {
      // Jangan timpa nilai yang sudah ada (misal dari kunci_permanen)
      const { data: nilaiSudahAda } = await db
        .from('nilai')
        .select('id')
        .eq('sesi_id', sesiId)
        .eq('nis', nis)
        .maybeSingle()
      if (nilaiSudahAda) return

      const { data: jawabanSiswa } = await db
        .from('jawaban')
        .select('soal_id, jawaban')
        .eq('sesi_id', sesiId)
        .eq('nis', nis)

      let benar = 0
      const total = totalSoal > 0 ? totalSoal : (jawabanSiswa?.length ?? 0)
      if (jawabanSiswa?.length) {
        for (const j of jawabanSiswa) {
          if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
        }
      }

      const nilaiAngka = total > 0 ? Math.round((benar / total) * 100) : 0
      const grade = nilaiAngka >= 90 ? 'A' : nilaiAngka >= 80 ? 'B' : nilaiAngka >= 70 ? 'C' : nilaiAngka >= 60 ? 'D' : 'E'
      const lulus = nilaiAngka >= kkm

      await db.from('nilai').upsert({
        id: generateId('NIL'),
        sesi_id: sesiId,
        nis,
        mapel_id: sesi.mapel_id,
        kelas: sesi.kelas,
        benar,
        total,
        nilai: nilaiAngka,
        grade,
        lulus,
        kkm,
        timestamp: new Date().toISOString(),
      }, { onConflict: 'sesi_id,nis', ignoreDuplicates: true })
    }))
  }
  // ─────────────────────────────────────────────────────────────────────────

  return NextResponse.json({ message: 'Sesi berhasil ditutup' })
}
