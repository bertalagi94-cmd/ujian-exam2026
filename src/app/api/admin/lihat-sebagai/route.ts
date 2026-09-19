import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole, signViewAsToken, VIEW_AS_MAX_SECONDS } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { invalidasiDipantau } from '@/lib/dipantau'

// POST /api/admin/lihat-sebagai
// Body: { tipe: 'USER', id: '<username guru/kepsek>' }  atau  { tipe: 'SISWA', id: '<nis>' }
//
// ADMIN meminta token HANYA-BACA untuk melihat aplikasi persis seperti akun
// target. Aturan:
//  - Hanya GURU, KEPSEK, SISWA. Sesama ADMIN ditolak.
//  - Token berlaku maksimal 2 jam (jaring pengaman); penutupan normal manual
//    lewat tombol "Kembali ke Admin" (→ /api/auth/lihat-sebagai/selesai).
//  - Audit-first: log_aktivitas ditulis DAN di-await sebelum token diberikan.
//    Kalau log gagal, token tidak diterbitkan (tidak ada akses tanpa jejak).
function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const { user: admin } = auth

  let body: { tipe?: string; id?: string }
  try { body = await req.json() } catch { body = {} }
  const tipe = body.tipe
  const id = String(body.id ?? '').trim()
  if ((tipe !== 'USER' && tipe !== 'SISWA') || !id) {
    return NextResponse.json({ error: 'tipe (USER/SISWA) dan id wajib diisi' }, { status: 400 })
  }

  const db = createAdminClient()

  let target:
    | { username: string; nama: string; role: 'GURU' | 'KEPSEK' | 'SISWA'; nis?: string; kelas?: string }
    | null = null

  if (tipe === 'USER') {
    const { data } = await db.from('users').select('username, nama, role').eq('username', id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 })
    if (data.role !== 'GURU' && data.role !== 'KEPSEK') {
      return NextResponse.json({ error: 'Hanya akun Guru, Kepsek, dan Siswa yang bisa dilihat' }, { status: 403 })
    }
    target = { username: data.username, nama: data.nama, role: data.role }
  } else {
    const { data } = await db.from('siswa').select('nis, nama, kelas').eq('nis', id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
    target = { username: data.nis, nama: data.nama, role: 'SISWA', nis: data.nis, kelas: data.kelas }
  }

  // Untuk target SISWA, sisipkan juga baris penanda "sedang dipantau" (id = sid)
  // dalam INSERT yang sama, sehingga audit dan penanda tersimpan atomik.
  const sid = target.role === 'SISWA' ? generateId('VAS') : undefined
  const baris: Record<string, string>[] = [{
    id: generateId('LOG'),
    user_id: admin.username,
    aksi: 'LIHAT_SEBAGAI_MULAI',
    detail: `Admin ${admin.username} melihat sebagai ${target.role} ${target.username} (${target.nama}) · IP ${getClientIp(req)} · batas ${VIEW_AS_MAX_SECONDS / 3600} jam`,
  }]
  if (sid) {
    baris.push({
      id: sid,
      user_id: target.username,
      aksi: 'DIPANTAU_MULAI',
      detail: `Dipantau admin ${admin.username}`,
    })
  }
  const { error: logError } = await db.from('log_aktivitas').insert(baris)
  if (logError) {
    console.error('Gagal catat LIHAT_SEBAGAI_MULAI:', logError)
    return NextResponse.json({ error: 'Gagal mencatat audit; mode Lihat-sebagai dibatalkan' }, { status: 500 })
  }
  invalidasiDipantau()

  const token = signViewAsToken({
    username: target.username,
    nama: target.nama,
    role: target.role,
    nis: target.nis,
    kelas: target.kelas,
    impersonatorUsername: admin.username,
    impersonatorNama: admin.nama,
    viewAsSid: sid,
  })

  return NextResponse.json({
    token,
    username: target.username,
    nama: target.nama,
    role: target.role,
    nis: target.nis,
    kelas: target.kelas,
    expiresAt: Date.now() + VIEW_AS_MAX_SECONDS * 1000,
  })
}
