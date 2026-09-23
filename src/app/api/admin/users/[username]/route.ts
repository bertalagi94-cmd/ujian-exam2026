import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface Ctx { params: { username: string } }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { nama, role, status, no_hp, nip, sekolah_id, sekolah_ids, is_tester } = await req.json()

  // Role akun yang sah hanya 4 ini — lihat catatan di POST /api/admin/users
  // dan src/lib/auth.ts. "Pengawas" tidak boleh diset lewat edit juga.
  if (role !== undefined) {
    const VALID_ROLES = ['ADMIN', 'GURU', 'KEPSEK']
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role tidak valid. Role yang diizinkan: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }
  }

  // is_tester dipakai untuk menandai akun yang boleh login walau maintenance
  // mode aktif (lihat src/app/api/auth/login/route.ts). Divalidasi di server
  // supaya tidak bisa diisi nilai sembarangan lewat panggilan API langsung.
  if (is_tester !== undefined && !['YES', 'NO'].includes(is_tester)) {
    return NextResponse.json({ error: "is_tester harus 'YES' atau 'NO'" }, { status: 400 })
  }

  // FIX (multi-sekolah): sekolah_id (kolom tunggal) sekarang HANYA dipakai
  // untuk KEPSEK. Untuk GURU, sekolah disinkronkan ke tabel relasi
  // `guru_sekolah` (migrasi 24) di bawah, karena satu guru bisa mengajar
  // di lebih dari satu sekolah/jenjang.
  const { error } = await db.from('users').update({
    nama: nama ? String(nama).toUpperCase() : undefined,
    role: role || undefined,
    status: status || undefined,
    no_hp: no_hp !== undefined ? (no_hp ? String(no_hp).trim() : null) : undefined,
    nip: nip !== undefined ? String(nip ?? '').trim() : undefined,
    sekolah_id: role === 'KEPSEK' ? (sekolah_id || null) : null,
    is_tester: is_tester || undefined,
  }).eq('username', params.username)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sinkronkan daftar sekolah guru: hapus relasi lama, ganti dengan yang
  // baru dikirim dari form. Kalau role bukan GURU (lagi), atau sekolah_ids
  // tidak dikirim sama sekali, relasi lama tetap dihapus supaya tidak ada
  // sisa sekolah dari role sebelumnya (mis. GURU diubah jadi ADMIN).
  if (role !== undefined) {
    const { error: hapusError } = await db.from('guru_sekolah').delete().eq('username', params.username)
    if (hapusError) {
      return NextResponse.json({ message: 'Data berhasil diperbarui, tapi gagal menyinkronkan daftar sekolah', warning: hapusError.message })
    }
    if (role === 'GURU' && Array.isArray(sekolah_ids) && sekolah_ids.length > 0) {
      const rows = [...new Set(sekolah_ids.map((id: string) => String(id)))]
        .map(id => ({ username: params.username, sekolah_id: id }))
      const { error: relasiError } = await db.from('guru_sekolah').insert(rows)
      if (relasiError) {
        return NextResponse.json({ message: 'Data berhasil diperbarui, tapi gagal menyimpan daftar sekolah', warning: relasiError.message })
      }
    }
  }

  return NextResponse.json({ message: 'Data berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { error } = await db.from('users').delete().eq('username', params.username)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Pengguna berhasil dihapus' })
}
