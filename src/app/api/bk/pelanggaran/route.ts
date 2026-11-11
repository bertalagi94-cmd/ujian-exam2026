import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { getBkScope, ambilSiswaBinaan, PESAN_BK_BELUM_ADA_KELAS } from '@/lib/bk-scope'
import { catatAktivitas } from '@/lib/aktivitas'

export const dynamic = 'force-dynamic'

const STATUS_SAH = ['BELUM_DITINDAKLANJUTI', 'SUDAH_DITINDAKLANJUTI', 'DIABAIKAN']

// GET /api/bk/pelanggaran
// Query: page, per_page, search (nama/NISN), status, jenis, kelas
// Hanya pelanggaran siswa di KELAS BINAAN guru BK ini.
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['BK'])
  if ('error' in auth) return auth.error

  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const scope = await getBkScope(auth.user.username, yayasanId)
  if (scope.noScope) {
    return NextResponse.json({ scopeWarning: PESAN_BK_BELUM_ADA_KELAS, data: [], total: 0, kelasList: [], stats: { belum: 0, sudah: 0, diabaikan: 0, total: 0 } })
  }

  const { searchParams } = new URL(req.url)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1') || 1, 1)
  const perPage = Math.min(Math.max(parseInt(searchParams.get('per_page') ?? '20') || 20, 1), 100)
  const search = (searchParams.get('search') ?? '').trim().toLowerCase()
  const status = searchParams.get('status') ?? ''
  const jenis = searchParams.get('jenis') ?? ''
  const kelas = searchParams.get('kelas') ?? ''

  if (kelas && !scope.kelasList.includes(kelas)) {
    return NextResponse.json({ error: 'Kelas ini bukan kelas binaan Anda' }, { status: 403 })
  }
  if (status && !STATUS_SAH.includes(status)) {
    return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })
  }

  const kelasListUrut = [...scope.kelasList].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
  const siswaScope = await ambilSiswaBinaan(yayasanId, scope.kelasList)
  const infoSiswa = new Map(siswaScope.map(s => [s.nis, s]))
  const nisScope = siswaScope.map(s => s.nis)

  // Statistik: seluruh kelas binaan (tidak ikut terpengaruh filter di tabel).
  const hitung = (st?: string) => {
    if (nisScope.length === 0) return Promise.resolve({ count: 0, error: null })
    let q = db.from('pelanggaran').select('id', { count: 'exact', head: true }).in('nis', nisScope)
    if (st) q = q.eq('status', st)
    return q
  }
  const [cBelum, cSudah, cAbai, cTotal] = await Promise.all([
    hitung('BELUM_DITINDAKLANJUTI'), hitung('SUDAH_DITINDAKLANJUTI'), hitung('DIABAIKAN'), hitung(),
  ])
  const stats = {
    belum: cBelum.count ?? 0, sudah: cSudah.count ?? 0, diabaikan: cAbai.count ?? 0, total: cTotal.count ?? 0,
  }

  // Siswa yang cocok dengan filter kelas + pencarian (disaring di memori: seluruh
  // daftar siswa binaan sudah ada, jadi tidak perlu ilike di database).
  const nisCocok = siswaScope
    .filter(s => (!kelas || s.kelas === kelas)
      && (!search || s.nama.toLowerCase().includes(search) || s.nis.toLowerCase().includes(search)))
    .map(s => s.nis)
  if (nisCocok.length === 0) {
    return NextResponse.json({ data: [], total: 0, kelasList: kelasListUrut, stats })
  }

  const dari = (page - 1) * perPage
  let query = db
    .from('pelanggaran')
    .select('id, sesi_id, nis, jenis, level, detail, status, created_at', { count: 'exact' })
    .in('nis', nisCocok)
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  if (jenis) query = query.eq('jenis', jenis)
  query = query.range(dari, dari + perPage - 1)

  const { data: baris, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!baris?.length) return NextResponse.json({ data: [], total: count ?? 0, kelasList: kelasListUrut, stats })

  const nisHalaman = [...new Set(baris.map((p: { nis: string }) => p.nis))]
  const sesiIds = [...new Set(baris.map((p: { sesi_id: string | null }) => p.sesi_id).filter(Boolean))] as string[]

  const [sesiRes, riwayatRes] = await Promise.all([
    sesiIds.length
      ? db.from('sesi_ujian').select('id, mapel_id').in('id', sesiIds)
      : Promise.resolve({ data: [] as { id: string; mapel_id: string }[], error: null }),
    // Total pelanggaran tiap siswa di halaman ini (semua waktu) untuk melihat pola berulang.
    db.from('pelanggaran').select('nis').in('nis', nisHalaman),
  ])
  if (sesiRes.error) return NextResponse.json({ error: sesiRes.error.message }, { status: 500 })
  if (riwayatRes.error) return NextResponse.json({ error: riwayatRes.error.message }, { status: 500 })

  const mapelIds = [...new Set((sesiRes.data ?? []).map((s: { mapel_id: string }) => s.mapel_id).filter(Boolean))]
  const { data: mapelList } = mapelIds.length
    ? await db.from('mapel').select('id, nama').in('id', mapelIds)
    : { data: [] as { id: string; nama: string }[] }

  const mapelMap = new Map((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))
  const sesiMapel = new Map((sesiRes.data ?? []).map((s: { id: string; mapel_id: string }) => [s.id, s.mapel_id]))
  const totalPerSiswa = new Map<string, number>()
  for (const r of (riwayatRes.data ?? []) as { nis: string }[]) {
    totalPerSiswa.set(r.nis, (totalPerSiswa.get(r.nis) ?? 0) + 1)
  }

  const data = baris.map((p: { id: string; sesi_id: string | null; nis: string; jenis: string; level: number; detail: string; status: string; created_at: string }) => ({
    ...p,
    nama_siswa: infoSiswa.get(p.nis)?.nama ?? p.nis,
    kelas: infoSiswa.get(p.nis)?.kelas ?? '-',
    nama_mapel: (p.sesi_id && mapelMap.get(sesiMapel.get(p.sesi_id) ?? '')) || '-',
    total_pelanggaran_siswa: totalPerSiswa.get(p.nis) ?? 1,
  }))

  return NextResponse.json({ data, total: count ?? data.length, kelasList: kelasListUrut, stats })
}

// PATCH /api/bk/pelanggaran
// Body: { id, status } — guru BK hanya boleh menandai status tindak lanjut
// (mis. "sudah dikonseling"). Aksi lain (reset, kunci, hapus) tetap milik Admin/Pengawas.
export async function PATCH(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['BK'])
  if ('error' in auth) return auth.error

  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!id || !status) return NextResponse.json({ error: 'id dan status diperlukan' }, { status: 400 })
  if (!STATUS_SAH.includes(status)) return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })

  const scope = await getBkScope(auth.user.username, yayasanId)
  if (scope.noScope) return NextResponse.json({ error: PESAN_BK_BELUM_ADA_KELAS }, { status: 403 })

  const { data: pel, error: pErr } = await db.from('pelanggaran').select('id, nis').eq('id', id).maybeSingle()
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  if (!pel) return NextResponse.json({ error: 'Pelanggaran tidak ditemukan' }, { status: 404 })

  // Siswa pemilik pelanggaran ini WAJIB berada di kelas binaan.
  const { data: siswa, error: sErr } = await db
    .from('siswa').select('nis').eq('nis', pel.nis).in('kelas', scope.kelasList).maybeSingle()
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!siswa) return NextResponse.json({ error: 'Pelanggaran ini bukan milik siswa kelas binaan Anda' }, { status: 403 })

  const { error } = await db.from('pelanggaran').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  catatAktivitas(db, auth.user.username, 'BK_UBAH_STATUS_PELANGGARAN', `${id} (NIS ${pel.nis}) -> ${status}`)
  return NextResponse.json({ success: true, message: 'Status pelanggaran diperbarui' })
}
