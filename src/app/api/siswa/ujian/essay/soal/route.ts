// Taruh di: src/app/api/siswa/ujian/essay/soal/route.ts
// GET ?sesiId=... — daftar soal essay untuk ditampilkan ke siswa (teks,
// gambar_url, urutan). TIDAK menyertakan bobot_maks/kunci karena essay
// tidak punya kunci otomatis dan bobot adalah rahasia guru.
// Guard: status_essay siswa harus sudah MENGERJAKAN (sudah menekan tombol
// "Mulai" di /api/siswa/ujian/essay/mulai) sebelum boleh mengambil soal ini,
// sama seperti pola guard di essay/info/route.ts.
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
    .select('id, jadwal_id, info_json')
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
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang dikunci/menunggu reset.' }, { status: 403 })
  }
  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Sesi essay belum dimulai. Tekan tombol Mulai terlebih dahulu.' }, { status: 403 })
  }

  const { data: soalList, error } = await db
    .from('soal_essay')
    .select('id, teks, gambar_url, urutan')
    .eq('jadwal_id', sesi.jadwal_id)
    .order('urutan', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: soalList ?? [] })
}
