// /api/admin/admin-kelas — Super Admin menunjuk guru sebagai Admin Kelas.
//
// GET : daftar guru + kelas yang dipegang masing-masing, plus daftar semua kelas.
// PUT : { username, kelas_ids: string[] } — GANTI seluruh penugasan guru itu.
//       kelas_ids kosong = cabut status Admin Kelas.
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { tenantDb, yayasanIdDari, idsMilikYayasan } from '@/lib/tenant'
import { catatAktivitas } from '@/lib/aktivitas'
import { adminKelasAktif, KUNCI_ADMIN_KELAS_AKTIF } from '@/lib/admin-kelas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const [guru, kelas, tugas, aktif] = await Promise.all([
    db.from('users').select('username, nama, status').eq('role', 'GURU').order('nama'),
    db.from('kelas').select('id, nama').order('nama'),
    db.from('admin_kelas').select('username, kelas_id'),
    adminKelasAktif(db),
  ])
  const err = guru.error ?? kelas.error ?? tugas.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  const peta: Record<string, string[]> = {}
  for (const t of (tugas.data ?? []) as any[]) (peta[t.username] ??= []).push(String(t.kelas_id))

  return NextResponse.json({
    aktif,
    guru: (guru.data ?? []).map((g: any) => ({
      username: g.username, nama: g.nama, status: g.status,
      kelas_ids: peta[g.username] ?? [],
    })),
    kelas: (kelas.data ?? []).map((k: any) => ({ id: String(k.id), nama: String(k.nama) })),
  })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const body = await req.json().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username : ''
  const kelasIds: string[] = Array.isArray(body?.kelas_ids) ? [...new Set(body.kelas_ids.map(String))] as string[] : []
  if (!username) return NextResponse.json({ error: 'username wajib diisi' }, { status: 400 })

  // Hanya akun GURU milik yayasan ini yang bisa ditunjuk.
  const { data: guru, error: gErr } = await db
    .from('users').select('username, role').eq('username', username).maybeSingle()
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })
  if (!guru || guru.role !== 'GURU') {
    return NextResponse.json({ error: 'Hanya akun guru yang dapat ditunjuk sebagai Admin Kelas.' }, { status: 400 })
  }
  if (!(await idsMilikYayasan(db, 'kelas', kelasIds))) {
    return NextResponse.json({ error: 'Ada kelas yang tidak valid.' }, { status: 400 })
  }

  const { data: ada, error: aErr } = await db.from('admin_kelas').select('kelas_id').eq('username', username)
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  const lama = new Set((ada ?? []).map((r: any) => String(r.kelas_id)))
  const baru = new Set(kelasIds)

  const tambah = kelasIds.filter(id => !lama.has(id))
  const hapus = [...lama].filter(id => !baru.has(id))

  // Satu kelas = satu Admin Kelas. Tolak kalau ada kelas yang sudah dipegang guru lain.
  if (tambah.length) {
    const { data: dipegang, error: dErr } = await db
      .from('admin_kelas').select('kelas_id, username').in('kelas_id', tambah).neq('username', username)
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
    if (dipegang?.length) {
      const { data: namaKelas } = await db.from('kelas').select('id, nama').in('id', dipegang.map((d: any) => d.kelas_id))
      const daftar = (namaKelas ?? []).map((k: any) => k.nama).join(', ')
      return NextResponse.json(
        { error: `Kelas ${daftar} sudah dipegang Admin Kelas lain. Lepaskan dulu dari guru tersebut.` },
        { status: 409 }
      )
    }
  }

  // Tambah dulu, baru hapus: guru tidak pernah sempat "kehilangan akses" di tengah proses.
  if (tambah.length) {
    const { error } = await db.from('admin_kelas').insert(
      tambah.map(kelas_id => ({ username, kelas_id, ditugaskan_oleh: auth.user.username }))
    )
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Ada kelas yang baru saja dipegang Admin Kelas lain. Muat ulang halaman.' }, { status: 409 })
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (hapus.length) {
    const { error } = await db.from('admin_kelas').delete().eq('username', username).in('kelas_id', hapus)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  catatAktivitas(db, auth.user.username, 'ATUR_ADMIN_KELAS',
    `${username}: ${kelasIds.length} kelas (+${tambah.length} / -${hapus.length})`)
  return NextResponse.json({ message: kelasIds.length ? 'Penugasan Admin Kelas disimpan' : 'Status Admin Kelas dicabut' })
}


// PATCH { aktif: boolean } — hidup/matikan fitur Admin Kelas untuk yayasan ini.
// Penugasan tidak dihapus saat dimatikan; hanya berhenti berlaku.
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const body = await req.json().catch(() => null)
  if (typeof body?.aktif !== 'boolean') {
    return NextResponse.json({ error: 'aktif harus true atau false' }, { status: 400 })
  }
  const { error } = await db.from('pengaturan').upsert(
    { key: KUNCI_ADMIN_KELAS_AKTIF, value: body.aktif ? 'true' : 'false', updated_at: new Date().toISOString() },
    { onConflict: 'yayasan_id,key' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  catatAktivitas(db, auth.user.username, 'ATUR_ADMIN_KELAS', `Fitur Admin Kelas ${body.aktif ? 'diaktifkan' : 'dimatikan'}`)
  return NextResponse.json({
    aktif: body.aktif,
    message: body.aktif
      ? 'Admin Kelas diaktifkan. Validasi soal di kelas yang punya Admin Kelas kini ditangani mereka.'
      : 'Admin Kelas dimatikan. Semua validasi soal kembali ke Super Admin.',
  })
}
