// Taruh di: src/app/api/siswa/ujian/essay/info/route.ts
// GET ?sesiId=... — data untuk halaman info essay (sebelum tombol "Mulai")
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, status, info_json')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (!sesi.info_json?.essay_aktif) {
    return NextResponse.json({ error: 'Sesi ini tidak memiliki soal essay' }, { status: 400 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  // Siswa harus sudah submit PG (ditandai status_essay sudah di-set jadi
  // BELUM_MULAI oleh selesai/route.ts) sebelum boleh melihat halaman info essay.
  if (!siswaUjian.status_essay || siswaUjian.status_essay === null) {
    return NextResponse.json({ error: 'Selesaikan soal pilihan ganda terlebih dahulu' }, { status: 403 })
  }

  const [{ data: jadwal }, { data: mapel }, { count: jumlahSoal }] = await Promise.all([
    db.from('jadwal').select('pengawas').eq('id', sesi.jadwal_id).single(),
    db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
    db.from('soal_essay').select('id', { count: 'exact', head: true }).eq('jadwal_id', sesi.jadwal_id),
  ])

  let namaGuru: string | null = null
  if (jadwal?.pengawas) {
    const { data: guru } = await db.from('users').select('nama').eq('username', jadwal.pengawas).single()
    namaGuru = guru?.nama ?? jadwal.pengawas
  }

  return NextResponse.json({
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    namaGuru,
    jumlahSoal: jumlahSoal ?? 0,
    durasiMenit: sesi.info_json.essay_durasi_menit,
    modeJawaban: sesi.info_json.essay_mode_jawaban, // 'DIGITAL' | 'KERTAS'
    instruksi: sesi.info_json.essay_instruksi ?? null,
    statusEssay: siswaUjian.status_essay, // kalau sudah 'MENGERJAKAN', frontend lanjut ke halaman soal, bukan info lagi
  })
}
