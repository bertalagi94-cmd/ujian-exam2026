import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'

// Impor massal data pengguna (GURU / KEPSEK) dari file Excel.
//
// Sengaja TIDAK menerima role ADMIN: membuat akun admin secara massal dari
// file adalah jalur eskalasi hak akses yang terlalu mudah disalahgunakan.
// Akun admin tetap dibuat satu per satu lewat tombol "Tambah Pengguna".
//
// Impor hanya MEMBUAT akun baru. Username yang sudah ada dilewati (tidak
// menimpa), supaya impor tidak bisa diam-diam mengubah role/password akun lama.

interface ImportRow {
  username?: unknown
  nama?: unknown
  role?: unknown
  password?: unknown
  nip?: unknown
  no_hp?: unknown
  status?: unknown
  sekolah?: unknown
}

const MAX_ROWS = 200
const BCRYPT_COST = 10 // sama dengan POST /api/admin/users
const IMPORT_ROLES = ['GURU', 'KEPSEK']

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const rows: ImportRow[] = body?.data
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Data kosong' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_ROWS} baris per impor. Pecah file Anda menjadi beberapa bagian.` },
      { status: 400 }
    )
  }

  const db = tenantDb(yayasanIdDari(auth.user))

  // Peta label/nama sekolah -> id (hanya sekolah milik yayasan ini).
  const { data: sekolahRows, error: sekolahError } = await db
    .from('sekolah')
    .select('id, label, nama_sekolah')
  if (sekolahError) return NextResponse.json({ error: sekolahError.message }, { status: 500 })
  const sekolahMap = new Map<string, string>()
  for (const s of sekolahRows ?? []) {
    if (s.label) sekolahMap.set(String(s.label).trim().toLowerCase(), s.id)
    if (s.nama_sekolah) sekolahMap.set(String(s.nama_sekolah).trim().toLowerCase(), s.id)
  }

  let inserted = 0
  const errors: string[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const barisKe = i + 2 // baris 1 = header di Excel
    const username = String(row.username ?? '').trim()
    const nama = String(row.nama ?? '').trim()
    const role = String(row.role ?? '').trim().toUpperCase()
    const label = username ? `Baris ${barisKe} (${username})` : `Baris ${barisKe}`

    if (!username || !nama || !role) {
      errors.push(`${label}: username, nama, dan role wajib diisi`)
      continue
    }
    if (/\s/.test(username)) {
      errors.push(`${label}: username tidak boleh mengandung spasi`)
      continue
    }
    const key = username.toLowerCase()
    if (seen.has(key)) {
      errors.push(`${label}: username muncul lebih dari sekali di file ini`)
      continue
    }
    seen.add(key)

    if (!IMPORT_ROLES.includes(role)) {
      errors.push(
        role === 'ADMIN'
          ? `${label}: role ADMIN tidak bisa diimpor, tambahkan lewat tombol "Tambah Pengguna"`
          : `${label}: role "${role}" tidak valid (gunakan GURU atau KEPSEK)`
      )
      continue
    }

    // Password kosong -> default = username (sama dengan perilaku Reset Password).
    const password = String(row.password ?? '').trim() || username
    if (password.length < 6) {
      errors.push(`${label}: password minimal 6 karakter (isi kolom Password, atau pakai username ≥ 6 karakter)`)
      continue
    }

    const status = String(row.status ?? '').trim().toUpperCase() || 'AKTIF'
    if (!['AKTIF', 'NONAKTIF'].includes(status)) {
      errors.push(`${label}: status harus AKTIF atau NONAKTIF`)
      continue
    }

    const nip = String(row.nip ?? '').trim()
    if (role === 'KEPSEK' && !nip) {
      errors.push(`${label}: NIP wajib diisi untuk KEPSEK`)
      continue
    }

    // Sekolah: KEPSEK = satu; GURU = boleh beberapa dipisah koma / titik koma.
    const sekolahTokens = String(row.sekolah ?? '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean)
    const sekolahIds: string[] = []
    let sekolahTidakDikenal = ''
    for (const t of sekolahTokens) {
      const id = sekolahMap.get(t.toLowerCase())
      if (!id) { sekolahTidakDikenal = t; break }
      if (!sekolahIds.includes(id)) sekolahIds.push(id)
    }
    if (sekolahTidakDikenal) {
      errors.push(`${label}: sekolah "${sekolahTidakDikenal}" tidak ditemukan (cek Pengaturan → Sekolah & Jenjang)`)
      continue
    }
    if (role === 'KEPSEK' && sekolahIds.length !== 1) {
      errors.push(`${label}: KEPSEK wajib memiliki tepat satu sekolah`)
      continue
    }

    const no_hp = String(row.no_hp ?? '').trim().replace(/^\+/, '')

    const password_hash = await bcrypt.hash(password, BCRYPT_COST)
    const { error } = await db.from('users').insert({
      username,
      nama: nama.toUpperCase(),
      role,
      password_hash,
      status,
      no_hp: no_hp || null,
      nip,
      sekolah_id: role === 'KEPSEK' ? sekolahIds[0] : null,
    })
    if (error) {
      errors.push(
        error.code === '23505'
          ? `${label}: username sudah digunakan`
          : `${label}: ${error.message}`
      )
      continue
    }

    if (role === 'GURU' && sekolahIds.length > 0) {
      const { error: relasiError } = await db
        .from('guru_sekolah')
        .insert(sekolahIds.map(id => ({ username, sekolah_id: id })))
      if (relasiError) {
        warnings.push(`${label}: akun dibuat, tapi gagal menyimpan sekolah (${relasiError.message})`)
      }
    } else if (role === 'GURU') {
      warnings.push(`${label}: akun dibuat tanpa sekolah, atur lewat tombol Edit agar fitur kisi-kisi berfungsi`)
    }

    inserted++
  }

  return NextResponse.json({
    inserted,
    skipped: rows.length - inserted,
    errors: errors.slice(0, 50),
    warnings: warnings.slice(0, 50),
  })
}
