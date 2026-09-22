import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId, stripHtmlTags } from '@/lib/utils'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'
import { catatAktivitas } from '@/lib/aktivitas'
import { validasiKunciOpsi } from '@/lib/validasi-soal'
import { verifikasiKepemilikanMapelKelas, verifikasiKepemilikanPaketSoal } from '@/lib/guru-scope'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '15')
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status') ?? ''
  const mapelId = searchParams.get('mapel_id') ?? ''

  let query = db
    .from('soal')
    .select('*', { count: 'exact' })
    .eq('guru_id', user.username)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('teks', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (mapelId) query = query.eq('mapel_id', mapelId)

  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich with nama_mapel
  const soalList = data ?? []
  if (soalList.length > 0) {
    const mapelIds = [...new Set(soalList.map((s: { mapel_id: string }) => s.mapel_id).filter(Boolean))]
    const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
    const mapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))
    const enriched = soalList.map((s: Record<string, unknown>) => ({ ...s, nama_mapel: mapelMap[s.mapel_id as string] ?? s.mapel_id }))
    return NextResponse.json({ data: enriched, total: count ?? 0 })
  }

  return NextResponse.json({ data: soalList, total: count ?? 0 })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()

  // FIX BUG (IDOR — dua celah sekaligus): sebelumnya endpoint ini langsung
  // memakai body.mapel_id/body.kelas_id/body.paket_id untuk insert tanpa
  // verifikasi apa pun.
  //   Masalah A: guru bisa mengirim mapel_id/kelas_id milik guru lain, soal
  //   masuk ke mapel/kelas yang bukan kewenangannya.
  //   Masalah B: guru bisa mengirim paket_id milik guru lain (tidak ada
  //   `.eq('guru_id', user.username)` untuk paket), sehingga bisa menyisipkan
  //   soal ke paket milik guru lain.
  // Keduanya diverifikasi di sini SEBELUM insert — lihat src/lib/guru-scope.ts.
  const verifikasiMapelKelas = await verifikasiKepemilikanMapelKelas(db, user.username, body.mapel_id, body.kelas_id)
  if (!verifikasiMapelKelas.ok) {
    return NextResponse.json({ error: verifikasiMapelKelas.error }, { status: verifikasiMapelKelas.status })
  }
  const verifikasiPaket = await verifikasiKepemilikanPaketSoal(db, user.username, body.paket_id, body.mapel_id, body.kelas_id)
  if (!verifikasiPaket.ok) {
    return NextResponse.json({ error: verifikasiPaket.error }, { status: verifikasiPaket.status })
  }

  // Validasi: teks opsi wajib diisi KECUALI kalau gambar opsi sudah ada.
  // Opsi D dan E opsional sepenuhnya (tergantung jumlah_opsi).
  const jumlahOpsi = parseInt(body.jumlah_opsi) || 4
  const opsiWajib = ['a', 'b', 'c', ...(jumlahOpsi >= 4 ? ['d'] : []), ...(jumlahOpsi >= 5 ? ['e'] : [])]
  const opsiKurang = opsiWajib.filter(l => {
    const teks = stripHtmlTags(body[`opsi_${l}`])
    const gambar = body[`gambar_opsi_${l}`] || null
    return !teks && !gambar
  })
  if (opsiKurang.length > 0) {
    return NextResponse.json({
      error: `Opsi ${opsiKurang.map(l => l.toUpperCase()).join(', ')} harus diisi teks atau gambar.`,
    }, { status: 400 })
  }

  // FIX BUG (kunci jawaban belum divalidasi server terhadap jumlah opsi):
  // sebelumnya server hanya memvalidasi TEKS opsi A-E terisi sesuai
  // jumlah_opsi, tapi tidak pernah memvalidasi bahwa `kunci` benar-benar
  // salah satu huruf opsi yang valid (mis. jumlah_opsi=4 tapi kunci='E').
  // Soal seperti itu tetap tersimpan, dan mesin penilaian
  // (hitungHasilPenilaian di penilaian-ujian.ts) akan SELALU menyalahkan
  // semua siswa untuk soal itu karena tidak ada jawaban yang bisa cocok
  // dengan kunci yang tidak valid. Lihat src/lib/validasi-soal.ts.
  const errorKunci = validasiKunciOpsi(body.kunci, jumlahOpsi)
  if (errorKunci) {
    return NextResponse.json({ error: errorKunci }, { status: 400 })
  }

  // Cegah menambah soal PG untuk mapel+kelas yang sesi ujiannya sudah
  // pernah dibuka (sedang berjalan atau sudah selesai) — lihat sesi-kelas.ts
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, body.mapel_id, body.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('PG', sesiSudahMulai, 'menambah') }, { status: 409 })
  }

  const { error } = await db.from('soal').insert({
    id: generateId('SL'),
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    guru_id: user.username,
    teks: stripHtmlTags(body.teks),
    gambar_pertanyaan: body.gambar_pertanyaan || null,
    opsi_a: stripHtmlTags(body.opsi_a),
    opsi_b: stripHtmlTags(body.opsi_b),
    opsi_c: stripHtmlTags(body.opsi_c),
    opsi_d: body.opsi_d ? stripHtmlTags(body.opsi_d) : null,
    opsi_e: body.opsi_e ? stripHtmlTags(body.opsi_e) : null,
    gambar_opsi_a: body.gambar_opsi_a || null,
    gambar_opsi_b: body.gambar_opsi_b || null,
    gambar_opsi_c: body.gambar_opsi_c || null,
    gambar_opsi_d: body.gambar_opsi_d || null,
    gambar_opsi_e: body.gambar_opsi_e || null,
    kunci: String(body.kunci).trim().toUpperCase(),
    pembahasan: body.pembahasan ? stripHtmlTags(body.pembahasan) : null,
    tingkat: body.tingkat ?? 'Sedang',
    jumlah_opsi: parseInt(body.jumlah_opsi) || 4,
    status: 'DRAFT',
    acak: body.acak ?? 'YA',
    paket_id: body.paket_id || null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Catat aktivitas nyata (bukan cuma login) supaya Network Flow Monitor
  // di admin benar-benar menampilkan pergerakan guru membuat soal.
  catatAktivitas(db, user.username, 'BUAT_SOAL', `Guru ${user.username} menambahkan soal baru`)

  return NextResponse.json({ message: 'Soal berhasil ditambahkan' }, { status: 201 })
}
