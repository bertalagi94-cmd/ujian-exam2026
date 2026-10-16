import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { signToken } from '@/lib/auth'
import { cachedFetch, cacheGet, cacheSet } from '@/lib/cache'
import { generateId } from '@/lib/utils'
import { instrumented } from '@/lib/metrik'
import { cariYayasanByKode, multiYayasanAktif, normalisasiKodeSekolah, tenantDb, YAYASAN_AWAL_ID } from '@/lib/tenant'

// FIX BUG: catat setiap login sukses ke `log_aktivitas` (aksi='LOGIN').
// Sebelumnya endpoint ini hanya meng-update kolom `last_login` di tabel
// users/siswa, tapi tidak pernah insert ke `log_aktivitas` — akibatnya
// panel Monitor Sistem (Aktivitas → "Login Hari Ini" & "Aktivitas 5 Menit
// Terakhir") selalu menampilkan 0 walau login berhasil, karena query di
// admin/monitoring/route.ts membaca count dari tabel ini.
function catatLoginAktivitas(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  detail: string
) {
  db.from('log_aktivitas')
    .insert({ id: generateId('LOG'), user_id: userId, aksi: 'LOGIN', detail })
    .then(({ error }: { error: unknown }) => {
      if (error) console.error('Gagal catat log_aktivitas (LOGIN):', error)
    })
}

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

// ── Batas LOGIN GAGAL per IP (tanpa username) ──────────────────────────────
// cekRateLimit di atas memakai kunci IP+username, sehingga penyerang yang
// mencoba SATU password per akun (mis. password = NIS ke semua NIS) tidak
// pernah kena batas. Penghitung ini menghitung hanya login GAGAL per IP.
// Angkanya sengaja longgar karena satu sekolah bisa berbagi satu IP publik
// (ratusan siswa login bersamaan, sebagian salah ketik password).
const MAX_GAGAL_PER_IP = 120
const kunciGagalIp = (ip: string) => `login-gagal-ip:${ip}`

function ipTerblokir(ip: string): { blocked: boolean; sisaDetik?: number } {
  const d = cacheGet<{ count: number; firstAt: number }>(kunciGagalIp(ip))
  if (!d || d.count < MAX_GAGAL_PER_IP) return { blocked: false }
  return { blocked: true, sisaDetik: Math.max(Math.ceil((d.firstAt + WINDOW_DETIK * 1000 - Date.now()) / 1000), 1) }
}

function catatGagalIp(ip: string): void {
  const key = kunciGagalIp(ip)
  const d = cacheGet<{ count: number; firstAt: number }>(key)
  if (!d) {
    cacheSet(key, { count: 1, firstAt: Date.now() }, WINDOW_DETIK)
    return
  }
  const sisa = Math.max(Math.ceil((d.firstAt + WINDOW_DETIK * 1000 - Date.now()) / 1000), 1)
  cacheSet(key, { count: d.count + 1, firstAt: d.firstAt }, sisa)
}

// Hash palsu untuk menyamakan waktu respons: tanpa ini bcrypt.compare hanya
// berjalan kalau akun ada, jadi waktu respons membocorkan username/NIS valid.
const DUMMY_HASH = bcrypt.hashSync('tidak-dipakai-sebagai-password', 10)

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

// Ambil semua pengaturan YAYASAN ini sekaligus, cache 60 detik.
// Sebelumnya: 2–3 query serial ke tabel pengaturan per login.
// Sekarang: 0ms jika cache hit, 1 query jika cache miss.
// Multi-yayasan: kunci cache memuat yayasanId (mode maintenance dan pengaturan
// lain berbeda per yayasan). Prefix 'pengaturan:' tetap cocok dengan
// cacheDelPrefix('pengaturan:') yang dipakai saat Pengaturan disimpan.
async function getPengaturan(yayasanId: string): Promise<Record<string, string>> {
  return cachedFetch(`pengaturan:all:${yayasanId}`, 60, async () => {
    const db = tenantDb(yayasanId)
    const { data } = await db.from('pengaturan').select('key, value')
    const map: Record<string, string> = {}
    data?.forEach(({ key, value }: { key: string; value: string }) => { map[key] = value ?? '' })
    return map
  })
}

export async function POST(req: NextRequest) {
  // FIX (status "Server" panel Monitoring sekarang NYATA, bukan cuma skor
  // kesibukan ujian): seluruh body handler dibungkus instrumented('login', ...)
  // supaya setiap login sukses/gagal-karena-server tercatat ke metrik_sistem
  // dengan durasinya — lihat src/lib/metrik.ts. Kesalahan PENGGUNA (password
  // salah, rate limit) tetap dicatat 'ok' (server merespons benar); hanya
  // error 500 atau exception (mis. Supabase down) yang dicatat 'error'.
  return instrumented('login', async () => {
  try {
    const body = await req.json().catch(() => null)
    const username = typeof body?.username === 'number' ? String(body.username) : body?.username
    const password = typeof body?.password === 'number' ? String(body.password) : body?.password
    const kodeSekolah = body?.kodeSekolah
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
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

    const blokirIp = ipTerblokir(ip)
    if (blokirIp.blocked) {
      const sisaMenit = Math.ceil((blokirIp.sisaDetik ?? 0) / 60)
      return NextResponse.json(
        { error: `Terlalu banyak percobaan login gagal dari jaringan ini. Coba lagi dalam ${sisaMenit} menit.` },
        { status: 429 }
      )
    }

    // ── Kode Sekolah (multi-yayasan) ──────────────────────────────────────
    // Kode diisi  -> yayasan dicari dari kode; akun harus milik yayasan itu.
    // Kode kosong -> hanya boleh selama multi-yayasan MATI (login lama tetap
    //                jalan untuk yayasan awal). Kalau sudah menyala, wajib.
    const kodeInput = normalisasiKodeSekolah(kodeSekolah)
    let yayasanTarget: string | null = null
    if (kodeInput) {
      const yys = await cariYayasanByKode(kodeInput)
      if (!yys || yys.status !== 'AKTIF') {
        return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })
      }
      yayasanTarget = yys.id
    } else if (multiYayasanAktif()) {
      return NextResponse.json({ error: 'Kode Sekolah wajib diisi' }, { status: 400 })
    } else {
      yayasanTarget = YAYASAN_AWAL_ID
    }

    // Satu cache hit menggantikan 2–3 round-trip ke DB
    const pengaturan = await getPengaturan(yayasanTarget!)

    // Maintenance: pengecekan dilakukan SETELAH password terverifikasi (lihat di
    // bawah). Dulu username non-admin langsung dibalas 503 sebelum password
    // dicek, sehingga perbedaan respons membocorkan username ADMIN/tester.
    const sedangMaintenance = pengaturan['maintenanceAktif'] === 'true'

    const supabase = createAdminClient()

    // Query users dan siswa BERSAMAAN
    const [{ data: user }, { data: siswa }] = await Promise.all([
      supabase.from('users').select('username, password_hash, nama, role, yayasan_id, is_tester').eq('username', username.trim()).eq('status', 'AKTIF').single(),
      supabase.from('siswa').select('nis, password_hash, nama, kelas, yayasan_id, is_tester').eq('nis', username.trim()).eq('status', 'AKTIF').single(),
    ])

    // Akun milik yayasan lain diperlakukan sama seperti "tidak ditemukan".
    const userOk = user && (user.yayasan_id ?? YAYASAN_AWAL_ID) === yayasanTarget
    const siswaOk = siswa && (siswa.yayasan_id ?? YAYASAN_AWAL_ID) === yayasanTarget

    if (user && userOk) {
      const match = await bcrypt.compare(String(password), user.password_hash || DUMMY_HASH)
      if (!match) { catatGagalIp(ip); return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 }) }

      // Diizinkan login saat maintenance: ADMIN atau akun tester (is_tester = 'YES').
      if (sedangMaintenance && user.role !== 'ADMIN' && user.is_tester !== 'YES') {
        return NextResponse.json({ error: buildPesanMaintenance(pengaturan) }, { status: 503 })
      }

      // Password bawaan (password == username, hasil reset admin / akun baru):
      // token diberi klaim gantiPassword sehingga semua endpoint menolak sampai diganti.
      const wajibGantiPassword = String(password) === user.username
      const token = signToken({
        username: user.username, nama: user.nama, role: user.role, yayasanId: yayasanTarget!,
        ...(wajibGantiPassword ? { gantiPassword: true } : {}),
      })
      supabase.from('users').update({ last_login: new Date().toISOString() }).eq('username', user.username)
        .then(({ error }) => { if (error) console.error('Gagal update last_login (user):', error) })
      catatLoginAktivitas(tenantDb(yayasanTarget!), user.username, `Login sebagai ${user.role}`)
      return NextResponse.json({ token, username: user.username, nama: user.nama, role: user.role, wajibGantiPassword })
    }

    if (siswa && siswaOk) {
      const match = await bcrypt.compare(String(password), siswa.password_hash || DUMMY_HASH)
      if (!match) { catatGagalIp(ip); return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 }) }

      if (sedangMaintenance && siswa.is_tester !== 'YES') {
        return NextResponse.json({ error: buildPesanMaintenance(pengaturan) }, { status: 503 })
      }

      const token = signToken({ username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas, yayasanId: yayasanTarget! })
      supabase.from('siswa').update({ last_login: new Date().toISOString() }).eq('nis', siswa.nis)
        .then(({ error }) => { if (error) console.error('Gagal update last_login (siswa):', error) })
      catatLoginAktivitas(tenantDb(yayasanTarget!), siswa.nis, `Login sebagai SISWA (${siswa.nama})`)
      return NextResponse.json({ token, username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas })
    }

    // Akun tidak ada / milik yayasan lain: tetap jalankan bcrypt supaya waktu
    // respons sama dengan password salah pada akun yang ada.
    await bcrypt.compare(String(password), DUMMY_HASH)
    catatGagalIp(ip)
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
  })
}
