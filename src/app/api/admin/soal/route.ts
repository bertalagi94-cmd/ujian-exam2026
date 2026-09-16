import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'MENUNGGU'

  const { data: pakets, error } = await db
    .from('paket_soal')
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

  const enriched = pakets.map(p => ({
    ...p,
    nama_guru: guruMap[p.guru_id] ?? p.guru_id,
    nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
    nama_kelas: kelasMap[p.kelas_id] ?? p.kelas_id,
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { paket_id, action, catatan } = await req.json()

  let newStatus: string
  if (action === 'SETUJUI') newStatus = 'DISETUJUI'
  else if (action === 'TOLAK') newStatus = 'DITOLAK'
  else if (action === 'BATAL_SETUJUI') newStatus = 'DRAFT'
  else return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })

  // Catatan wajib diisi saat menolak agar guru tahu apa yang perlu diperbaiki.
  // Validasi di sini (server) sebagai pengaman — UI sudah memblokir lebih awal.
  if (action === 'TOLAK' && !catatan?.trim()) {
    return NextResponse.json(
      { error: 'Alasan penolakan wajib diisi agar guru bisa memperbaiki soalnya.' },
      { status: 400 }
    )
  }

  // FIX BUG (bank soal PG tidak terkunci di sisi Admin setelah sesi mulai):
  // cekSesiMapelKelasSudahMulai() sudah dipakai di SEMUA endpoint GURU yang
  // membuat/mengubah/menghapus paket_soal/soal (lihat doc-comment fungsi ini
  // di sesi-kelas.ts), tapi endpoint admin INI — yang mengubah status paket
  // lewat SETUJUI/TOLAK/BATAL_SETUJUI (otomatis ikut mengubah status semua
  // soal di dalamnya) — tidak pernah memeriksa guard yang sama sebelum fix
  // ini. FIX: tolak SETUJUI/TOLAK/BATAL_SETUJUI begitu sesi ujian untuk
  // mapel+kelas paket ini sudah BERJALAN atau SELESAI — persis pola guard
  // yang sama dengan sisi Guru. (Catatan: ini lapisan pertahanan tambahan —
  // pertahanan UTAMA terhadap "kunci berubah setelah siswa mulai" sekarang
  // ada di snapshot paket_soal_id pada sesi_ujian, lihat
  // src/lib/penilaian-ujian.ts & validasi/route.ts.)
  const { data: paketUntukGuard } = await db
    .from('paket_soal')
    .select('mapel_id, kelas_id')
    .eq('id', paket_id)
    .single()

  if (paketUntukGuard) {
    const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paketUntukGuard.mapel_id, paketUntukGuard.kelas_id)
    if (sesiSudahMulai) {
      return NextResponse.json(
        { error: pesanBankSoalTerkunci('PG', sesiSudahMulai, 'mengubah') },
        { status: 409 }
      )
    }
  }

  // FIX ARSITEKTUR KRITIS (transaksi + race condition): sebelumnya bagian
  // ini melakukan (a) cari & demote paket DISETUJUI lain, (b) update
  // paket_soal.status, (c) update soal.status — sebagai 3+ panggilan
  // Supabase TERPISAH, tidak atomik. Kalau salah satu gagal di tengah
  // (network blip dsb.), paket dan soal bisa berakhir dengan status yang
  // berbeda (lihat temuan audit #3). Selain itu check-then-act di JS ini
  // rawan race condition kalau dua admin menyetujui DUA PAKET BERBEDA untuk
  // mapel+kelas yang sama nyaris bersamaan (temuan audit #2) — keduanya bisa
  // lolos sebelum salah satu sempat menulis.
  //
  // FIX: seluruh logika di atas sekarang dijalankan lewat satu fungsi
  // Postgres (set_status_paket_soal, lihat
  // supabase/14_snapshot_paket_dan_transaksi_atomik.sql) yang atomik (satu
  // transaksi database) DAN memakai row lock (FOR UPDATE) untuk menyerialkan
  // approval yang bertabrakan pada mapel+kelas yang sama. Unique partial
  // index pada (mapel_id, kelas_id) WHERE status='DISETUJUI' di migrasi yang
  // sama jadi penjaga terakhir kalau toh ada bug lain yang mencoba melewati
  // ini — Postgres akan menolak dengan error unique_violation, bukan diam-
  // diam membuat 2 baris DISETUJUI.
  const { error: rpcError } = await db.rpc('set_status_paket_soal', {
    p_paket_id: paket_id,
    p_new_status: newStatus,
    p_catatan: catatan || null,
  })

  if (rpcError) {
    // unique_violation dari uq_paket_soal_disetujui_per_kelas — seharusnya
    // nyaris tidak pernah terjadi berkat row lock di dalam fungsi, tapi kalau
    // toh terjadi, admin diberi pesan yang jelas (bukan error 500 generik)
    // untuk mencoba lagi.
    if (rpcError.code === '23505') {
      return NextResponse.json(
        { error: 'Ada paket lain yang baru saja disetujui untuk mapel & kelas yang sama. Muat ulang halaman dan coba lagi.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  const pesanStatus = newStatus === 'DISETUJUI' ? 'disetujui' : newStatus === 'DITOLAK' ? 'ditolak' : 'dikembalikan ke draft'
  return NextResponse.json({ message: `Paket berhasil ${pesanStatus}` })
}
