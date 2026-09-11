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

// Format nilai <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") menjadi
// teks berbahasa Indonesia, mis. "12 September 2026, 08.00". Sengaja di-parse
// langsung dari string (bukan lewat `new Date(...)`) supaya angka jam/menit
// yang tampil PERSIS sama dengan yang diketik admin di form pengaturan —
// datetime-local tidak menyimpan info zona waktu, jadi konversi lewat Date()
// berisiko bergeser kalau timezone server berbeda dari WITA.
function formatJadwalMaintenance(raw?: string): string | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw)
  if (!match) return null
  const [, tahun, bulan, tanggal, jam, menit] = match
  const NAMA_BULAN = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]
  const namaBulan = NAMA_BULAN[parseInt(bulan, 10) - 1] ?? bulan
  return `${parseInt(tanggal, 10)} ${namaBulan} ${tahun}, ${jam}.${menit}`
}

// Susun pesan maintenance lengkap dengan rentang waktu (jika diisi admin di
// Pengaturan → Maintenance). Sebelumnya rentang waktu ini disimpan
// (maintenanceMulai/maintenanceSelesai) tapi tidak pernah ikut ditampilkan
// ke pengguna — pesan error hanya berisi maintenancePesan.
function buildPesanMaintenance(pengaturan: Record<string, string>): string {
  const pesanDasar = pengaturan['maintenancePesan'] || 'Sistem sedang dalam perbaikan. Silakan coba beberapa saat lagi.'
  const mulai = formatJadwalMaintenance(pengaturan['maintenanceMulai'])
  const selesai = formatJadwalMaintenance(pengaturan['maintenanceSelesai'])

  let rentang = ''
  if (mulai && selesai) rentang = ` Jadwal: ${mulai} s.d. ${selesai} WITA.`
  else if (mulai) rentang = ` Mulai: ${mulai} WITA.`
  else if (selesai) rentang = ` Perkiraan selesai: ${selesai} WITA.`

  return `${pesanDasar}${rentang}`
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
      const usernameTrim = username.trim()

      // Diizinkan login saat maintenance: role ADMIN, ATAU akun (guru/kepsek
      // di tabel users, maupun siswa di tabel siswa) yang ditandai
      // is_tester = 'YES'. Sebelumnya hanya role ADMIN yang dicek di sini,
      // padahal teks di halaman admin/pengaturan sudah menjanjikan bahwa
      // akun IS_TESTER juga bisa login — jadi ini menyamakan kode dengan
      // janji tersebut.
      const [{ data: adminCheck }, { data: testerUserCheck }, { data: testerSiswaCheck }] = await Promise.all([
        db.from('users').select('role').eq('username', usernameTrim).eq('role', 'ADMIN').maybeSingle(),
        db.from('users').select('username').eq('username', usernameTrim).eq('is_tester', 'YES').maybeSingle(),
        db.from('siswa').select('nis').eq('nis', usernameTrim).eq('is_tester', 'YES').maybeSingle(),
      ])

      if (!adminCheck && !testerUserCheck && !testerSiswaCheck) {
        return NextResponse.json({
          error: buildPesanMaintenance(pengaturan),
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
