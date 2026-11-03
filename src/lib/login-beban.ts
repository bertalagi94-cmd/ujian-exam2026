import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tenantDb } from '@/lib/tenant'
import { generateId } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Penahan beban LOGIN untuk Supabase gratis + Vercel Hobby.
//
// LATAR BELAKANG (log 3 Nov 2026): ratusan login serentak membuat database
// jenuh. Setiap login dulu melakukan: 2 query baca + 1 UPDATE last_login +
// 1 INSERT log_aktivitas, semuanya per orang. Penulisan non-kritis itu
// menumpuk di antrean koneksi dan akhirnya timeout 30 detik bersamaan.
//
// Isi file ini:
//   1. GERBANG ANTREAN  -- membatasi jumlah login yang diproses BERSAMAAN di
//      satu instance. Sisanya mengantre (tetap diproses, hanya menunggu giliran)
//      dan baru ditolak sementara (503 + sementara:true) kalau antre terlalu
//      lama. Client otomatis mencoba lagi, jadi pengguna tidak perlu klik ulang.
//   2. PENULISAN BATCH  -- last_login & log_aktivitas dikumpulkan beberapa
//      ratus milidetik lalu ditulis SEKALIGUS (1 UPDATE ... IN (...) dan
//      1 INSERT multi-baris), setelah respons terkirim (after/waitUntil).
//      500 login = beberapa query saja, bukan 1.000.
//   3. denganBatasWaktu -- supaya query pendukung (yayasan/pengaturan) tidak
//      menahan login selama 30 detik.
//
// Semua angka bisa diubah lewat env Vercel tanpa mengubah kode.
// ─────────────────────────────────────────────────────────────────────────────

function envAngka(nama: string, bawaan: number, min: number): number {
  const n = Number(process.env[nama])
  return Number.isFinite(n) && n >= min ? Math.floor(n) : bawaan
}

/** Login yang boleh diproses bersamaan per instance (sisanya mengantre). */
const MAKS_BERSAMAAN = envAngka('LOGIN_MAKS_BERSAMAAN', 20, 1)
/** Lama maksimal satu login boleh menunggu giliran sebelum dijawab "sibuk". */
const MAKS_TUNGGU_MS = envAngka('LOGIN_MAKS_TUNGGU_MS', 6000, 500)
/** Panjang antrean maksimal per instance; di atas ini langsung dijawab "sibuk". */
const MAKS_ANTREAN = envAngka('LOGIN_MAKS_ANTREAN', 300, 1)
/** Batas waktu tiap query login ke database. */
export const BATAS_QUERY_LOGIN_MS = envAngka('LOGIN_DB_TIMEOUT_MS', 10_000, 1000)
/** last_login tidak ditulis ulang kalau terakhir diperbarui < ini (ms). */
const JEDA_LAST_LOGIN_MS = envAngka('LOGIN_LAST_LOGIN_JEDA_MS', 5 * 60_000, 0)
/** Lama mengumpulkan penulisan sebelum di-flush (ms). */
const JEDA_KUMPUL_MS = envAngka('LOGIN_BATCH_JEDA_MS', 400, 0)
/** Baris maksimal per satu query batch. */
const MAKS_PER_QUERY = 200

// ── 1. Gerbang antrean ──────────────────────────────────────────────────────
type Penunggu = { lanjut: () => void; timer: ReturnType<typeof setTimeout> }

let aktif = 0
const antre: Penunggu[] = []

function buatLepas(): () => void {
  let sudah = false
  return () => {
    if (sudah) return
    sudah = true
    aktif = Math.max(0, aktif - 1)
    const berikut = antre.shift()
    if (berikut) berikut.lanjut()
  }
}

/**
 * Minta giliran memproses login. Mengembalikan fungsi `lepas` (WAJIB dipanggil,
 * pakai finally), atau null kalau antrean terlalu panjang / menunggu terlalu lama.
 */
export function masukGerbang(): Promise<(() => void) | null> {
  if (aktif < MAKS_BERSAMAAN) {
    aktif++
    return Promise.resolve(buatLepas())
  }
  if (antre.length >= MAKS_ANTREAN) return Promise.resolve(null)

  return new Promise((resolve) => {
    const penunggu: Penunggu = {
      timer: setTimeout(() => {
        const i = antre.indexOf(penunggu)
        if (i >= 0) antre.splice(i, 1)
        resolve(null)
      }, MAKS_TUNGGU_MS),
      lanjut: () => {
        clearTimeout(penunggu.timer)
        aktif++
        resolve(buatLepas())
      },
    }
    antre.push(penunggu)
  })
}

/** Perkiraan kasar berapa detik client sebaiknya menunggu sebelum mencoba lagi. */
export function perkiraanTungguDetik(): number {
  const giliran = Math.ceil((antre.length + aktif) / Math.max(1, MAKS_BERSAMAAN))
  return Math.min(10, Math.max(2, giliran * 2))
}

// ── 3. Batas waktu untuk promise ────────────────────────────────────────────
export function denganBatasWaktu<T>(janji: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(`TimeoutError: ${label} melebihi ${ms} ms`)
      e.name = 'TimeoutError'
      reject(e)
    }, ms)
    janji.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/** Apakah error ini tanda database/jaringan sedang lambat (layak dicoba lagi)? */
export function galatSementara(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null
  const teks = `${e?.name ?? ''} ${e?.message ?? ''}`.toLowerCase()
  return (
    teks.includes('timeout') ||
    teks.includes('abort') ||
    teks.includes('fetch failed') ||
    teks.includes('econnreset') ||
    teks.includes('etimedout') ||
    teks.includes('gagal memuat yayasan')
  )
}

// ── 2. Penulisan batch (last_login + log_aktivitas) ─────────────────────────
type ItemLog = { yayasanId: string; userId: string; detail: string }

let antreanLog: ItemLog[] = []
let antreanSiswa = new Set<string>()
let antreanUser = new Set<string>()
let flushTerjadwal = false

const tidur = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function ringkas(e: unknown): string {
  const msg =
    e instanceof Error ? e.message
    : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
    : String(e)
  const rapi = msg.replace(/\s+/g, ' ').trim()
  return rapi.length > 200 ? `${rapi.slice(0, 200)}… (dipotong)` : rapi
}

function potong<T>(arr: T[], ukuran: number): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran))
  return hasil
}

async function flush(): Promise<void> {
  // Ambil semua tampungan SEKARANG (sinkron) agar login yang masuk saat
  // penulisan berjalan masuk ke batch berikutnya, bukan tertulis dua kali.
  const log = antreanLog
  const siswa = Array.from(antreanSiswa)
  const users = Array.from(antreanUser)
  antreanLog = []
  antreanSiswa = new Set()
  antreanUser = new Set()
  flushTerjadwal = false

  const db = createAdminClient()
  const sekarang = new Date().toISOString()

  // Penulisan dijalankan BERURUTAN (bukan paralel) supaya tidak menambah
  // lonjakan koneksi saat database sedang padat.
  for (const bagian of potong(siswa, MAKS_PER_QUERY)) {
    try {
      const { error } = await db.from('siswa').update({ last_login: sekarang }).in('nis', bagian)
      if (error) console.error('Gagal update last_login (siswa):', ringkas(error))
    } catch (e) {
      console.error('Gagal update last_login (siswa):', ringkas(e))
    }
  }
  for (const bagian of potong(users, MAKS_PER_QUERY)) {
    try {
      const { error } = await db.from('users').update({ last_login: sekarang }).in('username', bagian)
      if (error) console.error('Gagal update last_login (user):', ringkas(error))
    } catch (e) {
      console.error('Gagal update last_login (user):', ringkas(e))
    }
  }

  // log_aktivitas: kelompokkan per yayasan (tenantDb mengisi yayasan_id).
  const perYayasan = new Map<string, ItemLog[]>()
  for (const item of log) {
    const daftar = perYayasan.get(item.yayasanId)
    if (daftar) daftar.push(item)
    else perYayasan.set(item.yayasanId, [item])
  }
  for (const [yayasanId, daftar] of Array.from(perYayasan.entries())) {
    for (const bagian of potong(daftar, MAKS_PER_QUERY)) {
      try {
        const baris = bagian.map((i) => ({
          id: generateId('LOG'),
          user_id: i.userId,
          aksi: 'LOGIN',
          detail: i.detail,
        }))
        const { error } = await tenantDb(yayasanId).from('log_aktivitas').insert(baris)
        if (error) console.error('Gagal catat log_aktivitas (LOGIN):', ringkas(error))
      } catch (e) {
        console.error('Gagal catat log_aktivitas (LOGIN):', ringkas(e))
      }
    }
  }
}

function jadwalkanFlush(): void {
  if (flushTerjadwal) return
  flushTerjadwal = true
  const kerja = async () => {
    await tidur(JEDA_KUMPUL_MS)
    await flush()
  }
  // after() = waitUntil di Vercel: dijalankan SETELAH respons terkirim, dan
  // platform menunggu sampai selesai. Di luar konteks request after() melempar
  // galat; saat itu jalankan biasa.
  try {
    after(kerja)
  } catch {
    void kerja()
  }
}

/**
 * Catat login sukses TANPA menambah beban pada jalur respons.
 *  - last_login ditulis hanya kalau sudah > JEDA_LAST_LOGIN_MS sejak nilai lama.
 *  - log_aktivitas selalu dicatat (dipakai panel Monitoring), tapi digabung.
 */
export function catatLoginTertunda(opts: {
  yayasanId: string
  tipe: 'SISWA' | 'USER'
  kunci: string // nis atau username
  lastLoginLama?: string | null
  detail: string
}): void {
  const lama = opts.lastLoginLama ? new Date(opts.lastLoginLama).getTime() : 0
  const perluTulis = !Number.isFinite(lama) || Date.now() - lama >= JEDA_LAST_LOGIN_MS
  if (perluTulis) {
    if (opts.tipe === 'SISWA') antreanSiswa.add(opts.kunci)
    else antreanUser.add(opts.kunci)
  }
  antreanLog.push({ yayasanId: opts.yayasanId, userId: opts.kunci, detail: opts.detail })
  jadwalkanFlush()
}
