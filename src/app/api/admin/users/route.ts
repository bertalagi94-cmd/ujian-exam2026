import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const tester = searchParams.get('tester') === 'true'
  const semua = searchParams.get('all') === 'true'

  let query = db
    .from('users')
    .select('username, nama, role, last_login, status, is_tester, no_hp, nip, sekolah_id, sekolah:sekolah_id(id, label, nama_sekolah)')
    .order('nama')

  // ?all=true -> tampilkan SEMUA akun (reguler + tester), tanpa difilter.
  // Dipakai oleh dropdown pemilihan guru/kepsek (mis. Guru Pengampu di
  // halaman Mapel, Wali Kelas, Pengawas Jadwal, Kepala Sekolah) supaya guru
  // yang berstatus tester tetap bisa ditugaskan mengampu mapel/kelas/sekolah
  // saat disimulasikan, walau tetap disembunyikan dari daftar utama.
  // ?tester=true -> tampilkan HANYA akun tester (untuk tab "Akun Tester" di
  // admin). Default (tanpa parameter) -> tampilkan akun reguler seperti
  // sebelumnya, akun tester tetap disembunyikan dari daftar utama.
  if (!semua) {
    query = tester ? query.eq('is_tester', 'YES') : query.neq('is_tester', 'YES')
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Lampirkan daftar sekolah guru (many-to-many, lihat migrasi 24) supaya
  // halaman admin bisa menampilkan semua sekolah yang diajar tiap guru,
  // bukan cuma satu seperti sekolah_id milik Kepsek.
  const guruUsernames = (data ?? []).filter(u => u.role === 'GURU').map(u => u.username)
  let relasiByUsername = new Map<string, { id: string; label: string; nama_sekolah: string }[]>()
  if (guruUsernames.length > 0) {
    const { data: relasiRows, error: relasiError } = await db
      .from('guru_sekolah')
      .select('username, sekolah:sekolah_id(id, label, nama_sekolah)')
      .in('username', guruUsernames)
    if (relasiError) return NextResponse.json({ error: relasiError.message }, { status: 500 })
    relasiByUsername = (relasiRows ?? []).reduce((map, row: { username: string; sekolah: unknown }) => {
      const sekolah = row.sekolah as { id: string; label: string; nama_sekolah: string } | null
      if (!sekolah) return map
      const list = map.get(row.username) ?? []
      list.push(sekolah)
      map.set(row.username, list)
      return map
    }, relasiByUsername)
  }

  const enriched = (data ?? []).map(u => {
    if (u.role !== 'GURU') return u
    const list = relasiByUsername.get(u.username) ?? []
    return { ...u, sekolah_list: list, sekolah_ids: list.map(s => s.id) }
  })

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { username, nama, role, password, status, no_hp, nip, sekolah_id, sekolah_ids } = body

  if (!username || !nama || !role || !password) {
    return NextResponse.json({ error: 'Username, nama, role, dan password wajib diisi' }, { status: 400 })
  }

  // Role akun yang sah hanya 4 ini ("Pengawas" bukan role akun — lihat
  // catatan di src/lib/auth.ts). Divalidasi di server juga, bukan cuma
  // disembunyikan dari dropdown, supaya tidak bisa dilewati lewat panggilan
  // API langsung.
  const VALID_ROLES = ['ADMIN', 'GURU', 'KEPSEK']
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `Role tidak valid. Role yang diizinkan: ${VALID_ROLES.join(', ')}` }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(String(password), 10)

  // FIX (multi-sekolah): sekolah_id (kolom tunggal) sekarang HANYA dipakai
  // untuk KEPSEK (satu kepsek = satu sekolah yang diawasi). Untuk GURU,
  // sekolah disimpan di tabel relasi many-to-many `guru_sekolah` (migrasi
  // 24) lewat sekolah_ids di bawah, karena satu guru bisa mengajar di lebih
  // dari satu sekolah/jenjang.
  const { error } = await db.from('users').insert({
    username: String(username).trim(),
    nama: String(nama).toUpperCase(),
    role,
    password_hash,
    status: status ?? 'AKTIF',
    no_hp: no_hp ? String(no_hp).trim() : null,
    nip: nip ? String(nip).trim() : '',
    sekolah_id: role === 'KEPSEK' ? (sekolah_id || null) : null,
  })

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Simpan daftar sekolah untuk akun GURU (many-to-many, lihat migrasi 24).
  if (role === 'GURU' && Array.isArray(sekolah_ids) && sekolah_ids.length > 0) {
    const rows = [...new Set(sekolah_ids.map((id: string) => String(id)))]
      .map(id => ({ username: String(username).trim(), sekolah_id: id }))
    const { error: relasiError } = await db.from('guru_sekolah').insert(rows)
    // User utamanya sudah berhasil dibuat — kalau relasi sekolah gagal
    // (mis. sekolah_id tidak valid), laporkan tapi jangan pura-pura user
    // gagal dibuat juga.
    if (relasiError) {
      return NextResponse.json({
        message: 'Pengguna berhasil ditambahkan, tapi gagal menyimpan daftar sekolah',
        warning: relasiError.message,
      }, { status: 201 })
    }
  }

  return NextResponse.json({ message: 'Pengguna berhasil ditambahkan' }, { status: 201 })
}
