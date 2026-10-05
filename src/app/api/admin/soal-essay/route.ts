import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'
import { bacaBatasDurasiEssay, validasiDurasiEssayAdmin } from '@/lib/durasi-ujian'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'MENUNGGU'

  const { data: pakets, error } = await db
    .from('paket_essay')
    .select('*')
    .eq('status', status)
    .order('tanggal', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pakets?.length) return NextResponse.json({ data: [] })

  const guruIds = [...new Set(pakets.map(p => p.guru_id).filter(Boolean))]
  const mapelIds = [...new Set(pakets.map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(pakets.map(p => p.kelas_id).filter(Boolean))]

  const [{ data: guruList }, { data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('users').select('username, nama').in('username', guruIds),
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, String(k.nama)]))

  // Info jadwal untuk popup "tetapkan durasi essay" saat validasi. Jadwal
  // menyimpan kelas sebagai NAMA (mis. "13"), sedangkan paket memakai id
  // kelas, jadi dicocokkan lewat kelasMap. Jadwal SELESAI diabaikan.
  const { data: jadwalList } = await (db as any)
    .from('jadwal')
    .select('id, mapel_id, kelas, tanggal, jam_mulai, jam_selesai, durasi, essay_durasi_menit, status')
    .in('mapel_id', mapelIds)
    .neq('status', 'SELESAI')
  const jadwalMap: Record<string, any> = {}
  for (const j of (jadwalList ?? []) as any[]) {
    jadwalMap[`${j.mapel_id}__${String(j.kelas)}`] = j
  }

  const enriched = pakets.map(p => {
    const namaKelas = kelasMap[p.kelas_id] ?? p.kelas_id
    const j = jadwalMap[`${p.mapel_id}__${String(namaKelas)}`]
    return {
      ...p,
      nama_guru: guruMap[p.guru_id] ?? p.guru_id,
      nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
      nama_kelas: namaKelas,
      // Info jadwal (null/false kalau admin belum membuat jadwalnya)
      jadwal_ada: !!j,
      jadwal_durasi_pg: j?.durasi ?? null,
      jadwal_durasi_essay: j?.essay_durasi_menit ?? null, // keputusan admin; null = ikut usulan guru
      jadwal_tanggal: j?.tanggal ?? null,
      jadwal_jam_mulai: j?.jam_mulai ?? null,
      jadwal_jam_selesai: j?.jam_selesai ?? null,
    }
  })

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { paket_id, action, catatan, durasi_essay_menit } = await req.json()

  let newStatus: string
  if (action === 'SETUJUI') newStatus = 'DISETUJUI'
  else if (action === 'TOLAK') newStatus = 'DITOLAK'
  else if (action === 'BATAL_SETUJUI') newStatus = 'DRAFT'
  else return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })

  if (action === 'TOLAK' && !catatan?.trim()) {
    return NextResponse.json(
      { error: 'Alasan penolakan wajib diisi agar guru bisa memperbaiki soalnya.' },
      { status: 400 }
    )
  }

  // Durasi essay yang ditetapkan admin lewat popup saat validasi (opsional).
  // Hanya relevan untuk SETUJUI. Tidak dikirim / kosong = admin tidak
  // mengubah, jadi jadwal dibiarkan apa adanya (kosong = ikut usulan guru).
  // Divalidasi SEBELUM status paket diubah supaya angka salah tidak membuat
  // paket terlanjur disetujui.
  let durasiTetapAdmin: number | null = null
  if (action === 'SETUJUI' && durasi_essay_menit !== undefined && durasi_essay_menit !== null && String(durasi_essay_menit).trim() !== '') {
    const { data: batasRows } = await (db as any)
      .from('pengaturan')
      .select('key, value')
      .in('key', ['batas_durasi_essay_min_menit', 'batas_durasi_essay_max_menit'])
    const cek = validasiDurasiEssayAdmin(durasi_essay_menit, bacaBatasDurasiEssay(batasRows))
    if (!cek.ok) return NextResponse.json({ error: cek.error }, { status: 422 })
    durasiTetapAdmin = cek.nilai
  }

  // FIX BUG (bank soal Essay tidak terkunci di sisi Admin setelah sesi
  // mulai): pola & alasan identik dengan fix di admin/soal/route.ts (PG) —
  // lihat komentar di sana untuk detail lengkap. Dampaknya untuk essay malah
  // lebih parah: koreksi-essay/route.ts (GET & PUT) selalu mengambil
  // soal_essay yang DISETUJUI secara live (tanpa cache) untuk membangun
  // daftar soal & bobot_maks yang wajib diisi guru. (Catatan: pertahanan
  // UTAMA sekarang ada di snapshot paket_essay_id pada sesi_ujian — lihat
  // essay/mulai/route.ts & koreksi-essay/route.ts — guard di bawah ini
  // tetap dipertahankan sebagai lapisan kedua.)
  const { data: paketUntukGuard } = await db
    .from('paket_essay')
    .select('mapel_id, kelas_id')
    .eq('id', paket_id)
    .single()

  if (paketUntukGuard) {
    const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paketUntukGuard.mapel_id, paketUntukGuard.kelas_id)
    if (sesiSudahMulai) {
      return NextResponse.json(
        { error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'mengubah') },
        { status: 409 }
      )
    }
  }

  // FIX ARSITEKTUR KRITIS (transaksi + race condition): sama seperti
  // admin/soal/route.ts (PG) — seluruh update paket_essay + soal_essay +
  // demote paket lain sekarang dijalankan lewat satu fungsi Postgres atomik
  // (set_status_paket_essay, lihat
  // supabase/14_snapshot_paket_dan_transaksi_atomik.sql) dengan row lock
  // untuk menyerialkan approval yang bertabrakan, dan unique partial index
  // sebagai penjaga terakhir di level database.
  const { error: rpcError } = await db.rpc('set_status_paket_essay', {
    p_paket_id: paket_id,
    p_new_status: newStatus,
    p_catatan: catatan || null,
  })

  if (rpcError) {
    // Status paket sudah berubah sejak halaman admin dimuat — ditolak oleh
    // fungsi database dengan SQLSTATE 'PT409' (migrasi 37).
    if (rpcError.code === 'PT409') {
      return NextResponse.json({ error: rpcError.message }, { status: 409 })
    }
    if (rpcError.code === '23505') {
      return NextResponse.json(
        { error: 'Ada paket lain yang baru saja disetujui untuk mapel & kelas yang sama. Muat ulang halaman dan coba lagi.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  // Simpan durasi pilihan admin ke jadwal mapel+kelas paket ini (kalau ada).
  let peringatan: string | undefined
  let durasiTersimpan: number | null = null
  if (action === 'SETUJUI' && durasiTetapAdmin !== null && paketUntukGuard) {
    const { data: kelasRow } = await (db as any)
      .from('kelas')
      .select('nama')
      .eq('id', paketUntukGuard.kelas_id)
      .maybeSingle()
    const namaKelas = String(kelasRow?.nama ?? paketUntukGuard.kelas_id)
    const { data: diubah, error: errJadwal } = await (db as any)
      .from('jadwal')
      .update({ essay_durasi_menit: durasiTetapAdmin })
      .eq('mapel_id', paketUntukGuard.mapel_id)
      .eq('kelas', namaKelas)
      .neq('status', 'SELESAI')
      .select('id')
    if (errJadwal) {
      peringatan = 'Paket sudah disetujui, tetapi durasi essay di jadwal gagal disimpan. Atur manual di menu Jadwal.'
    } else if (!diubah || diubah.length === 0) {
      peringatan = 'Paket sudah disetujui, tetapi belum ada jadwal untuk mapel & kelas ini, jadi durasi tidak disimpan.'
    } else {
      durasiTersimpan = durasiTetapAdmin
    }
  }

  const pesanStatus = newStatus === 'DISETUJUI' ? 'disetujui' : newStatus === 'DITOLAK' ? 'ditolak' : 'dikembalikan ke draft'
  const pesanDurasi = durasiTersimpan !== null ? ` Durasi essay di jadwal ditetapkan ${durasiTersimpan} menit.` : ''
  return NextResponse.json({
    message: `Paket berhasil ${pesanStatus}.${pesanDurasi}`,
    durasi_essay_jadwal: durasiTersimpan,
    peringatan,
  })
}
