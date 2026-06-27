// POST /api/pengawas/sesi/[id]/susulan
// Membuka kembali sesi yang sudah SELESAI untuk ujian susulan.
// Sistem akan mengecek apakah masih ada siswa terdaftar di jadwal ini yang belum ujian.
// Jika tidak ada, permintaan dibatalkan dengan pesan informatif.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { cekSesiBentrokKelas, pesanBentrokKelas } from '@/lib/sesi-kelas'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['PENGAWAS', 'GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  // Ambil data sesi yang sudah selesai
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, durasi, status')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'SELESAI') {
    return NextResponse.json({ error: 'Sesi belum selesai, tidak dapat membuka ujian susulan' }, { status: 400 })
  }

  // Ambil daftar siswa di kelas yang terkait dengan jadwal ini
  const { data: siswaDiKelas } = await db
    .from('siswa')
    .select('nis')
    .eq('kelas', sesi.kelas)
    .eq('status', 'AKTIF')

  if (!siswaDiKelas?.length) {
    return NextResponse.json({
      bisa: false,
      message: 'Tidak ada siswa aktif di kelas ini.',
    })
  }

  const semuaNis = siswaDiKelas.map(s => s.nis)

  // Cari siswa yang sudah punya nilai di sesi ini
  const { data: sudahUjian } = await db
    .from('nilai')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('nis', semuaNis)

  const nisSudahUjian = new Set((sudahUjian ?? []).map(n => n.nis))
  const nisBelumUjian = semuaNis.filter(nis => !nisSudahUjian.has(nis))

  if (nisBelumUjian.length === 0) {
    return NextResponse.json({
      bisa: false,
      message: `Semua ${semuaNis.length} siswa kelas ${sesi.kelas} sudah mengikuti ujian. Ujian susulan tidak diperlukan.`,
    })
  }

  // ── ANTI-TABRAKAN LEVEL KELAS ──────────────────────────────────────────
  // Sesi LAMA ini sendiri sudah SELESAI (dicek di atas), tapi kelas yang
  // sama bisa saja sedang menjalankan sesi dari JADWAL LAIN (mapel lain).
  // Tolak supaya tidak ada 2 sesi aktif bersamaan di kelas yang sama.
  // Lihat src/lib/sesi-kelas.ts.
  const bentrokKelas = await cekSesiBentrokKelas(db, String(sesi.kelas), sesi.jadwal_id)
  if (bentrokKelas) {
    return NextResponse.json({
      bisa: false,
      error: pesanBentrokKelas(String(sesi.kelas), bentrokKelas),
      bentrokKelas: true,
      sesiAktifId: bentrokKelas.sesiId,
      kodeSesi: bentrokKelas.kodeSesi,
      jadwalAktifId: bentrokKelas.jadwalId,
    }, { status: 409 })
  }

  // Ada siswa yang belum ujian — buka sesi baru khusus susulan
  const kodeBaru = `${generateId('SSL').slice(0, 6).toUpperCase()}`
  const sesiBaruId = generateId('SES')

  const { error } = await db.from('sesi_ujian').insert({
    id: sesiBaruId,
    jadwal_id: sesi.jadwal_id,
    mapel_id: sesi.mapel_id,
    kelas: sesi.kelas,
    durasi: sesi.durasi,
    kode_sesi: kodeBaru,
    status: 'BERJALAN',
    waktu_mulai: new Date().toISOString(),
    jumlah_peserta: 0,
    is_darurat: true,
    siswa_diizinkan: nisBelumUjian,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sinkronkan status jadwal agar tampil "Berjalan" selama susulan ini aktif
  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'BERJALAN' }).eq('id', sesi.jadwal_id)
  }

  // Ambil nama siswa yang belum ujian untuk ditampilkan
  const { data: detailSiswa } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', nisBelumUjian)

  return NextResponse.json({
    bisa: true,
    message: `Sesi susulan dibuka untuk ${nisBelumUjian.length} siswa.`,
    sesiBaruId,
    kodeSesi: kodeBaru,
    siswa: detailSiswa ?? [],
  })
}
