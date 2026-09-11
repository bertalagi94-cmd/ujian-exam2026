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

  // FIX: samakan dengan guard di essay/mulai, essay/soal, essay/jawab, dan
  // essay/upload-foto — sebelumnya endpoint ini TIDAK memeriksa status
  // TERKUNCI/RESET sama sekali, jadi siswa yang sudah dikunci permanen atau
  // sedang menunggu kode reset pengawas tetap bisa mengambil info essay
  // (nama mapel, jumlah soal, durasi, instruksi guru) padahal seharusnya
  // sudah diblokir total, sama seperti endpoint essay lainnya.
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }

  // Siswa harus sudah submit PG (ditandai status_essay sudah di-set jadi
  // BELUM_MULAI oleh selesai/route.ts) sebelum boleh melihat halaman info essay.
  if (!siswaUjian.status_essay || siswaUjian.status_essay === null) {
    return NextResponse.json({ error: 'Selesaikan soal pilihan ganda terlebih dahulu' }, { status: 403 })
  }

  // Soal essay sekarang berupa bank per mapel+kelas (paket_essay), sama
  // seperti soal PG — bukan lagi melekat ke jadwal_id. Lihat 08_paket_essay.sql.
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  const [{ data: jadwal }, { data: mapel }, { count: jumlahSoal }] = await Promise.all([
    db.from('jadwal').select('pengawas').eq('id', sesi.jadwal_id).single(),
    db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
    // FIX BUG (fitur essay): hitung hanya soal essay yang sudah DISETUJUI —
    // sebelumnya soal DRAFT ikut terhitung, sehingga "jumlah soal" yang
    // ditampilkan di halaman info bisa lebih besar dari jumlah soal yang
    // sebenarnya akan diberikan ke siswa di /essay/soal (lihat FIX di sana).
    db.from('soal_essay').select('id', { count: 'exact', head: true }).eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI'),
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
