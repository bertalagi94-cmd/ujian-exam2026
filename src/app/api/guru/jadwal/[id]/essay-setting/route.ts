// Taruh file ini di: src/app/api/guru/jadwal/[id]/essay-setting/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

// PUT /api/guru/jadwal/[id]/essay-setting
// body: { mode_jawaban: 'DIGITAL'|'KERTAS', durasi_menit, bobot_pg_persen,
//         bobot_essay_persen, instruksi? }
//
// PENTING: endpoint ini HANYA boleh dipanggil SEBELUM sesi_ujian untuk
// jadwal ini dibuka (status sesi belum ada / belum BERJALAN). Setelah sesi
// dibuka, konfigurasi essay disalin ke sesi_ujian.info_json dan menjadi
// "beku" untuk sesi tsb — lihat catatan di 07_essay.sql.
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const { id: jadwalId } = await params

  const db = createAdminClient()
  const body = await req.json()

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('id', jadwalId)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Jadwal tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  // Tolak perubahan kalau sesi untuk jadwal ini sudah pernah/sedang berjalan
  const { data: sesiAda } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('jadwal_id', jadwalId)
    .in('status', ['BERJALAN', 'SELESAI'])
    .limit(1)
    .maybeSingle()

  if (sesiAda) {
    return NextResponse.json(
      { error: 'Pengaturan essay tidak bisa diubah lagi karena sesi ujian untuk jadwal ini sudah pernah dibuka.' },
      { status: 409 }
    )
  }

  const modeJawaban = body.mode_jawaban === 'KERTAS' ? 'KERTAS' : 'DIGITAL'

  const durasiMenit = Number(body.durasi_menit)
  if (!durasiMenit || durasiMenit <= 0) {
    return NextResponse.json({ error: 'Durasi essay wajib diisi (dalam menit)' }, { status: 400 })
  }

  // Validasi durasi terhadap batas yang ditentukan Admin (pengaturan key-value)
  const { data: batasSettings } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['batas_durasi_essay_min_menit', 'batas_durasi_essay_max_menit'])

  const batasMap = Object.fromEntries((batasSettings ?? []).map(s => [s.key, Number(s.value)]))
  const batasMin = batasMap['batas_durasi_essay_min_menit'] ?? 10
  const batasMax = batasMap['batas_durasi_essay_max_menit'] ?? 180

  if (durasiMenit < batasMin || durasiMenit > batasMax) {
    return NextResponse.json({
      error: `Durasi essay harus antara ${batasMin} dan ${batasMax} menit (ditentukan Admin).`,
    }, { status: 400 })
  }

  const bobotPg = Number(body.bobot_pg_persen ?? 50)
  const bobotEssay = Number(body.bobot_essay_persen ?? 50)
  if (bobotPg + bobotEssay !== 100) {
    return NextResponse.json({ error: 'Total bobot PG + Essay harus 100%' }, { status: 400 })
  }

  const { error } = await db
    .from('jadwal')
    .update({
      essay_aktif: true,
      essay_mode_jawaban: modeJawaban,
      essay_durasi_menit: durasiMenit,
      essay_bobot_pg_persen: bobotPg,
      essay_bobot_essay_persen: bobotEssay,
      essay_instruksi: body.instruksi ? String(body.instruksi).slice(0, 2000) : null,
    })
    .eq('id', jadwalId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Pengaturan essay berhasil disimpan' })
}

// DELETE — nonaktifkan essay untuk jadwal ini (sesi berjalan seperti PG-only)
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const { id: jadwalId } = await params

  const db = createAdminClient()

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('id', jadwalId)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Jadwal tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  const { error } = await db.from('jadwal').update({ essay_aktif: false }).eq('id', jadwalId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Essay dinonaktifkan untuk jadwal ini' })
}
