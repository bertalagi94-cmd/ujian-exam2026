// Taruh di: src/app/api/guru/mode-pengawas/toggle-akses-mulai-essay/route.ts
// POST { sesiId, buka: boolean } — nyalakan/matikan akses "Mulai Essay"
// untuk SELURUH siswa di sesi ini sekaligus (toggle level sesi, BUKAN kode
// ketik manual, BUKAN per-siswa). Selama buka=true, siapa pun yang menyusul
// selesai PG setelahnya otomatis ikut boleh mulai essay — lihat catatan di
// 11_akses_mulai_essay.sql.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, buka } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })
  if (typeof buka !== 'boolean') return NextResponse.json({ error: 'buka (boolean) diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Verifikasi guru ini adalah pengawas jadwal terkait sesi tsb — pola sama
  // seperti buka-akses-essay/route.ts (akses kirim mode KERTAS).
  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('id', sesi.jadwal_id)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  if (!sesi.info_json?.essay_aktif) {
    return NextResponse.json({ error: 'Sesi ini tidak memiliki fitur essay' }, { status: 400 })
  }

  // Menyalakan toggle: WAJIB cek dulu bank soal essay untuk mapel+kelas ini
  // benar-benar sudah ada (status DISETUJUI) — kalau kosong, jangan sampai
  // toggle bisa dinyalakan (siswa nanti masuk ke halaman essay tapi soalnya
  // tidak ada). Kalau mematikan (buka=false), tidak perlu cek ini.
  if (buka) {
    // sesi.kelas menyimpan NAMA kelas (mis. "10"), sedangkan soal_essay.kelas_id
    // menyimpan ID kelas (mis. "KLS_xxx") — sama seperti resolusi di
    // essay/info/route.ts, jadi perlu di-translate dulu.
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const { count: jumlahSoal } = await db
      .from('soal_essay')
      .select('id', { count: 'exact', head: true })
      .eq('mapel_id', sesi.mapel_id)
      .eq('kelas_id', kelasId)
      .eq('status', 'DISETUJUI')

    if (!jumlahSoal || jumlahSoal === 0) {
      return NextResponse.json(
        { error: 'Tidak ada soal essay untuk mapel ini. Akses tidak dapat dibuka.' },
        { status: 400 }
      )
    }
  }

  const { error } = await db
    .from('sesi_ujian')
    .update({ akses_mulai_essay_dibuka: buka })
    .eq('id', sesiId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    aksesMulaiEssayDibuka: buka,
    message: buka ? 'Akses mulai essay dibuka untuk semua siswa.' : 'Akses mulai essay ditutup.',
  })
}
