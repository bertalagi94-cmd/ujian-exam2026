// Sisi klien mode "Lihat sebagai" (view-as). Lihat juga src/lib/auth.ts.
//
// Aplikasi ini menyimpan sesi di localStorage ('token' + 'user'). Saat mode
// aktif, token & user ADMIN dicadangkan ke kunci terpisah lalu diganti token
// hanya-baca milik target. "Kembali ke Admin" memulihkan cadangan itu.
//
// CATATAN: localStorage dipakai bersama semua tab di browser yang sama, jadi
// tab admin lain di browser itu ikut "menjadi" target selama mode aktif.
// Untuk memakainya berdampingan dengan tab admin, buka di jendela Incognito
// atau profil browser terpisah.
import { apiRequest } from '@/lib/utils'

const BACKUP_TOKEN = 'admin_token_backup'
const BACKUP_USER = 'admin_user_backup'

export type TargetLihatSebagai = { tipe: 'USER' | 'SISWA'; id: string }

interface ViewAsResponse {
  token: string
  username: string
  nama: string
  role: 'GURU' | 'KEPSEK' | 'SISWA'
  nis?: string
  kelas?: string
  expiresAt: number
}

const HOME: Record<string, string> = { GURU: '/guru', KEPSEK: '/kepsek', SISWA: '/siswa' }

export async function mulaiLihatSebagai(target: TargetLihatSebagai): Promise<void> {
  const data = await apiRequest<ViewAsResponse>('/api/admin/lihat-sebagai', {
    method: 'POST',
    body: JSON.stringify(target),
  })

  const adminToken = localStorage.getItem('token')
  const adminUser = localStorage.getItem('user')
  if (adminToken && adminUser) {
    localStorage.setItem(BACKUP_TOKEN, adminToken)
    localStorage.setItem(BACKUP_USER, adminUser)
  }

  localStorage.setItem('token', data.token)
  localStorage.setItem('user', JSON.stringify({
    username: data.username, nama: data.nama, role: data.role,
    nis: data.nis, kelas: data.kelas,
    viewAs: true, viewAsExp: data.expiresAt,
  }))
  // Reload penuh supaya semua state klien membaca identitas baru.
  window.location.assign(HOME[data.role] ?? '/login')
}

export async function keluarLihatSebagai(): Promise<void> {
  const token = localStorage.getItem('token')
  if (token) {
    // Best-effort: gagal jaringan tidak boleh menahan admin kembali.
    try {
      await fetch('/api/auth/lihat-sebagai/selesai', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch { /* abaikan */ }
  }

  const adminToken = localStorage.getItem(BACKUP_TOKEN)
  const adminUser = localStorage.getItem(BACKUP_USER)
  localStorage.removeItem(BACKUP_TOKEN)
  localStorage.removeItem(BACKUP_USER)

  if (adminToken && adminUser) {
    localStorage.setItem('token', adminToken)
    localStorage.setItem('user', adminUser)
    window.location.assign('/admin')
  } else {
    // Cadangan hilang (mis. storage dibersihkan): paksa login ulang.
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.assign('/login')
  }
}

export function hapusCadanganLihatSebagai() {
  localStorage.removeItem(BACKUP_TOKEN)
  localStorage.removeItem(BACKUP_USER)
}
