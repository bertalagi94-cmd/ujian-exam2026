import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari, idsMilikYayasan } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'

interface Ctx { params: Promise<{ username: string }> }

export async function PUT(req: NextRequest, props: Ctx) {
  const params = await props.params;
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
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

  // Multi-yayasan: akun harus milik yayasan ini (guru_sekolah tidak ter-scope
  // otomatis), dan sekolah yang ditautkan juga harus milik yayasan ini.
  const { data: userAda } = await db.from('users').select('username, role').eq('username', params.username).maybeSingle()
  if (!userAda) return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 })

  // Role akun ADMIN terkunci: tidak boleh diubah lewat edit (diperiksa di
  // server, bukan cuma disembunyikan di form, supaya tidak bisa dilewati
  // lewat panggilan API langsung). Ini juga mencegah admin terakhir
  // diturunkan perannya sehingga sistem kehilangan admin.
  if (userAda.role === 'ADMIN' && role !== undefined && role !== 'ADMIN') {
    return NextResponse.json({ error: 'Role akun ADMIN tidak dapat diubah' }, { status: 403 })
  }
  const idSekolahDikirim = [
    ...(role === 'KEPSEK' && sekolah_id ? [String(sekolah_id)] : []),
    ...(role === 'GURU' && Array.isArray(sekolah_ids) ? sekolah_ids.map((x: string) => String(x)) : []),
  ]
  if (!(await idsMilikYayasan(db, 'sekolah', idSekolahDikirim))) {
    return NextResponse.json({ error: 'Sekolah tidak valid' }, { status: 400 })
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

export async function DELETE(req: NextRequest, props: Ctx) {
  const params = await props.params;
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { error } = await db.from('users').delete().eq('username', params.username)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Pengguna berhasil dihapus' })
}
