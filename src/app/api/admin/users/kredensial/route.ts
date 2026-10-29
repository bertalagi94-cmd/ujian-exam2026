import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { catatAktivitas } from '@/lib/aktivitas'

// POST /api/admin/users/kredensial
//
// Data untuk "Ekspor Akun" (Excel + kartu PDF) di halaman Data Pengguna.
//
// KEAMANAN — kenapa bentuknya begini:
//  * Password di database adalah HASH bcrypt, tidak bisa dibaca kembali dan
//    TIDAK PERNAH dikirim ke browser. Endpoint ini hanya membuktikan di server
//    apakah password sebuah akun MASIH SAMA DENGAN USERNAME-nya (aturan
//    password awal aplikasi ini: impor tanpa kolom Password dan "Reset
//    Password" sama-sama mengembalikannya ke username). Kalau ya, passwordnya
//    dikembalikan (= username). Kalau tidak (sudah diganti / diatur sendiri),
//    `password` = null dan akun itu perlu direset dulu oleh admin.
//  * Tidak mengubah apa pun di database; hanya membaca (+ satu catatan log).
//  * Hanya ADMIN, otomatis dibatasi ke yayasannya (tenantDb). Akun ber-role
//    ADMIN tidak pernah ikut diekspor. Akun tester dan nonaktif dilewati.
//  * Dipanggil dengan POST (bukan GET) supaya tidak ikut ter-cache/prefetch,
//    dan responsnya no-store.
//  * Tiap pemanggilan dicatat di log_aktivitas (siapa & berapa akun).

export const dynamic = 'force-dynamic'

// Satu bcrypt.compare (bcryptjs, cost 10) ≈ 100–250 ms di server. 200 akun
// ≈ 20–50 detik, jadi route ini diberi maxDuration 60 di vercel.json dan
// jumlah akun dibatasi di sini supaya tidak melewati batas waktu fungsi.
const MAKS_AKUN = 200

const TANPA_CACHE = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' }

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))

  const { data, error } = await db
    .from('users')
    .select('username, nama, role, password_hash')
    .neq('role', 'ADMIN')
    .eq('status', 'AKTIF')
    .neq('is_tester', 'YES')
    .order('nama')
    .limit(MAKS_AKUN + 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: TANPA_CACHE })

  const rows = (data ?? []) as { username: string; nama: string; role: string; password_hash: string | null }[]
  if (rows.length > MAKS_AKUN) {
    return NextResponse.json(
      { error: `Jumlah akun lebih dari ${MAKS_AKUN}. Ekspor dibatasi demi keamanan dan kecepatan.` },
      { status: 413, headers: TANPA_CACHE }
    )
  }

  const hasil: { username: string; nama: string; role: string; password: string | null }[] = []
  let passwordTerbaca = 0
  for (const u of rows) {
    // password_hash HANYA dipakai di sini dan tidak ikut ke respons.
    const masihDefault = !!u.password_hash && (await bcrypt.compare(String(u.username), u.password_hash))
    if (masihDefault) passwordTerbaca++
    hasil.push({
      username: u.username,
      nama: u.nama,
      role: u.role,
      password: masihDefault ? String(u.username) : null,
    })
  }

  // Nama sekolah untuk kop kartu (opsional; kosong kalau belum diisi).
  const { data: peng } = await db.from('pengaturan').select('value').eq('key', 'namaSekolah').maybeSingle()
  const namaSekolah = String((peng as { value?: string } | null)?.value ?? '').trim()

  catatAktivitas(
    db,
    auth.user.username,
    'EKSPOR_AKUN',
    `Ekspor akun pengguna: ${hasil.length} akun, ${passwordTerbaca} dengan password awal terbaca.`
  )

  return NextResponse.json(
    { data: hasil, total: hasil.length, passwordTerbaca, namaSekolah },
    { headers: TANPA_CACHE }
  )
}
