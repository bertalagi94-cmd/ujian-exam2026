import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { signToken } from '@/lib/auth'
import { cachedFetch, cacheGet, cacheSet } from '@/lib/cache'

// Pesan error login digeneralisasi agar tidak membocorkan apakah
// username/NIS terdaftar di sistem (mencegah user enumeration).
const GENERIC_LOGIN_ERROR = 'Username atau password salah'

// Rate limit sederhana berbasis in-memory cache (sama seperti cache.ts lain
// di proyek ini). Catatan: di environment serverless multi-instance, counter
// ini per-instance — bukan pengganti rate limiting terdistribusi (mis. Redis),
// tapi tetap menaikkan biaya brute force secara signifikan dibanding tanpa
// limit sama sekali.
const MAX_PERCOBAAN_LOGIN = 10
const WINDOW_DETIK = 5 * 60 // 5 menit

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

function cekRateLimit(ip: string, username: string): { allowed: boolean; sisaDetik?: number } {
  const key = `login-attempt:${ip}:${username.toLowerCase()}`
  const data = cacheGet<{ count: number; firstAt: number }>(key)

  if (!data) {
    cacheSet(key, { count: 1, firstAt: Date.now() }, WINDOW_DETIK)
    return { allowed: true }
  }

  if (data.count >= MAX_PERCOBAAN_LOGIN) {
    const sisaDetik = Math.ceil((data.firstAt + WINDOW_DETIK * 1000 - Date.now()) / 1000)
    return { allowed: false, sisaDetik: Math.max(sisaDetik, 1) }
  }

  cacheSet(key, { count: data.count + 1, firstAt: data.firstAt }, WINDOW_DETIK)
  return { allowed: true }
}

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

    // Rate limit per IP+username untuk mencegah brute force.
    const ip = getClientIp(req)
    const rl = cekRateLimit(ip, String(username).trim())
    if (!rl.allowed) {
      const sisaMenit = Math.ceil((rl.sisaDetik ?? 0) / 60)
      return NextResponse.json(
        { error: `Terlalu banyak percobaan login. Coba lagi dalam ${sisaMenit} menit.` },
        { status: 429 }
      )
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
      if (!match) return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })

      const token = signToken({ username: user.username, nama: user.nama, role: user.role })
      supabase.from('users').update({ last_login: new Date().toISOString() }).eq('username', user.username)
        .then(({ error }) => { if (error) console.error('Gagal update last_login (user):', error) })
      return NextResponse.json({ token, username: user.username, nama: user.nama, role: user.role })
    }

    if (siswa) {
      const match = await bcrypt.compare(String(password), siswa.password_hash)
      if (!match) return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })

      const token = signToken({ username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas })
      supabase.from('siswa').update({ last_login: new Date().toISOString() }).eq('nis', siswa.nis)
        .then(({ error }) => { if (error) console.error('Gagal update last_login (siswa):', error) })
      return NextResponse.json({ token, username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas })
    }

    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
