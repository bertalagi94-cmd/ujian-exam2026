import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'
import { verifikasiKepemilikanMapelKelas } from '@/lib/guru-scope'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { data: pakets, error } = await db
    .from('paket_soal')
    .select('*')
    .eq('guru_id', user.username)
    .order('created_at', { ascending: false })
    .limit(500) // safety limit: cegah query tak terbatas jika paket sudah sangat banyak

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

  // Hitung jumlah_soal real-time dari tabel soal (bukan dari kolom cached)
  // Ambil hanya paket_id (head count per grup), pakai index idx_soal_paket yang sudah ada
  const paketIds = pakets.map(p => p.id)
  const { data: soalCounts } = await db
    .from('soal')
    .select('paket_id')
    .in('paket_id', paketIds)
    .limit(20000) // safety limit: cegah query tak terbatas jika soal sudah sangat banyak

  const countMap: Record<string, number> = {}
  for (const s of soalCounts ?? []) {
    if (s.paket_id) countMap[s.paket_id] = (countMap[s.paket_id] ?? 0) + 1
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

  // FIX BUG (IDOR): sebelumnya body.mapel_id/body.kelas_id langsung dipakai
  // tanpa verifikasi bahwa guru ini benar-benar mengampu mapel tersebut dan
  // kelas tersebut termasuk kelas_list mapel itu. Guru A bisa mengirim
  // mapel_id/kelas_id milik Guru B dan server tetap membuat paket atas nama
  // Guru A untuk mapel/kelas Guru B. Pola verifikasi sama seperti yang sudah
  // benar di guru/paket/[id]/duplicate/route.ts — lihat src/lib/guru-scope.ts.
  const verifikasi = await verifikasiKepemilikanMapelKelas(db, user.username, body.mapel_id, body.kelas_id)
  if (!verifikasi.ok) {
    return NextResponse.json({ error: verifikasi.error }, { status: verifikasi.status })
  }

  // Cegah guru membuat paket soal ganda untuk mapel + kelas yang sama
  const { data: existing, error: checkError } = await db
    .from('paket_soal')
    .select('id')
    .eq('guru_id', user.username)
    .eq('mapel_id', body.mapel_id)
    .eq('kelas_id', body.kelas_id)
    .limit(1)

  if (checkError) return NextResponse.json({ error: checkError.message }, { status: 500 })
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: 'Paket soal untuk mapel dan kelas ini sudah ada. Silakan lanjutkan mengisi soal pada paket yang sudah dibuat.' },
      { status: 409 }
    )
  }

  // Cegah membuat paket PG baru untuk mapel+kelas yang sesi ujiannya sudah
  // pernah dibuka (sedang berjalan atau sudah selesai) — lihat sesi-kelas.ts
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, body.mapel_id, body.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('PG', sesiSudahMulai, 'menambah') }, { status: 409 })
  }

  // FIX (draft kosong tertinggal): endpoint ini dulu langsung insert baris
  // paket_soal begitu guru menekan "Buat Paket" di step setup — SEBELUM satu
  // soal pun sempat diisi/disimpan. Kalau device/koneksi mati tepat di titik
  // itu, tertinggal draft kosong (jumlah_soal 0) yang membingungkan guru saat
  // kembali ("kok sudah ada draft padahal belum isi apa-apa?").
  //
  // Sekarang FE (src/app/guru/paket/page.tsx) memanggil endpoint ini dua kali
  // dengan tujuan beda:
  //   1. `dry_run: true` saat guru menekan "Buat Paket" di step setup — HANYA
  //      menjalankan validasi di atas (duplikat & sesi terkunci) tanpa insert,
  //      supaya guru langsung tahu kalau kombinasi mapel+kelasnya tidak valid
  //      SEBELUM mulai mengetik soal.
  //   2. Tanpa `dry_run` (insert sungguhan) — dipanggil FE hanya pada saat
  //      soal pertama BERHASIL disimpan. Dengan begitu baris paket_soal baru
  //      benar-benar ada di DB kalau minimal 1 soal sudah tersimpan; kalau
  //      guru belum sempat menyimpan soal apa pun lalu keluar/crash, tidak
  //      ada draft kosong yang tertinggal sama sekali.
  if (body.dry_run) {
    return NextResponse.json({ message: 'Valid, siap membuat soal' })
  }

  const id = generateId('PKT')
  const { error } = await db.from('paket_soal').insert({
    id,
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    guru_id: user.username,
    status: 'DRAFT',
    jumlah_soal: 0,
    acak: body.acak ?? 'YA',
    mode_jawaban: body.mode_jawaban === 'KERTAS' ? 'KERTAS' : 'DIGITAL',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id, message: 'Paket berhasil dibuat' }, { status: 201 })
}
