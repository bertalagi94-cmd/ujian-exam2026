// POST /api/admin/susulan
// Fitur tambahan: Admin membuka ujian susulan untuk sebuah jadwal, dan memilih
// guru mana yang akan menjadi pengawas sesi susulan tersebut.
//
// PENTING — tidak menggantikan fitur susulan milik guru pengawas asli
// (lihat /api/guru/susulan dan /api/pengawas/sesi/[id]/susulan, keduanya
// tetap berjalan seperti semula dan TIDAK diubah oleh file ini).
//
// Anti-tabrakan: sebelum membuka sesi baru, dicek apakah jadwal_id ini
// SUDAH memiliki sesi_ujian berstatus BERJALAN — apa pun asal-usulnya
// (dibuka oleh guru pengawas asli lewat /api/guru/susulan, ATAU oleh
// admin lewat endpoint ini sebelumnya). Jika sudah ada, request ditolak
// dengan pesan jelas + info sesi yang sedang aktif, supaya admin tidak
// membuka sesi kedua yang bertabrakan dengan sesi yang sudah berjalan.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { cekSesiBentrokKelas, pesanBentrokKelas } from '@/lib/sesi-kelas'

function generateKode7(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { jadwalId, pengawasUsername } = await req.json()

  if (!jadwalId) {
    return NextResponse.json({ error: 'jadwalId diperlukan' }, { status: 400 })
  }
  if (!pengawasUsername) {
    return NextResponse.json({ error: 'Pilih guru yang akan menjadi pengawas sesi susulan' }, { status: 400 })
  }

  // Pastikan guru yang dipilih valid (role GURU/ADMIN/KEPSEK, status AKTIF).
  // "Pengawas" bukan role akun tersendiri — siapa pun bisa ditugaskan asalkan
  // akunnya aktif.
  const { data: guru } = await db
    .from('users')
    .select('username, nama, role, status')
    .eq('username', pengawasUsername)
    .single()

  if (!guru) {
    return NextResponse.json({ error: 'Guru pengawas yang dipilih tidak ditemukan' }, { status: 404 })
  }
  if (!['GURU', 'ADMIN', 'KEPSEK'].includes(guru.role)) {
    return NextResponse.json({ error: 'Akun yang dipilih tidak dapat ditugaskan sebagai pengawas' }, { status: 400 })
  }
  if (guru.status !== 'AKTIF') {
    return NextResponse.json({ error: 'Guru yang dipilih sedang tidak aktif' }, { status: 400 })
  }

  // Ambil data jadwal
  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, kelas, mapel_id, durasi, status, pengawas')
    .eq('id', jadwalId)
    .single()

  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan' }, { status: 404 })

  // ── ANTI-TABRAKAN ──────────────────────────────────────────────────
  // Cek apakah jadwal ini SUDAH memiliki sesi BERJALAN, dari sumber mana pun:
  // - dibuka oleh pengawas asli (via /api/guru/susulan atau mode pengawas biasa)
  // - dibuka oleh admin sebelumnya (via endpoint ini)
  const { data: sesiAktif } = await db
    .from('sesi_ujian')
    .select('id, kode_sesi, info_json')
    .eq('jadwal_id', jadwalId)
    .eq('status', 'BERJALAN')
    .limit(1)
    .maybeSingle()

  if (sesiAktif) {
    const dibukaOleh = sesiAktif.info_json?.dibuka_oleh_admin
      ? `admin (pengawas: ${sesiAktif.info_json?.pengawas_susulan_nama ?? sesiAktif.info_json?.pengawas_susulan ?? '-'})`
      : 'pengawas yang bertugas pada jadwal ini'

    return NextResponse.json({
      error: `Sudah ada sesi ujian yang sedang berjalan untuk jadwal ini (dibuka oleh ${dibukaOleh}). Tutup sesi tersebut terlebih dahulu sebelum membuka sesi susulan baru, agar tidak terjadi tabrakan sesi.`,
      konflik: true,
      sesiAktifId: sesiAktif.id,
      kodeSesi: sesiAktif.kode_sesi,
    }, { status: 409 })
  }

  // ── ANTI-TABRAKAN LEVEL KELAS ──────────────────────────────────────────
  // Cek tambahan: walau jadwal INI belum punya sesi aktif, kelas yang sama
  // bisa saja sedang menjalankan sesi dari JADWAL LAIN (mapel lain). Tanpa
  // cek ini, admin bisa membuka susulan untuk mapel B di kelas 10 padahal
  // kelas 10 sedang ujian mapel A — dua sesi aktif bersamaan di kelas yang
  // sama. Lihat src/lib/sesi-kelas.ts.
  const bentrokKelas = await cekSesiBentrokKelas(db, String(jadwal.kelas), jadwalId)
  if (bentrokKelas) {
    return NextResponse.json({
      error: pesanBentrokKelas(String(jadwal.kelas), bentrokKelas),
      bentrokKelas: true,
      sesiAktifId: bentrokKelas.sesiId,
      kodeSesi: bentrokKelas.kodeSesi,
      jadwalAktifId: bentrokKelas.jadwalId,
    }, { status: 409 })
  }

  // Ambil semua sesi yang pernah ada untuk jadwal ini (termasuk susulan-susulan sebelumnya)
  // agar siswa yang sudah pernah ujian di sesi manapun tidak dihitung "belum ujian" lagi.
  const { data: semuaSesi } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('jadwal_id', jadwalId)

  const semuaSesiIds = (semuaSesi ?? []).map(s => s.id)

  // Ambil siswa aktif di kelas terkait
  const { data: siswaDiKelas } = await db
    .from('siswa')
    .select('nis, nama')
    .eq('kelas', jadwal.kelas)
    .eq('status', 'AKTIF')

  if (!siswaDiKelas?.length) {
    return NextResponse.json({ bisa: false, message: 'Tidak ada siswa aktif di kelas ini.' })
  }

  const semuaNis = siswaDiKelas.map(s => s.nis)

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

  // Buka sesi susulan baru — pengawasnya dicatat di info_json,
  // TANPA mengubah kolom `pengawas` pada tabel jadwal (pengawas asli tetap utuh).
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
    info_json: {
      dibuka_oleh_admin: true,
      admin_username: auth.user.username,
      pengawas_susulan: guru.username,
      pengawas_susulan_nama: guru.nama,
      pengawas_asli: jadwal.pengawas ?? null,
    },
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sinkronkan status jadwal agar tampil "Berjalan" selama susulan ini aktif
  await db.from('jadwal').update({ status: 'BERJALAN' }).eq('id', jadwal.id)

  return NextResponse.json({
    bisa: true,
    message: `Sesi susulan dibuka untuk ${siswaBelum.length} siswa. Pengawas: ${guru.nama}.`,
    sesiBaruId,
    kodeSesi: kodeBaru,
    siswa: siswaBelum,
    pengawas: { username: guru.username, nama: guru.nama },
  })
}
