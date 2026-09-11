import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { data: pakets, error } = await db
    .from('paket_essay')
    .select('*')
    .eq('guru_id', user.username)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pakets?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(pakets.map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(pakets.map(p => p.kelas_id).filter(Boolean))]

  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, String(k.nama)]))

  const paketIds = pakets.map(p => p.id)
  const { data: soalCounts } = await db
    .from('soal_essay')
    .select('paket_essay_id')
    .in('paket_essay_id', paketIds)
    .limit(20000)

  const countMap: Record<string, number> = {}
  for (const s of soalCounts ?? []) {
    if (s.paket_essay_id) countMap[s.paket_essay_id] = (countMap[s.paket_essay_id] ?? 0) + 1
  }

  const enriched = pakets.map(p => ({
    ...p,
    nama_mapel: mapelMap[p.mapel_id] ?? undefined,
    nama_kelas: kelasMap[p.kelas_id] ?? undefined,
    jumlah_soal: countMap[p.id] ?? 0,
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const body = await req.json()

  if (!body.mapel_id || !body.kelas_id) {
    return NextResponse.json({ error: 'Mata pelajaran dan kelas wajib diisi' }, { status: 400 })
  }

  const modeJawaban = body.mode_jawaban === 'KERTAS' ? 'KERTAS' : 'DIGITAL'
  const durasiMenit = Number(body.durasi_menit) > 0 ? Number(body.durasi_menit) : 30

  // FIX (bobot PG:Essay): bobot sekarang diatur di sini (per paket_essay,
  // per mapel+kelas), bukan lagi per jadwal — lihat 09_bobot_paket_essay.sql.
  // Kedua angka wajib berjumlah 100; kalau tidak dikirim, default 50/50.
  let bobotPgPersen = Number(body.bobot_pg_persen)
  let bobotEssayPersen = Number(body.bobot_essay_persen)
  if (!Number.isFinite(bobotPgPersen) || !Number.isFinite(bobotEssayPersen)) {
    bobotPgPersen = 50
    bobotEssayPersen = 50
  }
  if (bobotPgPersen < 0 || bobotPgPersen > 100 || bobotEssayPersen < 0 || bobotEssayPersen > 100 || bobotPgPersen + bobotEssayPersen !== 100) {
    return NextResponse.json({ error: 'Bobot PG dan Essay harus berjumlah 100%' }, { status: 400 })
  }

  // FIX (gap): batas durasi essay yang ditentukan admin (Pengaturan > Ujian)
  // tadinya hanya tersimpan di tabel `pengaturan` tanpa pernah divalidasi di
  // mana pun. Divalidasi di sini sebagai sumber kebenaran (bukan lewat
  // /api/public/pengaturan yang di-cache 60 detik), supaya guru tidak bisa
  // membuat paket dengan durasi di luar batas walau lewat panggilan API
  // langsung.
  const { data: batasRows } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['batas_durasi_essay_min_menit', 'batas_durasi_essay_max_menit'])
  const batasMap = Object.fromEntries((batasRows ?? []).map(r => [r.key, r.value]))
  const durasiMin = Number(batasMap.batas_durasi_essay_min_menit) || 10
  const durasiMax = Number(batasMap.batas_durasi_essay_max_menit) || 180
  if (durasiMenit < durasiMin || durasiMenit > durasiMax) {
    return NextResponse.json(
      { error: `Durasi essay harus antara ${durasiMin} dan ${durasiMax} menit (diatur oleh admin).` },
      { status: 400 }
    )
  }

  // Cegah guru membuat paket essay ganda untuk mapel + kelas yang sama
  const { data: existing, error: checkError } = await db
    .from('paket_essay')
    .select('id')
    .eq('guru_id', user.username)
    .eq('mapel_id', body.mapel_id)
    .eq('kelas_id', body.kelas_id)
    .limit(1)

  if (checkError) return NextResponse.json({ error: checkError.message }, { status: 500 })
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: 'Paket soal essay untuk mapel dan kelas ini sudah ada. Silakan lanjutkan mengisi soal pada paket yang sudah dibuat.' },
      { status: 409 }
    )
  }

  // Cegah membuat paket essay baru untuk mapel+kelas yang sesi ujiannya
  // sudah pernah dibuka (sedang berjalan atau sudah selesai) — mis. guru
  // hanya membuat paket PG sebelumnya, ujian sudah/sedang berjalan tanpa
  // essay, lalu tiba-tiba mencoba menambah essay untuk mapel+kelas itu.
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, body.mapel_id, body.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'menambah') }, { status: 409 })
  }

  const { error } = await db.from('paket_essay').insert({
    id: generateId('PKE'),
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    guru_id: user.username,
    status: 'DRAFT',
    jumlah_soal: 0,
    mode_jawaban: modeJawaban,
    durasi_menit: durasiMenit,
    bobot_pg_persen: bobotPgPersen,
    bobot_essay_persen: bobotEssayPersen,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Paket soal essay berhasil dibuat' }, { status: 201 })
}
