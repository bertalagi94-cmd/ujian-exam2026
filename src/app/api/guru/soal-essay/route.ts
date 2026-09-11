// GET /api/guru/soal-essay?paket_id=...  — daftar soal essay dalam SATU paket
// POST /api/guru/soal-essay                — tambah soal essay ke paket
//
// Sekarang soal essay melekat ke paket_essay (bank per mapel+kelas), bukan
// ke jadwal_id lagi — lihat 08_paket_essay.sql.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId, stripHtmlTags } from '@/lib/utils'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const paketId = searchParams.get('paket_id') ?? ''

  if (!paketId) {
    return NextResponse.json({ error: 'paket_id wajib diisi' }, { status: 400 })
  }

  const { data: paket } = await db
    .from('paket_essay')
    .select('id, guru_id')
    .eq('id', paketId)
    .eq('guru_id', user.username)
    .single()

  if (!paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  const { data, error } = await db
    .from('soal_essay')
    .select('*')
    .eq('paket_essay_id', paketId)
    .order('urutan', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}

// body: { paket_id, teks, gambar_url?, urutan? }
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()

  if (!body.paket_id) {
    return NextResponse.json({ error: 'paket_id wajib diisi' }, { status: 400 })
  }

  const teks = stripHtmlTags(body.teks)
  if (!teks) {
    return NextResponse.json({ error: 'Teks soal wajib diisi' }, { status: 400 })
  }

  // FIX (hapus bobot per-soal dari alur pembuatan): bobot_maks per soal
  // TIDAK dipakai dalam rumus nilai_total (lihat catatan di
  // koreksi-essay/route.ts) — hanya kolom legacy dengan DEFAULT 100 di DB
  // (lihat 07_essay.sql). Guru tidak perlu mengisinya lagi saat membuat soal.

  const { data: paket } = await db
    .from('paket_essay')
    .select('id, mapel_id, kelas_id, guru_id, status')
    .eq('id', body.paket_id)
    .eq('guru_id', user.username)
    .single()

  if (!paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json({ error: 'Paket sedang menunggu/sudah divalidasi — tidak bisa menambah soal' }, { status: 400 })
  }

  // Cegah menambah soal essay kalau sesi ujian untuk mapel+kelas paket ini
  // sudah pernah dibuka (sedang berjalan atau sudah selesai) — mis. guru
  // hanya membuat paket PG, ujian sudah/sedang berjalan tanpa essay, lalu
  // tiba-tiba mencoba menambah soal essay untuk mapel+kelas yang sama.
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'menambah') }, { status: 409 })
  }

  let urutan = Number(body.urutan)
  if (!urutan) {
    const { data: terakhir } = await db
      .from('soal_essay')
      .select('urutan')
      .eq('paket_essay_id', body.paket_id)
      .order('urutan', { ascending: false })
      .limit(1)
      .single()
    urutan = (terakhir?.urutan ?? 0) + 1
  }

  const id = generateId('SE')
  const { error } = await db.from('soal_essay').insert({
    id,
    paket_essay_id: paket.id,
    mapel_id: paket.mapel_id,
    kelas_id: paket.kelas_id,
    guru_id: user.username,
    teks,
    gambar_url: body.gambar_url || null,
    urutan,
    status: 'DRAFT',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db.from('paket_essay').update({ jumlah_soal: urutan }).eq('id', paket.id)

  return NextResponse.json({ message: 'Soal essay berhasil ditambahkan', id }, { status: 201 })
}
