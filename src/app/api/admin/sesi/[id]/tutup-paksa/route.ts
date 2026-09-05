import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { finalisasiNilaiPaksa } from '@/lib/finalisasi-nilai'

interface Ctx { params: { id: string } }

// POST /api/admin/sesi/[id]/tutup-paksa
//
// GAP YANG DIPERBAIKI: sebelumnya HANYA pengawas asli (atau pengawas susulan
// yang ditugaskan admin) yang bisa menutup sesi ujian — lewat
// POST /api/guru/mode-pengawas/tutup (lihat verifySesiOwnership di sana).
// Kalau sesi lupa/tidak ditutup berjam-jam bahkan sampai besok (mis. pengawas
// sakit, lupa, atau sudah tidak bisa dihubungi), TIDAK ADA cara bagi admin
// untuk menutupnya lewat UI — sesi tetap berstatus BERJALAN selamanya, dan
// ini pada gilirannya memblokir fitur admin lain (restore, ganti pengaturan
// batas-submit, dll — lihat masing-masing endpoint) karena semuanya menolak
// beroperasi selama ada sesi_ujian berstatus BERJALAN.
//
// Endpoint ini memberi admin jalan keluar: menutup sesi APAPUN secara paksa,
// dengan logika finalisasi nilai yang SAMA PERSIS dengan penutupan oleh
// pengawas (siswa yang masih AKTIF/RESET dinilai otomatis dari jawaban yang
// sempat tersinkron — lihat src/lib/finalisasi-nilai.ts), supaya tidak ada
// siswa yang hilang dari rekap nilai tanpa jejak.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, status, mapel_id, kelas, waktu_mulai, info_json')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ini sudah tidak berstatus BERJALAN' }, { status: 400 })
  }

  await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
    // Digabung dengan info_json yang sudah ada (mis. pengawas_susulan untuk
    // sesi susulan) — jangan sampai penutupan paksa ini menghapus jejak data
    // lain yang sudah tersimpan di sesi ini. Ditandai eksplisit ini
    // penutupan paksa oleh admin (bukan pengawas), supaya kalau perlu
    // ditelusuri nanti jelas kenapa sesi ini berakhir tanpa pengawas
    // menutupnya sendiri.
    info_json: {
      ...(sesi.info_json ?? {}),
      ditutup_paksa_oleh_admin: auth.user.username,
      ditutup_paksa_pada: new Date().toISOString(),
    },
  }).eq('id', sesiId)

  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
  }

  // Sama seperti /api/guru/mode-pengawas/tutup: siswa yang masih AKTIF/RESET
  // saat sesi ditutup paksa harus tetap dinilai dari jawaban yang sempat
  // tersinkron, bukan dibiarkan menggantung tanpa baris nilai.
  const { data: siswaBelumSelesai } = await db
    .from('siswa_ujian')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  const nisPerluDinilai = (siswaBelumSelesai ?? []).map(s => s.nis)
  await finalisasiNilaiPaksa(db, sesiId, nisPerluDinilai)

  return NextResponse.json({
    message: 'Sesi berhasil ditutup paksa oleh admin',
    jumlahSiswaDinilaiOtomatis: nisPerluDinilai.length,
  })
}
