import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import { signDeveloperToken } from '@/lib/developer-auth'

export const dynamic = 'force-dynamic'

// Login akun developer (tabel developer_akun, terpisah dari users/siswa).
// Pembatasan lebih ketat daripada login sekolah: akun ini punya kuasa atas
// seluruh sekolah. Catatan: counter ada di memori per instance serverless,
// jadi ini menaikkan biaya brute force, bukan pengganti rate limit terdistribusi.
// Gunakan password panjang (minimal 12 karakter).
const MAKS_GAGAL = 5
const JENDELA_DETIK = 15 * 60
const GENERIC = 'Username atau password salah'
const DUMMY_HASH = bcrypt.hashSync('tidak-dipakai-sebagai-password', 10)

type Hitung = { count: number; firstAt: number }

function ipDari(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }

    const ip = ipDari(req)
    const kunci = `dev-gagal:${ip}`
    const d = cacheGet<Hitung>(kunci)
    if (d && d.count >= MAKS_GAGAL) {
      const sisa = Math.max(Math.ceil((d.firstAt + JENDELA_DETIK * 1000 - Date.now()) / 1000), 1)
      return NextResponse.json(
        { error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(sisa / 60)} menit.` },
        { status: 429 }
      )
    }

    const db = createAdminClient()
    const { data: akun } = await db.from('developer_akun')
      .select('id, username, nama, password_hash, status')
      .eq('username', username.toLowerCase())
      .eq('status', 'AKTIF').maybeSingle()

    // bcrypt selalu dijalankan supaya waktu respons sama.
    const cocok = await bcrypt.compare(password, akun?.password_hash || DUMMY_HASH)
    if (!akun || !cocok) {
      const sekarang = cacheGet<Hitung>(kunci)
      const firstAt = sekarang?.firstAt ?? Date.now()
      const sisaTtl = Math.max(Math.ceil((firstAt + JENDELA_DETIK * 1000 - Date.now()) / 1000), 1)
      cacheSet(kunci, { count: (sekarang?.count ?? 0) + 1, firstAt }, sisaTtl)
      return NextResponse.json({ error: GENERIC }, { status: 401 })
    }

    db.from('developer_akun').update({ last_login: new Date().toISOString() }).eq('id', akun.id)
      .then(({ error }: { error: unknown }) => { if (error) console.error('Gagal update last_login developer:', error) })

    const token = signDeveloperToken({ username: akun.username, nama: akun.nama })
    return NextResponse.json({ token, username: akun.username, nama: akun.nama })
  } catch (err) {
    console.error('Login developer error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
