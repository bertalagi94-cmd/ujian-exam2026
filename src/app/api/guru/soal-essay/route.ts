// Taruh file ini di: src/app/api/guru/soal-essay/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId, stripHtmlTags } from '@/lib/utils'

// GET /api/guru/soal-essay?jadwal_id=...
// Daftar soal essay milik SATU jadwal (bank soal essay memang melekat per
// jadwal, bukan lintas jadwal — lihat catatan di 07_essay.sql).
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const jadwalId = searchParams.get('jadwal_id') ?? ''

  if (!jadwalId) {
    return NextResponse.json({ error: 'jadwal_id wajib diisi' }, { status: 400 })
  }

  // Pastikan jadwal ini milik guru yang login (sebagai pengawas) —
  // konsisten dengan pengecekan di mode-pengawas/route.ts.
  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas, essay_aktif, essay_mode_jawaban, essay_durasi_menit, essay_bobot_pg_persen, essay_bobot_essay_persen, essay_instruksi')
    .eq('id', jadwalId)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Jadwal tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  const { data, error } = await db
    .from('soal_essay')
    .select('*')
    .eq('jadwal_id', jadwalId)
    .order('urutan', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [], jadwal })
}

// POST /api/guru/soal-essay
// body: { jadwal_id, mapel_id, kelas_id, teks, gambar_url?, bobot_maks, urutan? }
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()

  if (!body.jadwal_id) {
    return NextResponse.json({ error: 'jadwal_id wajib diisi' }, { status: 400 })
  }

  const teks = stripHtmlTags(body.teks)
  if (!teks) {
    return NextResponse.json({ error: 'Teks soal wajib diisi' }, { status: 400 })
  }

  const bobotMaks = Number(body.bobot_maks)
  if (!bobotMaks || bobotMaks <= 0) {
    return NextResponse.json({ error: 'Bobot maksimal soal harus lebih dari 0' }, { status: 400 })
  }

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('id', body.jadwal_id)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Jadwal tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  // Tentukan urutan otomatis kalau tidak dikirim: setelah soal essay terakhir
  let urutan = Number(body.urutan)
  if (!urutan) {
    const { data: terakhir } = await db
      .from('soal_essay')
      .select('urutan')
      .eq('jadwal_id', body.jadwal_id)
      .order('urutan', { ascending: false })
      .limit(1)
      .single()
    urutan = (terakhir?.urutan ?? 0) + 1
  }

  const id = generateId('SE')
  const { error } = await db.from('soal_essay').insert({
    id,
    jadwal_id: body.jadwal_id,
    mapel_id: body.mapel_id || null,
    kelas_id: body.kelas_id || null,
    guru_id: user.username,
    teks,
    gambar_url: body.gambar_url || null,
    bobot_maks: bobotMaks,
    urutan,
    status: 'DRAFT',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Setelah ada minimal 1 soal essay, aktifkan flag essay_aktif di jadwal
  // (guru masih bisa menonaktifkan lewat endpoint /essay-setting jika mau
  // membuat sesi PG-saja walau sudah pernah membuat draft soal essay).
  await db.from('jadwal').update({ essay_aktif: true }).eq('id', body.jadwal_id)

  return NextResponse.json({ message: 'Soal essay berhasil ditambahkan', id }, { status: 201 })
}
