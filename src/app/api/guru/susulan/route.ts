// POST /api/guru/susulan
// Cek siswa belum ujian dan buka sesi susulan berdasarkan jadwal_id.
// Tidak bergantung pada sesi_ujian yang sudah ada.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

function generateKode7(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { jadwalId } = await req.json()

  if (!jadwalId) return NextResponse.json({ error: 'jadwalId diperlukan' }, { status: 400 })

  // Ambil data jadwal
  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, kelas, mapel_id, durasi, status')
    .eq('id', jadwalId)
    .single()

  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan' }, { status: 404 })

  // Ambil semua sesi ujian yang pernah ada untuk jadwal ini (termasuk susulan sebelumnya)
  const { data: semuaSesi } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('jadwal_id', jadwalId)

  const semuaSesiIds = (semuaSesi ?? []).map(s => s.id)

  // Ambil daftar siswa aktif di kelas
  const { data: siswaDiKelas } = await db
    .from('siswa')
    .select('nis, nama')
    .eq('kelas', jadwal.kelas)
    .eq('status', 'AKTIF')

  if (!siswaDiKelas?.length) {
    return NextResponse.json({ bisa: false, message: 'Tidak ada siswa aktif di kelas ini.' })
  }

  const semuaNis = siswaDiKelas.map(s => s.nis)

  // Cari siswa yang sudah punya nilai di SEMUA sesi jadwal ini
  const { data: sudahUjian } = semuaSesiIds.length > 0
    ? await db.from('nilai').select('nis').in('sesi_id', semuaSesiIds).in('nis', semuaNis)
    : { data: [] }

  const nisSudah = new Set((sudahUjian ?? []).map(n => n.nis))
  const siswaBelum = siswaDiKelas.filter(s => !nisSudah.has(s.nis))

  if (siswaBelum.length === 0) {
    return NextResponse.json({
      bisa: false,
      message: `Semua ${semuaNis.length} siswa kelas ${jadwal.kelas} sudah mengikuti ujian. Susulan tidak diperlukan.`,
    })
  }

  // Buka sesi susulan baru
  const sesiBaruId = generateId('SES')
  const kodeBaru = generateKode7()

  const { error } = await db.from('sesi_ujian').insert({
    id: sesiBaruId,
    jadwal_id: jadwal.id,
    mapel_id: jadwal.mapel_id,
    kelas: String(jadwal.kelas),
    durasi: jadwal.durasi,
    kode_sesi: kodeBaru,
    status: 'BERJALAN',
    waktu_mulai: new Date().toISOString(),
    jumlah_peserta: 0,
    is_darurat: true,
    siswa_diizinkan: siswaBelum.map(s => s.nis),
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    bisa: true,
    message: `Sesi susulan dibuka untuk ${siswaBelum.length} siswa.`,
    sesiBaruId,
    kodeSesi: kodeBaru,
    siswa: siswaBelum,
  })
}
