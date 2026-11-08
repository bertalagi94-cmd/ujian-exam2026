// /api/admin/ruang-khusus
//
// Admin menyiapkan RUANG KHUSUS (lab komputer untuk siswa tanpa HP):
//   GET   ?tanggal=YYYY-MM-DD  -> jadwal yang belum selesai pada tanggal itu,
//                                  daftar guru, dan daftar ruang yang ada.
//   POST  { nama?, pengawas, jadwalIds[] } -> buat ruang. Sistem memastikan guru
//                                  bebas pada jam semua jadwal yang dipilih.
//   PATCH { id, aksi: 'batal' }  -> batalkan ruang yang belum dimulai.
//
// Menutup sesi ruang yang sedang berjalan memakai tutup paksa sesi biasa
// (admin/sesi/[id]/tutup-paksa), yang sudah paham sesi ruang.
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'
import { generateId } from '@/lib/utils'
import { buatKodeRuangUnik, cekGuruBebas, STATUS_RUANG_AKTIF } from '@/lib/ruang-khusus'

export const dynamic = 'force-dynamic'

const TANGGAL_VALID = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const zona = await getZonaWaktuSekolah(yayasanIdDari(auth.user))
  const qTanggal = req.nextUrl.searchParams.get('tanggal')
  const tanggal = qTanggal && TANGGAL_VALID.test(qTanggal) ? qTanggal : tanggalHariIni(zona)

  // ── Jadwal pada tanggal itu yang belum selesai (yang sedang berjalan boleh) ──
  const { data: jadwalRaw, error: errJadwal } = await db
    .from('jadwal')
    .select('id, tanggal, sesi, jam_mulai, jam_selesai, mapel_id, kelas, pengawas, status')
    .eq('tanggal', tanggal)
    .order('jam_mulai', { ascending: true })
  if (errJadwal) return NextResponse.json({ error: errJadwal.message }, { status: 500 })
  const jadwalHari = jadwalRaw ?? []

  // Status jadwal mentah bisa basi: turunkan dari sesinya. Jadwal dianggap
  // aktif bila ada sesi BERJALAN, atau belum punya sesi sama sekali.
  const idJadwalHari = jadwalHari.map(j => j.id)
  const { data: sesiHari } = idJadwalHari.length
    ? await db.from('sesi_ujian').select('jadwal_id, status, ruang_khusus_id').in('jadwal_id', idJadwalHari)
    : { data: [] as { jadwal_id: string; status: string; ruang_khusus_id: string | null }[] }
  const sesiKelasPerJadwal = new Map<string, string[]>()
  const adaBerjalan = new Set<string>()
  for (const s of sesiHari ?? []) {
    if (s.status === 'BERJALAN') adaBerjalan.add(s.jadwal_id)
    if (!s.ruang_khusus_id) {
      const arr = sesiKelasPerJadwal.get(s.jadwal_id) ?? []
      arr.push(s.status)
      sesiKelasPerJadwal.set(s.jadwal_id, arr)
    }
  }
  const jadwalAktif = jadwalHari.filter(j => {
    if (adaBerjalan.has(j.id)) return true
    const sesiKelas = sesiKelasPerJadwal.get(j.id) ?? []
    if (sesiKelas.includes('SELESAI')) return false
    return j.status !== 'SELESAI'
  })

  const mapelIds = [...new Set(jadwalHari.map(j => j.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(jadwalHari.map(j => j.kelas).filter(Boolean))]

  // ── Ruang yang sudah ada ──
  const { data: ruangRaw } = await db
    .from('ruang_khusus')
    .select('id, nama, pengawas, kode_ruang, jadwal_ids, status, created_at, waktu_mulai, waktu_selesai')
    .order('created_at', { ascending: false })
    .limit(60)
  const ruangList = ruangRaw ?? []
  const idJadwalRuang = [...new Set(ruangList.flatMap(r => (r.jadwal_ids ?? []) as string[]))]
  const { data: jadwalRuangRaw } = idJadwalRuang.length
    ? await db.from('jadwal').select('id, tanggal, jam_mulai, jam_selesai, mapel_id, kelas').in('id', idJadwalRuang)
    : { data: [] as { id: string; tanggal: string; jam_mulai: string; jam_selesai: string; mapel_id: string; kelas: string }[] }

  const semuaMapelId = [...new Set([...mapelIds, ...(jadwalRuangRaw ?? []).map(j => j.mapel_id)])]
  const semuaUsername = [...new Set(ruangList.map(r => r.pengawas))]

  const [{ data: mapelList }, { data: kelasList }, { data: gurus }, { data: pengawasRows }, { data: penempatan }] = await Promise.all([
    semuaMapelId.length ? db.from('mapel').select('id, nama').in('id', semuaMapelId) : Promise.resolve({ data: [] as { id: string; nama: string }[] }),
    kelasIds.length ? db.from('kelas').select('id, nama').in('id', kelasIds) : Promise.resolve({ data: [] as { id: string; nama: string }[] }),
    db.from('users').select('username, nama').eq('role', 'GURU').eq('status', 'AKTIF').order('nama', { ascending: true }),
    semuaUsername.length ? db.from('users').select('username, nama').in('username', semuaUsername) : Promise.resolve({ data: [] as { username: string; nama: string }[] }),
    ruangList.length
      ? db.from('ruang_khusus_siswa').select('ruang_id, status').in('ruang_id', ruangList.map(r => r.id)).eq('status', 'DIPROSES')
      : Promise.resolve({ data: [] as { ruang_id: string; status: string }[] }),
  ])
  const namaMapel = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const namaKelas = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))
  const namaGuru = Object.fromEntries((pengawasRows ?? []).map(u => [u.username, u.nama]))
  const jumlahSiswaRuang = new Map<string, number>()
  for (const p of penempatan ?? []) jumlahSiswaRuang.set(p.ruang_id, (jumlahSiswaRuang.get(p.ruang_id) ?? 0) + 1)
  const jadwalRuangMap = new Map((jadwalRuangRaw ?? []).map(j => [j.id, j]))

  return NextResponse.json({
    tanggal,
    jadwal: jadwalAktif.map(j => ({
      id: j.id, tanggal: String(j.tanggal).slice(0, 10), jam_mulai: j.jam_mulai, jam_selesai: j.jam_selesai,
      mapel: namaMapel[j.mapel_id] ?? j.mapel_id, kelas: namaKelas[j.kelas] ?? j.kelas,
      berjalan: adaBerjalan.has(j.id),
    })),
    guru: gurus ?? [],
    ruang: ruangList.map(r => ({
      id: r.id, nama: r.nama, status: r.status, kode_ruang: r.kode_ruang,
      pengawas: r.pengawas, nama_pengawas: namaGuru[r.pengawas] ?? r.pengawas,
      waktu_mulai: r.waktu_mulai, waktu_selesai: r.waktu_selesai,
      jumlah_siswa: jumlahSiswaRuang.get(r.id) ?? 0,
      jadwal: ((r.jadwal_ids ?? []) as string[]).map(id => {
        const j = jadwalRuangMap.get(id)
        return j
          ? { id, tanggal: String(j.tanggal).slice(0, 10), jam: `${j.jam_mulai}–${j.jam_selesai}`, mapel: namaMapel[j.mapel_id] ?? j.mapel_id, kelas: j.kelas }
          : { id, tanggal: '', jam: '', mapel: '(jadwal dihapus)', kelas: '' }
      }),
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const body = await req.json().catch(() => null) as { nama?: unknown; pengawas?: unknown; jadwalIds?: unknown } | null
  const pengawas = typeof body?.pengawas === 'string' ? body.pengawas : ''
  const nama = typeof body?.nama === 'string' ? body.nama.trim().slice(0, 60) : ''
  const jadwalIds = Array.isArray(body?.jadwalIds) ? [...new Set((body!.jadwalIds as unknown[]).map(String))] : []
  if (jadwalIds.length === 0) return NextResponse.json({ error: 'Pilih minimal satu jadwal ujian.' }, { status: 400 })
  if (!pengawas) return NextResponse.json({ error: 'Pilih guru pengawas ruang khusus.' }, { status: 400 })

  const { data: guru } = await db.from('users').select('username, nama, role, status').eq('username', pengawas).maybeSingle()
  if (!guru) return NextResponse.json({ error: 'Guru yang dipilih tidak ditemukan.' }, { status: 404 })
  // Menu pengawas hanya terbuka untuk role GURU, jadi hanya GURU yang bisa ditunjuk.
  if (guru.role !== 'GURU') return NextResponse.json({ error: 'Pengawas ruang khusus harus berakun Guru.' }, { status: 400 })
  if (guru.status !== 'AKTIF') return NextResponse.json({ error: 'Guru yang dipilih sedang tidak aktif.' }, { status: 400 })

  const { data: jadwalRows } = await db
    .from('jadwal')
    .select('id, tanggal, jam_mulai, jam_selesai, status')
    .in('id', jadwalIds)
  if ((jadwalRows ?? []).length !== jadwalIds.length) {
    return NextResponse.json({ error: 'Ada jadwal yang tidak ditemukan. Muat ulang halaman.' }, { status: 404 })
  }
  // Jadwal yang sudah SELESAI (semua sesi ditutup) tidak bisa dipilih.
  const { data: sesiJadwal } = await db.from('sesi_ujian').select('jadwal_id, status, ruang_khusus_id').in('jadwal_id', jadwalIds)
  for (const j of jadwalRows ?? []) {
    const sesi = (sesiJadwal ?? []).filter(s => s.jadwal_id === j.id)
    const berjalan = sesi.some(s => s.status === 'BERJALAN')
    const kelasSelesai = sesi.some(s => !s.ruang_khusus_id && s.status === 'SELESAI')
    if (!berjalan && (kelasSelesai || j.status === 'SELESAI')) {
      return NextResponse.json({ error: `Jadwal tanggal ${String(j.tanggal).slice(0, 10)} jam ${j.jam_mulai}–${j.jam_selesai} sudah selesai dan tidak bisa dipilih.` }, { status: 409 })
    }
  }

  const bebas = await cekGuruBebas(db, pengawas, (jadwalRows ?? []) as { id: string; tanggal: string; jam_mulai: string; jam_selesai: string }[])
  if (!bebas.bebas) return NextResponse.json({ error: bebas.alasan, bentrok: true }, { status: 409 })

  const kode = await buatKodeRuangUnik(db)
  const id = generateId('RKH')
  const { error } = await db.from('ruang_khusus').insert({
    id, nama: nama || null, pengawas, kode_ruang: kode, jadwal_ids: jadwalIds,
    status: 'MENUNGGU', dibuat_oleh: auth.user.username,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: `Ruang khusus dibuat. Pengawas: ${guru.nama}.`, id, kodeRuang: kode })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const body = await req.json().catch(() => null) as { id?: unknown; aksi?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id || body?.aksi !== 'batal') return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })

  const { data: ruang } = await db.from('ruang_khusus').select('id, status').eq('id', id).maybeSingle()
  if (!ruang) return NextResponse.json({ error: 'Ruang tidak ditemukan.' }, { status: 404 })
  if (ruang.status !== 'MENUNGGU') {
    return NextResponse.json({ error: 'Hanya ruang yang belum dimulai yang bisa dibatalkan. Untuk ruang yang sedang berjalan, tutup sesinya lewat Tutup Paksa.' }, { status: 409 })
  }
  const { data: sesiAda } = await db.from('sesi_ujian').select('id').eq('ruang_khusus_id', id).eq('status', 'BERJALAN').limit(1)
  if ((sesiAda ?? []).length > 0) return NextResponse.json({ error: 'Ruang ini sudah punya sesi berjalan.' }, { status: 409 })

  const { error } = await db.from('ruang_khusus').update({ status: 'DIBATALKAN', waktu_selesai: new Date().toISOString() })
    .eq('id', id).in('status', [...STATUS_RUANG_AKTIF])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await db.from('ruang_khusus_siswa')
    .update({ status: 'DILEPAS', dilepas_oleh: `admin ${auth.user.username}`, dilepas_pada: new Date().toISOString() })
    .eq('ruang_id', id).eq('status', 'DIPROSES')
  return NextResponse.json({ message: 'Ruang khusus dibatalkan. Siswa kembali ke sesi kelasnya.' })
}
