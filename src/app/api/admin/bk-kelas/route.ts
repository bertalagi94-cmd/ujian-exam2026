// /api/admin/bk-kelas — Admin menetapkan KELAS BINAAN untuk akun Guru BK (role 'BK').
//
// GET : daftar akun BK + kelas binaan masing-masing, plus daftar semua kelas.
// PUT : { username, kelas_ids: string[] } — GANTI seluruh kelas binaan guru BK itu.
//       kelas_ids kosong = lepas semua kelas (akun tetap ada, tapi belum melihat data apa pun).
//
// Satu kelas hanya boleh dibina satu guru BK (dijaga di sini dan oleh index unik
// uq_bk_kelas_satu_per_kelas, migrasi 66).
import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { tenantDb, yayasanIdDari, idsMilikYayasan } from '@/lib/tenant'
import { catatAktivitas } from '@/lib/aktivitas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const [bk, kelas, tugas] = await Promise.all([
    db.from('users').select('username, nama, status').eq('role', 'BK').order('nama'),
    db.from('kelas').select('id, nama').order('nama'),
    db.from('bk_kelas').select('username, kelas_id'),
  ])
  const err = bk.error ?? kelas.error ?? tugas.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  const peta: Record<string, string[]> = {}
  for (const t of (tugas.data ?? []) as { username: string; kelas_id: string }[]) {
    (peta[t.username] ??= []).push(String(t.kelas_id))
  }

  return NextResponse.json({
    bk: (bk.data ?? []).map((g: { username: string; nama: string; status: string }) => ({
      username: g.username, nama: g.nama, status: g.status,
      kelas_ids: peta[g.username] ?? [],
    })),
    kelas: (kelas.data ?? [])
      .map((k: { id: string; nama: string }) => ({ id: String(k.id), nama: String(k.nama) }))
      .sort((a: { nama: string }, b: { nama: string }) => a.nama.localeCompare(b.nama, 'id', { numeric: true })),
  })
}

export async function PUT(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const body = await req.json().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username : ''
  const kelasIds: string[] = Array.isArray(body?.kelas_ids)
    ? [...new Set(body.kelas_ids.map(String))] as string[]
    : []
  if (!username) return NextResponse.json({ error: 'username wajib diisi' }, { status: 400 })

  // Hanya akun BK milik yayasan ini yang bisa diberi kelas binaan.
  const { data: akun, error: aErr } = await db
    .from('users').select('username, role').eq('username', username).maybeSingle()
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  if (!akun || akun.role !== 'BK') {
    return NextResponse.json({ error: 'Hanya akun dengan role BK yang dapat diberi kelas binaan.' }, { status: 400 })
  }
  if (!(await idsMilikYayasan(db, 'kelas', kelasIds))) {
    return NextResponse.json({ error: 'Ada kelas yang tidak valid.' }, { status: 400 })
  }

  const { data: ada, error: lErr } = await db.from('bk_kelas').select('kelas_id').eq('username', username)
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
  const lama = new Set((ada ?? []).map((r: { kelas_id: string }) => String(r.kelas_id)))
  const baru = new Set(kelasIds)

  const tambah = kelasIds.filter(id => !lama.has(id))
  const hapus = [...lama].filter(id => !baru.has(id))

  // Satu kelas = satu guru BK. Tolak kalau ada kelas yang sudah dibina guru BK lain.
  if (tambah.length) {
    const { data: dipegang, error: dErr } = await db
      .from('bk_kelas').select('kelas_id, username').in('kelas_id', tambah).neq('username', username)
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
    if (dipegang?.length) {
      const { data: namaKelas } = await db
        .from('kelas').select('id, nama').in('id', dipegang.map((d: { kelas_id: string }) => d.kelas_id))
      const daftar = (namaKelas ?? []).map((k: { nama: string }) => k.nama).join(', ')
      return NextResponse.json(
        { error: `Kelas ${daftar} sudah dibina guru BK lain. Lepaskan dulu dari guru tersebut.` },
        { status: 409 }
      )
    }
  }

  // Tambah dulu, baru hapus: guru BK tidak pernah sempat "kehilangan akses" di tengah proses.
  if (tambah.length) {
    const { error } = await db.from('bk_kelas').insert(
      tambah.map(kelas_id => ({ username, kelas_id, ditugaskan_oleh: auth.user.username }))
    )
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Ada kelas yang baru saja dibina guru BK lain. Muat ulang halaman.' }, { status: 409 })
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (hapus.length) {
    const { error } = await db.from('bk_kelas').delete().eq('username', username).in('kelas_id', hapus)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  catatAktivitas(db, auth.user.username, 'ATUR_KELAS_BK',
    `${username}: ${kelasIds.length} kelas (+${tambah.length} / -${hapus.length})`)
  return NextResponse.json({
    message: kelasIds.length ? 'Kelas binaan guru BK disimpan' : 'Semua kelas binaan guru BK dilepas',
  })
}
