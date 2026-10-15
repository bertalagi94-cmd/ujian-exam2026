/**
 * Fondasi multi-yayasan (lihat supabase/39_multi_yayasan.sql dan
 * docs/MULTI_YAYASAN.md).
 *
 * Istilah:
 *   yayasan = pemilik data (tenant). Satu database bisa memuat banyak yayasan.
 *   sekolah = (tabel lama) jenjang di dalam yayasan.
 *
 * Isi file ini:
 *   1. tenantDb(yayasanId)  — client database yang OTOMATIS membatasi semua
 *      query ke satu yayasan, sehingga route tidak perlu mengingat
 *      `.eq('yayasan_id', ...)` di setiap query (mudah lupa = data bocor).
 *   2. yayasanIdDari(user)  — ambil yayasan dari token login.
 *   3. requireDeveloper()   — penjaga untuk Panel Developer.
 *   4. helper kode registrasi dan pencarian yayasan.
 *
 * PENTING — status migrasi route (Fase 1 vs Fase 2):
 *   Wrapper ini sudah tersedia, tetapi route API lama belum memakainya
 *   (masih createAdminClient() polos). Selama itu, pendaftaran yayasan baru
 *   dikunci lewat env MULTI_YAYASAN_ENABLED (default mati).
 */
import { createHash, randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { requireRole, getTokenFromRequest, type JWTPayload } from '@/lib/auth'
import { cachedFetch, cacheGet, cacheSet } from '@/lib/cache'

/** Yayasan yang menampung seluruh data lama (dibuat oleh migrasi 39). */
export const YAYASAN_AWAL_ID = 'YYS_AWAL'

/**
 * Tabel yang punya kolom yayasan_id (sama dengan daftar di migrasi 39).
 * Tabel volume besar (jawaban, siswa_ujian, pelanggaran, dst.) sengaja tidak
 * ada di sini — mereka terikat lewat sesi_id yang diambil dari query
 * ber-scope yayasan. Tambahkan nama tabel ke sini kalau migrasi Fase 2
 * menambahkan kolom yayasan_id ke tabel lain.
 */
export const TABEL_PER_YAYASAN: ReadonlySet<string> = new Set([
  'sekolah', 'users', 'siswa', 'kelas', 'mapel', 'kelas_mapel', 'jadwal',
  'sesi_ujian', 'nilai', 'paket_soal', 'soal', 'paket_essay', 'soal_essay',
  'kisi_kisi', 'pengaturan', 'log_aktivitas',
  // Ditambahkan di migrasi 42 (diisi otomatis dari sesi_ujian oleh trigger).
  'pelanggaran',
])

/** Saklar keamanan: pendaftaran yayasan baru hanya boleh jalan kalau 'true'. */
export function multiYayasanAktif(): boolean {
  return process.env.MULTI_YAYASAN_ENABLED === 'true'
}

/**
 * Operasi yang bekerja pada SELURUH database (backup, reset, restore) belum
 * punya versi per yayasan. Selama saklar multi-yayasan menyala, operasi itu
 * ditolak untuk semua orang supaya admin satu yayasan tidak bisa menghapus
 * atau menimpa data yayasan lain. Pakai fitur backup bawaan Supabase.
 * Mengembalikan Response penolakan, atau null kalau boleh lanjut.
 */
export function tolakJikaMultiYayasan(): Response | null {
  if (!multiYayasanAktif()) return null
  return new Response(
    JSON.stringify({
      error:
        'Fitur ini dinonaktifkan selama mode multi-yayasan menyala karena bekerja pada seluruh database. Gunakan backup bawaan Supabase.',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Ambil yayasan dari token. Token yang diterbitkan SEBELUM fitur ini belum
 * punya klaim yayasanId; selama saklar multi-yayasan mati itu pasti milik
 * yayasan awal (satu-satunya yayasan aktif). Kalau saklar sudah menyala,
 * token tanpa klaim ditolak (fail-closed) — pengguna cukup login ulang.
 */
export function yayasanIdDari(user: Pick<JWTPayload, 'yayasanId'>): string {
  if (user.yayasanId) return user.yayasanId
  if (!multiYayasanAktif()) return YAYASAN_AWAL_ID
  throw new Error('Token tidak memuat yayasan. Silakan login ulang.')
}

type AnyClient = SupabaseClient<any>

/**
 * Client database yang terkunci ke satu yayasan.
 *
 *   const db = tenantDb(yayasanIdDari(auth.user))
 *   await db.from('siswa').select('*')            // hanya siswa yayasan ini
 *   await db.from('siswa').insert({ nis, ... })   // yayasan_id terisi otomatis
 *   await db.from('siswa').update({...}).eq(...)  // hanya baris yayasan ini
 *   await db.from('siswa').delete().eq(...)       // hanya baris yayasan ini
 *
 * Aturan:
 *   - select/update/delete ditambah `.eq('yayasan_id', id)`.
 *   - insert/upsert: yayasan_id diisi otomatis. Kalau pemanggil mengisi
 *     yayasan_id yang BERBEDA, langsung error (bukan diam-diam ditimpa).
 *   - Tabel di luar TABEL_PER_YAYASAN dan `rpc`/`storage` diteruskan apa
 *     adanya. Fungsi RPC TIDAK otomatis ter-scope: kirim hanya id yang
 *     sebelumnya diambil lewat query ber-scope.
 */
export function tenantDb(yayasanId: string): AnyClient {
  if (!yayasanId) throw new Error('tenantDb: yayasanId wajib diisi')
  const base = createAdminClient()

  const sisipkan = (rows: unknown): unknown => {
    const isi = (row: any) => {
      if (row && typeof row === 'object') {
        if (row.yayasan_id != null && row.yayasan_id !== yayasanId) {
          throw new Error('Penulisan lintas yayasan ditolak')
        }
        return { ...row, yayasan_id: yayasanId }
      }
      return row
    }
    return Array.isArray(rows) ? rows.map(isi) : isi(rows)
  }

  return new Proxy(base, {
    get(target, prop) {
      const nilai = (target as any)[prop]
      if (prop !== 'from') return typeof nilai === 'function' ? nilai.bind(target) : nilai

      return (tabel: string) => {
        const qb: any = target.from(tabel)
        if (!TABEL_PER_YAYASAN.has(tabel)) return qb

        return new Proxy(qb, {
          get(t, p) {
            const m = t[p]
            if (typeof m !== 'function') return m
            switch (p) {
              case 'update':
                // Tolak perubahan yang memindahkan baris ke yayasan lain
                // (mis. body request berisi yayasan_id orang lain).
                return (...args: unknown[]) => {
                  const isi = args[0] as { yayasan_id?: unknown } | null
                  if (isi && typeof isi === 'object' && isi.yayasan_id != null && isi.yayasan_id !== yayasanId) {
                    throw new Error('Pemindahan data lintas yayasan ditolak')
                  }
                  return m.apply(t, args).eq('yayasan_id', yayasanId)
                }
              case 'select':
              case 'delete':
                return (...args: unknown[]) => m.apply(t, args).eq('yayasan_id', yayasanId)
              case 'insert':
              case 'upsert':
                return (rows: unknown, ...rest: unknown[]) => m.apply(t, [sisipkan(rows), ...rest])
              default:
                return m.bind(t)
            }
          },
        })
      }
    },
  }) as AnyClient
}

/**
 * Pastikan SEMUA id (dari body request) memang milik yayasan ini di `tabel`.
 * Dipakai sebelum menautkan data ke id yang dikirim klien (mis. sekolah_ids).
 */
export async function idsMilikYayasan(
  db: AnyClient,
  tabel: string,
  ids: string[],
  kolom: string = 'id' // mis. 'username' untuk tabel users, 'nis' untuk siswa
): Promise<boolean> {
  const unik = [...new Set(ids.map(String))]
  if (unik.length === 0) return true
  const { data, error } = await db.from(tabel).select(kolom).in(kolom, unik)
  if (error) return false
  return (data?.length ?? 0) === unik.length
}

// ── Pencarian yayasan ───────────────────────────────────────────────────────

export interface Yayasan {
  id: string
  kode: string
  nama: string
  status: 'MENUNGGU' | 'AKTIF' | 'NONAKTIF'
}

/** Normalisasi input Kode Sekolah dari pengguna: huruf besar, tanpa spasi. */
export function normalisasiKodeSekolah(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

export async function cariYayasanByKode(kode: string): Promise<Yayasan | null> {
  const k = normalisasiKodeSekolah(kode)
  if (!/^[A-Z0-9]{3,20}$/.test(k)) return null
  return cachedFetch<Yayasan | null>(`yayasan:kode:${k}`, 60, async () => {
    const { data, error } = await createAdminClient()
      .from('yayasan').select('id, kode, nama, status').eq('kode', k).maybeSingle()
    if (error) throw new Error(`Gagal memuat yayasan: ${error.message}`)
    return (data as Yayasan | null) ?? null
  })
}

/**
 * Tentukan yayasan untuk endpoint /api/public/* (belum tentu ada login).
 * Urutan: (1) token login yang valid, (2) parameter ?kode= (Kode Sekolah),
 * (3) YYS_AWAL hanya selama saklar multi-yayasan MATI. Selain itu null:
 * pemanggil WAJIB mengembalikan data kosong (fail-closed), bukan data semua
 * yayasan. `dariToken` true berarti respons bergantung pada token, jadi
 * TIDAK boleh disimpan di cache bersama (CDN).
 *
 * Tebakan kode dibatasi: 20 kode salah / 10 menit per IP, supaya endpoint
 * publik tidak bisa dipakai menebak Kode Sekolah milik yayasan lain.
 */
export async function yayasanIdPublik(
  req: NextRequest
): Promise<{ id: string; dariToken: boolean } | null> {
  const user = getTokenFromRequest(req)
  if (user) {
    try {
      return { id: yayasanIdDari(user), dariToken: true }
    } catch {
      // Token lama tanpa klaim yayasan: lanjut ke jalur kode.
    }
  }

  const kode = normalisasiKodeSekolah(req.nextUrl.searchParams.get('kode'))
  if (kode) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
    const kunci = `kode-gagal:${ip}`
    const gagal = cacheGet<number>(kunci) ?? 0
    if (gagal >= 20) return null
    const yys = await cariYayasanByKode(kode)
    if (!yys || yys.status !== 'AKTIF') {
      cacheSet(kunci, gagal + 1, 10 * 60)
      return null
    }
    return { id: yys.id, dariToken: false }
  }

  return multiYayasanAktif() ? null : { id: YAYASAN_AWAL_ID, dariToken: false }
}


export async function cariYayasanById(id: string): Promise<Yayasan | null> {
  return cachedFetch<Yayasan | null>(`yayasan:id:${id}`, 60, async () => {
    const { data, error } = await createAdminClient()
      .from('yayasan').select('id, kode, nama, status').eq('id', id).maybeSingle()
    if (error) throw new Error(`Gagal memuat yayasan: ${error.message}`)
    return (data as Yayasan | null) ?? null
  })
}

// ── Penjaga Panel Developer ─────────────────────────────────────────────────

/**
 * Hanya akun ADMIN yayasan awal yang usernamenya tercantum di env
 * DEVELOPER_USERNAMES (dipisah koma) yang boleh memakai Panel Developer.
 * Env kosong/tidak diset = tidak ada yang punya akses (fail-closed).
 * Token "Lihat sebagai" tidak pernah diterima.
 */
export function requireDeveloper(
  req: NextRequest
): { user: JWTPayload } | { error: Response } {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth
  const { user } = auth

  const daftar = (process.env.DEVELOPER_USERNAMES ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  const diizinkan =
    !user.viewAs &&
    daftar.includes(user.username) &&
    (user.yayasanId ?? YAYASAN_AWAL_ID) === YAYASAN_AWAL_ID

  if (!diizinkan) {
    return {
      error: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      }),
    }
  }
  return { user }
}

// ── Kode registrasi ─────────────────────────────────────────────────────────

// Tanpa 0/O/1/I/L supaya mudah dibaca dan diketik ulang.
const ALFABET_KODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Buat kode acak 12 karakter, tampil sebagai XXXX-XXXX-XXXX. */
export function buatKodeRegistrasi(): string {
  const bytes = randomBytes(12)
  let hasil = ''
  for (let i = 0; i < 12; i++) hasil += ALFABET_KODE[bytes[i] % ALFABET_KODE.length]
  return `${hasil.slice(0, 4)}-${hasil.slice(4, 8)}-${hasil.slice(8, 12)}`
}

/** Bersihkan input pengguna (huruf besar, buang strip/spasi) lalu hash SHA-256. */
export function hashKodeRegistrasi(kode: string): string {
  const bersih = String(kode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return createHash('sha256').update(bersih).digest('hex')
}

/** Kode registrasi berlaku 14 hari sejak dibuat. */
export const MASA_BERLAKU_KODE_HARI = 14
