import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { signToken, WAJIB_GANTI_PASSWORD_AKTIF } from '@/lib/auth'
import { cachedFetch, cacheGet, cacheSet, cacheDel } from '@/lib/cache'
import { instrumented } from '@/lib/metrik'
import { cariYayasanById, tenantDb, YAYASAN_AWAL_ID } from '@/lib/tenant'
import {
  masukGerbang, perkiraanTungguDetik, catatLoginTertunda, denganBatasWaktu,
  galatSementara, BATAS_QUERY_LOGIN_MS,
} from '@/lib/login-beban'

// Pencatatan login (last_login + log_aktivitas) sekarang DIGABUNG dan ditulis
// setelah respons terkirim -- lihat catatLoginTertunda di src/lib/login-beban.ts.
// Dulu: 2 penulisan fire-and-forget per login (promise menggantung, tidak
// dijamin selesai di serverless, dan menumpuk saat login serentak).

// Respons "server sibuk" yang AMAN DICOBA ULANG: sementara:true membuat halaman
// login mengulang otomatis (dengan jeda) sambil menampilkan pesan ke pengguna.
function responSibuk(pesan: string) {
  const tunggu = perkiraanTungguDetik()
  return NextResponse.json(
    { error: pesan, sementara: true, tungguDetik: tunggu },
    { status: 503, headers: { 'Retry-After': String(tunggu) } }
  )
}
const PESAN_SIBUK = 'Server sedang penuh. Mohon bersabar sebentar, login Anda akan dicoba lagi otomatis.'

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

const kunciPercobaan = (ip: string, username: string) =>
  `login-attempt:${ip}:${username.toLowerCase()}`

function cekRateLimit(ip: string, username: string): { allowed: boolean; sisaDetik?: number } {
  const key = kunciPercobaan(ip, username)
  const data = cacheGet<{ count: number; firstAt: number }>(key)

  if (!data) {
    cacheSet(key, { count: 1, firstAt: Date.now() }, WINDOW_DETIK)
    return { allowed: true }
  }

  const sisaDetik = Math.max(Math.ceil((data.firstAt + WINDOW_DETIK * 1000 - Date.now()) / 1000), 1)

  if (data.count >= MAX_PERCOBAAN_LOGIN) {
    return { allowed: false, sisaDetik }
  }

  // FIX: TTL dulu selalu di-reset ke WINDOW_DETIK penuh di setiap percobaan,
  // padahal pesan "coba lagi dalam N menit" dihitung dari percobaan PERTAMA
  // (firstAt). Jendela jadi bergeser dan pesan tidak sesuai kenyataan. Sekarang
  // TTL = sisa jendela sejak percobaan pertama, sama seperti catatGagalIp().
  cacheSet(key, { count: data.count + 1, firstAt: data.firstAt }, sisaDetik)
  return { allowed: true }
}

// FIX: percobaan yang BERHASIL tidak boleh ikut menghabiskan jatah. Dulu
// counter bertambah sebelum password dicek dan tidak pernah di-reset, jadi
// siswa yang login ulang 10x dalam 5 menit (jaringan putus-nyambung saat
// ujian) terkunci walau passwordnya benar. Dipanggil hanya setelah password
// terverifikasi; percobaan salah tetap terhitung.
function resetRateLimit(ip: string, username: string): void {
  cacheDel(kunciPercobaan(ip, username))
}

// Jatah percobaan dikembalikan 1 kalau login ditolak karena SERVER sibuk (bukan
// karena password salah). Tanpa ini, percobaan ulang otomatis dari halaman login
// akan menghabiskan batas 10x/5 menit padahal pengguna tidak salah apa pun.
// Hanya mengurangi 1 (tidak menghapus seluruh hitungan) supaya percobaan
// password SALAH sebelumnya tetap terhitung.
function kembalikanJatah(ip: string, username: string): void {
  const key = kunciPercobaan(ip, username)
  const data = cacheGet<{ count: number; firstAt: number }>(key)
  if (!data) return
  if (data.count <= 1) { cacheDel(key); return }
  const sisaDetik = Math.max(Math.ceil((data.firstAt + WINDOW_DETIK * 1000 - Date.now()) / 1000), 1)
  cacheSet(key, { count: data.count - 1, firstAt: data.firstAt }, sisaDetik)
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

// Akun tidak ditemukan: mungkin ini pemohon aktivasi sekolah baru yang masih
// menunggu persetujuan (atau ditolak). Pesan HANYA diberikan kalau password-nya
// cocok dengan yang didaftarkan, jadi tidak membocorkan username ke orang lain.
// Gagal apa pun (mis. tabel belum dimigrasi) -> null, login tetap normal.
async function pesanPengajuan(
  db: ReturnType<typeof createAdminClient>,
  username: string,
  password: string
): Promise<string | null> {
  try {
    const { data } = await db.from('pengajuan_sekolah')
      .select('status, alasan_tolak, password_hash')
      .eq('username', username).in('status', ['MENUNGGU', 'DITOLAK'])
      .order('created_at', { ascending: false }).limit(1)
      .abortSignal(AbortSignal.timeout(BATAS_QUERY_LOGIN_MS)).maybeSingle()
    const cocok = await bcrypt.compare(password, data?.password_hash || DUMMY_HASH)
    if (!data || !cocok) return null
    if (data.status === 'MENUNGGU') return 'Pengajuan aktivasi sekolah Anda masih menunggu persetujuan. Silakan coba lagi nanti.'
    return `Pengajuan aktivasi sekolah Anda ditolak.${data.alasan_tolak ? ` Alasan: ${data.alasan_tolak}` : ''}`
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  // FIX (status "Server" panel Monitoring sekarang NYATA, bukan cuma skor
  // kesibukan ujian): seluruh body handler dibungkus instrumented('login', ...)
  // supaya setiap login sukses/gagal-karena-server tercatat ke metrik_sistem
  // dengan durasinya — lihat src/lib/metrik.ts. Kesalahan PENGGUNA (password
  // salah, rate limit) tetap dicatat 'ok' (server merespons benar); hanya
  // error 500 atau exception (mis. Supabase down) yang dicatat 'error'.
  return instrumented('login', async () => {
  let lepasGerbang: (() => void) | null = null
  let jatah: { ip: string; username: string } | null = null
  try {
    const body = await req.json().catch(() => null)
    const username = typeof body?.username === 'number' ? String(body.username) : body?.username
    const password = typeof body?.password === 'number' ? String(body.password) : body?.password
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

    jatah = { ip, username: String(username).trim() }

    // ── GERBANG ANTREAN ────────────────────────────────────────────────────
    // Batasi login yang diproses bersamaan per instance. Yang lain MENGANTRE
    // (tetap diproses, hanya menunggu giliran). Kalau antre terlalu lama
    // dijawab 503 sementara -> halaman login mengulang otomatis + pesan ke
    // pengguna. Ini mencegah ratusan query & bcrypt berebut sekaligus.
    lepasGerbang = await masukGerbang()
    if (!lepasGerbang) {
      kembalikanJatah(jatah.ip, jatah.username)
      return responSibuk(PESAN_SIBUK)
    }

    // ── Yayasan ditentukan dari AKUN, bukan dari input pengguna ───────────
    // Setiap baris users/siswa sudah punya yayasan_id, jadi pengguna tidak
    // perlu mengetik Kode Sekolah. username/NIS unik global, sehingga satu
    // akun hanya milik satu yayasan.
    const supabase = createAdminClient()

    // Username berupa email (akun admin sekolah baru) disimpan huruf kecil, jadi
    // dicocokkan huruf kecil agar "Admin@Gmail.com" tetap bisa masuk. Username
    // biasa (tanpa @) dan NIS tetap persis seperti diketik.
    const kunciAkun = username.trim().includes('@') ? username.trim().toLowerCase() : username.trim()

    // Query users dan siswa BERSAMAAN
    const [{ data: user, error: errUser }, { data: siswa, error: errSiswa }] = await Promise.all([
      supabase.from('users').select('username, password_hash, nama, role, yayasan_id, is_tester, last_login').eq('username', kunciAkun).eq('status', 'AKTIF')
        .abortSignal(AbortSignal.timeout(BATAS_QUERY_LOGIN_MS)).single(),
      supabase.from('siswa').select('nis, password_hash, nama, kelas, yayasan_id, is_tester, last_login').eq('nis', username.trim()).eq('status', 'AKTIF')
        .abortSignal(AbortSignal.timeout(BATAS_QUERY_LOGIN_MS)).single(),
    ])

    // Galat database (bukan "akun tidak ada" = PGRST116) jangan dibaca sebagai
    // login gagal: bisa membakar jatah percobaan dan memblokir IP sekolah saat
    // Supabase bermasalah sesaat.
    const galatDb = (e: { code?: string } | null) => !!e && e.code !== 'PGRST116'
    if (galatDb(errUser) || galatDb(errSiswa)) {
      console.error('Login: galat database saat mencari akun:', errUser?.message ?? errSiswa?.message)
      kembalikanJatah(ip, String(username).trim()) // kembalikan jatah percobaan yang sudah terpakai
      return responSibuk(PESAN_SIBUK)
    }

    const yayasanAkun: string | null = user
      ? (user.yayasan_id ?? YAYASAN_AWAL_ID)
      : siswa ? (siswa.yayasan_id ?? YAYASAN_AWAL_ID) : null

    if (!yayasanAkun) {
      // Akun tidak ada. Cek dulu apakah ini pemohon aktivasi sekolah baru.
      // (bcrypt tetap dijalankan di semua jalur supaya waktu respons sama.)
      const pesan = await pesanPengajuan(supabase, kunciAkun, String(password))
      if (pesan) return NextResponse.json({ error: pesan }, { status: 403 })
      catatGagalIp(ip)
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })
    }
    const yayasanTarget: string = yayasanAkun

    const yys = await denganBatasWaktu(cariYayasanById(yayasanTarget), BATAS_QUERY_LOGIN_MS, 'cariYayasan')
    const yayasanAktif = yys?.status === 'AKTIF'
    const PESAN_NONAKTIF = 'Sekolah ini sedang dinonaktifkan. Hubungi administrator aplikasi.'

    // Satu cache hit menggantikan 2–3 round-trip ke DB
    const pengaturan = await denganBatasWaktu(getPengaturan(yayasanTarget), BATAS_QUERY_LOGIN_MS, 'getPengaturan')

    // Maintenance: pengecekan dilakukan SETELAH password terverifikasi (lihat di
    // bawah). Dulu username non-admin langsung dibalas 503 sebelum password
    // dicek, sehingga perbedaan respons membocorkan username ADMIN/tester.
    const sedangMaintenance = pengaturan['maintenanceAktif'] === 'true'

    if (user) {
      const match = await bcrypt.compare(String(password), user.password_hash || DUMMY_HASH)
      if (!match) { catatGagalIp(ip); return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 }) }
      resetRateLimit(ip, String(username).trim())
      if (!yayasanAktif) return NextResponse.json({ error: PESAN_NONAKTIF }, { status: 403 })

      // Diizinkan login saat maintenance: hanya ADMIN.
      if (sedangMaintenance && user.role !== 'ADMIN') {
        return NextResponse.json({ error: buildPesanMaintenance(pengaturan) }, { status: 503 })
      }

      // Password bawaan (password == username, hasil reset admin / akun baru):
      // token diberi klaim gantiPassword sehingga semua endpoint menolak sampai diganti.
      const wajibGantiPassword = WAJIB_GANTI_PASSWORD_AKTIF && String(password) === user.username
      const token = signToken({
        username: user.username, nama: user.nama, role: user.role, yayasanId: yayasanTarget,
        ...(wajibGantiPassword ? { gantiPassword: true } : {}),
      })
      catatLoginTertunda({
        yayasanId: yayasanTarget, tipe: 'USER', kunci: user.username,
        lastLoginLama: user.last_login, detail: `Login sebagai ${user.role}`,
      })
      return NextResponse.json({ token, username: user.username, nama: user.nama, role: user.role, wajibGantiPassword, kodeSekolah: yys?.kode })
    }

    if (siswa) {
      const match = await bcrypt.compare(String(password), siswa.password_hash || DUMMY_HASH)
      if (!match) { catatGagalIp(ip); return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 }) }
      resetRateLimit(ip, String(username).trim())
      if (!yayasanAktif) return NextResponse.json({ error: PESAN_NONAKTIF }, { status: 403 })

      if (sedangMaintenance) {
        return NextResponse.json({ error: buildPesanMaintenance(pengaturan) }, { status: 503 })
      }

      const token = signToken({ username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas, yayasanId: yayasanTarget })
      catatLoginTertunda({
        yayasanId: yayasanTarget, tipe: 'SISWA', kunci: siswa.nis,
        lastLoginLama: siswa.last_login, detail: `Login sebagai SISWA (${siswa.nama})`,
      })
      return NextResponse.json({ token, username: siswa.nis, nama: siswa.nama, role: 'SISWA', nis: siswa.nis, kelas: siswa.kelas, kodeSekolah: yys?.kode })
    }

    // Akun tidak ada / milik yayasan lain: tetap jalankan bcrypt supaya waktu
    // respons sama dengan password salah pada akun yang ada.
    await bcrypt.compare(String(password), DUMMY_HASH)
    catatGagalIp(ip)
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 })
  } catch (err) {
    // Database lambat/timeout bukan kesalahan pengguna maupun bug: jawab 503
    // sementara supaya halaman login mengulang otomatis (bukan error 500 final).
    if (galatSementara(err)) {
      console.error('Login: database lambat/tidak terjangkau:', err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200))
      if (jatah) kembalikanJatah(jatah.ip, jatah.username)
      return responSibuk(PESAN_SIBUK)
    }
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  } finally {
    // Selalu lepaskan giliran, apa pun hasilnya.
    lepasGerbang?.()
  }
  })
}
