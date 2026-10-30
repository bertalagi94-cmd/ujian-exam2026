import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { antreanSuperAdmin } from '@/lib/admin-kelas'
import { ubahStatusPaket, perkayaPaket } from '@/lib/persetujuan-paket'
import { bacaBatasDurasiEssay, validasiDurasiEssayAdmin } from '@/lib/durasi-ujian'

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'MENUNGGU'

  const { data: pakets, error } = await db
    .from('paket_essay')
    .select('*')
    .eq('status', status)
    .order('tanggal', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Admin Kelas aktif → antrean MENUNGGU hanya berisi kelas tanpa Admin Kelas
  // (lihat antreanSuperAdmin). Tab Disetujui/Ditolak tetap lengkap.
  const daftar = status === 'MENUNGGU' ? await antreanSuperAdmin(db, pakets ?? []) : (pakets ?? [])
  if (!daftar.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(daftar.map(p => p.mapel_id).filter(Boolean))]
  const diperkaya = await perkayaPaket(db, daftar)

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

  const enriched = diperkaya.map(p => {
    const j = jadwalMap[`${p.mapel_id}__${String(p.nama_kelas)}`]
    return {
      ...p,
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
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
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

  // Guard sesi-sudah-mulai + RPC atomik set_status_paket_essay + pemetaan error
  // kini ada di src/lib/persetujuan-paket.ts (dipakai bersama Admin Kelas).
  const hasil = await ubahStatusPaket(db, 'ESSAY', { paketId: paket_id, aksi: action, catatan })
  if (!hasil.ok) return NextResponse.json({ error: hasil.error }, { status: hasil.httpStatus })
  const paketUntukGuard = hasil.paket

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
