import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { signToken } from '@/lib/auth'
import { cachedFetch } from '@/lib/cache'

// Ambil semua pengaturan sekaligus, cache 60 detik.
// Sebelumnya: 2–3 query serial ke tabel pengaturan per login.
// Sekarang: 0ms jika cache hit, 1 query jika cache miss.
async function getPengaturan(): Promise<Record<string, string>> {
  return cachedFetch('pengaturan:all', 60, async () => {
    const db = createAdminClient()
    const { data } = await db.from('pengaturan').select('key, value')
    const map: Record<string, string> = {}
    data?.forEach(({ key, value }: { key: string; value: string }) => { map[key] = value ?? '' })
    return map
  })
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }

    // Satu cache hit menggantikan 2–3 round-trip ke DB
    const pengaturan = await getPengaturan()

    if (pengaturan['maintenanceAktif'] === 'true') {
      const db = createAdminClient()
      const { data: adminCheck } = await db
        .from('users')
        .select('role')
        .eq('username', username.trim())
        .eq('role', 'ADMIN')
        .single()

      if (!adminCheck) {
        return NextResponse.json({
          error: pengaturan['maintenancePesan'] || 'Sistem sedang dalam perbaikan. Silakan coba beberapa saat lagi.',
        }, { status: 503 })
      }
    }

    const supabase = createAdminClient()

    // Query users dan siswa BERSAMAAN
    const [{ data: user }, { data: siswa }] = await Promise.all([
      supabase.from('users').select('username, password_hash, nama, role').eq('username', username.trim()).eq('status', 'AKTIF').single(),
      supabase.from('siswa').select('nis, password_hash, nama, kelas').eq('nis', username.trim()).eq('status', 'AKTIF').single(),
    ])

    if (user) {
      const match = await bcrypt.compare(String(password), user.password_hash)
      if (!match) return NextResponse.json({ error: 'Password salah' }, { status: 401 })

      const token = signToken({ username: user.username, nama: user.nama, role: user.role })
      supabase.from('users').update({ last_login: new Date().toISOString() }).eq('username', user.username)
      return NextResponse.json({ token, username: user.username, nama: user.nama, role: user.role })
    }

    if (siswa) {
      const match = await bcrypt.compare(String(password), siswa.password_hash)
      if (!match) return NextResponse.json({ error: 'Password salah' }, { status: 401 })

      const token = signToken({ username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas })
      supabase.from('siswa').update({ last_login: new Date().toISOString() }).eq('nis', siswa.nis)
      return NextResponse.json({ token, username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas })
    }

    return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
