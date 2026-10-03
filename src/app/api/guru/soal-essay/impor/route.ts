// POST /api/guru/soal-essay/impor — impor banyak soal ESSAY sekaligus
// (hasil baca template Word di browser guru, lihat src/lib/impor-soal/).
//
// body: {
//   paket_id,                 // paket_essay milik guru (dibuat dulu lewat alur Setup seperti biasa)
//   idempotency_key?,         // sama untuk percobaan ulang → tidak menggandakan soal
//   soal: [{ teks, gambar_url?, bobot_maks }]
// }
//
// Aturan SAMA dengan POST /api/guru/soal-essay: paket harus milik guru dan
// berstatus DRAFT/DITOLAK, sesi mapel+kelas belum pernah dibuka, dan bobot
// per soal WAJIB diisi (> 0, tanpa default diam-diam di backend). Semua
// soal ditulis dengan SATU perintah INSERT (atomik). Percobaan ulang dengan
// idempotency_key yang sama dijawab sukses tanpa menyisipkan lagi (kunci per
// baris `${key}:${i}` memakai UNIQUE INDEX dari migrasi 13).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId, stripHtmlTags } from '@/lib/utils'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'
import { catatAktivitas } from '@/lib/aktivitas'
import { tandaEssay, tandaEssayDariDb } from '@/lib/impor-soal/duplikat'

const MAKS_SOAL = 200

function urlGambar(v: unknown): { ok: true; nilai: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, nilai: null }
  if (typeof v !== 'string' || v.length > 1000 || !/^https?:\/\//.test(v) || !v.includes('/assets/soal/')) {
    return { ok: false }
  }
  return { ok: true, nilai: v }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 })
  }

  if (!body.paket_id || typeof body.paket_id !== 'string') {
    return NextResponse.json({ error: 'paket_id wajib diisi' }, { status: 400 })
  }
  const daftar = body.soal
  if (!Array.isArray(daftar) || daftar.length === 0) {
    return NextResponse.json({ error: 'Tidak ada soal untuk diimpor' }, { status: 400 })
  }
  if (daftar.length > MAKS_SOAL) {
    return NextResponse.json({ error: `Maksimal ${MAKS_SOAL} soal per sekali impor` }, { status: 400 })
  }

  const kunciIdem = typeof body.idempotency_key === 'string' && body.idempotency_key ? body.idempotency_key.slice(0, 80) : null

  // Percobaan ulang dari impor yang SUDAH berhasil (respons sebelumnya
  // keburu timeout di browser) → jangan sisipkan lagi.
  if (kunciIdem) {
    const { data: sudah, error: errIdem } = await db
      .from('soal_essay')
      .select('id')
      .eq('idempotency_key', `${kunciIdem}:0`)
      .maybeSingle()
    if (errIdem) return NextResponse.json({ error: errIdem.message }, { status: 500 })
    if (sudah) {
      return NextResponse.json({ message: `${daftar.length} soal essay sudah diimpor sebelumnya`, jumlah: daftar.length }, { status: 200 })
    }
  }

  const { data: paket, error: errPaket } = await db
    .from('paket_essay')
    .select('id, mapel_id, kelas_id, guru_id, status')
    .eq('id', body.paket_id)
    .eq('guru_id', user.username)
    .maybeSingle()
  if (errPaket) return NextResponse.json({ error: errPaket.message }, { status: 500 })
  if (!paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }
  if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json({ error: 'Paket sedang menunggu/sudah divalidasi — tidak bisa menambah soal' }, { status: 400 })
  }

  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'menambah') }, { status: 409 })
  }

  // ── Validasi seluruh soal SEBELUM menulis apa pun ──
  const galat: string[] = []
  const bersih: { teks: string; gambar: string | null; bobot: number }[] = []
  daftar.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const label = `Soal ke-${i + 1}`
    const teks = stripHtmlTags(s.teks)
    const g = urlGambar(s.gambar_url)
    if (!g.ok) { galat.push(`${label}: URL gambar tidak valid`); return }
    if (!teks && !g.nilai) { galat.push(`${label}: soal belum diisi (teks atau gambar)`); return }
    const bobot = Number(s.bobot_maks)
    if (!s.bobot_maks || !Number.isFinite(bobot) || bobot <= 0) {
      galat.push(`${label}: bobot maksimal wajib diisi dan harus lebih dari 0`)
      return
    }
    bersih.push({ teks, gambar: g.nilai, bobot })
  })
  if (galat.length > 0) {
    const tampil = galat.slice(0, 5).join('; ')
    const sisa = galat.length > 5 ? ` (+${galat.length - 5} kesalahan lain)` : ''
    return NextResponse.json({ error: `${tampil}${sisa}` }, { status: 400 })
  }

  // Pengaman duplikat: buang soal yang sama dengan yang sudah ada di paket.
  const { data: adaEssay, error: errDup } = await db
    .from('soal_essay')
    .select('teks, gambar_url')
    .eq('paket_essay_id', paket.id)
  if (errDup) return NextResponse.json({ error: errDup.message }, { status: 500 })
  const sudahAda = new Set<string>()
  for (const r of adaEssay ?? []) {
    const t = tandaEssayDariDb(r as Record<string, unknown>)
    if (t) sudahAda.add(t)
  }
  const unik: typeof bersih = []
  for (const b of bersih) {
    const t = tandaEssay(b.teks)
    if (t && sudahAda.has(t)) continue
    if (t) sudahAda.add(t)
    unik.push(b)
  }
  const dilewati = bersih.length - unik.length
  if (unik.length === 0) {
    return NextResponse.json(
      { error: `Semua ${bersih.length} soal dalam file ini sudah ada di paket (isinya sama persis), jadi tidak ada yang diimpor lagi.` },
      { status: 409 }
    )
  }
  bersih.length = 0
  bersih.push(...unik)

  const { data: terakhir, error: errUrut } = await db
    .from('soal_essay')
    .select('urutan')
    .eq('paket_essay_id', paket.id)
    .order('urutan', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (errUrut) return NextResponse.json({ error: errUrut.message }, { status: 500 })
  const urutanAwal = (terakhir?.urutan ?? 0) + 1

  const baris = bersih.map((b, i) => ({
    id: generateId('SE'),
    paket_essay_id: paket.id,
    mapel_id: paket.mapel_id,
    kelas_id: paket.kelas_id,
    guru_id: user.username,
    teks: b.teks,
    gambar_url: b.gambar,
    bobot_maks: b.bobot,
    urutan: urutanAwal + i,
    status: 'DRAFT',
    idempotency_key: kunciIdem ? `${kunciIdem}:${i}` : null,
  }))

  const { error: errInsert } = await db.from('soal_essay').insert(baris)
  if (errInsert) {
    // 23505 = unique_violation: dua permintaan dengan kunci yang sama nyaris
    // bersamaan — yang lain sudah menang, anggap sukses.
    if (kunciIdem && (errInsert as { code?: string }).code === '23505') {
      return NextResponse.json({ message: `${baris.length} soal essay sudah diimpor sebelumnya`, jumlah: baris.length }, { status: 200 })
    }
    return NextResponse.json({ error: errInsert.message }, { status: 500 })
  }

  // Sama dengan POST /api/guru/soal-essay: jumlah_soal = urutan terakhir.
  await db.from('paket_essay').update({ jumlah_soal: urutanAwal + baris.length - 1 }).eq('id', paket.id)

  catatAktivitas(db, user.username, 'BUAT_SOAL', `Guru ${user.username} mengimpor ${baris.length} soal essay dari file Word`)

  return NextResponse.json(
    { message: `${baris.length} soal essay berhasil diimpor`, jumlah: baris.length, dilewati },
    { status: 201 }
  )
}
