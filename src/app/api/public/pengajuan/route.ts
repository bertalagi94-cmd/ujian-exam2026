import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import { multiYayasanAktif } from '@/lib/tenant'
import { generateId } from '@/lib/utils'
import { kirimWa } from '@/lib/wa'

export const dynamic = 'force-dynamic'

// Pengajuan aktivasi sekolah baru (dari halaman login). Pengajuan HANYA masuk
// antrean; sekolah baru bisa dipakai setelah developer menyetujuinya di /developer.

function ipKlien(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}

// Dipakai halaman login untuk menampilkan/menyembunyikan tombol "Aktivasi sekolah baru".
export async function GET() {
  return NextResponse.json(
    { data: { dibuka: multiYayasanAktif() } },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  )
}

export async function POST(req: NextRequest) {
  // Dikunci selama mode multi-yayasan mati (lihat docs/MULTI_YAYASAN.md).
  if (!multiYayasanAktif()) {
    return NextResponse.json({ error: 'Pendaftaran sekolah baru belum dibuka' }, { status: 503 })
  }

  // Batasi spam: 5 pengajuan / jam per IP (per-instance).
  const kunci = `pengajuan:${ipKlien(req)}`
  const pernah = cacheGet<number>(kunci) ?? 0
  if (pernah >= 5) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan. Coba lagi nanti' }, { status: 429 })
  }
  cacheSet(kunci, pernah + 1, 60 * 60)

  const b = await req.json().catch(() => ({}))

  // Honeypot: kolom tersembunyi yang hanya diisi bot. Pura-pura sukses.
  if (String(b.website ?? '').trim()) {
    return NextResponse.json({ data: { ok: true } }, { status: 201 })
  }

  const namaSekolah = String(b.nama_sekolah ?? '').trim().replace(/\s+/g, ' ')
  const npsn = String(b.npsn ?? '').trim()
  const username = String(b.username ?? '').trim().toLowerCase() // berisi email admin
  const password = String(b.password ?? '')
  const noHp = String(b.no_hp ?? '').replace(/[^\d+]/g, '').slice(0, 20)

  if (namaSekolah.length < 3 || namaSekolah.length > 120) {
    return NextResponse.json({ error: 'Nama sekolah 3–120 karakter' }, { status: 400 })
  }
  if (!/^\d{8}$/.test(npsn)) {
    return NextResponse.json({ error: 'NPSN harus 8 digit angka' }, { status: 400 })
  }
  // Email dipakai hanya sebagai nama login (tidak ada email yang dikirim).
  if (username.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(username)) {
    return NextResponse.json({ error: 'Email tidak valid. Contoh: namaanda@gmail.com' }, { status: 400 })
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: 'Password 8–72 karakter' }, { status: 400 })
  }
  if (password.toLowerCase() === username.toLowerCase()) {
    return NextResponse.json({ error: 'Password tidak boleh sama dengan email' }, { status: 400 })
  }

  const db = createAdminClient()

  // Username/NIS unik global; NPSN tidak boleh sudah dipakai sekolah aktif.
  const [{ data: u }, { data: s }, { data: sk }] = await Promise.all([
    db.from('users').select('username').eq('username', username).maybeSingle(),
    db.from('siswa').select('nis').eq('nis', username).maybeSingle(),
    db.from('sekolah').select('id').eq('npsn', npsn).limit(1),
  ])
  if (u || s) return NextResponse.json({ error: 'Email ini sudah dipakai, gunakan email lain' }, { status: 409 })
  if (sk && sk.length > 0) return NextResponse.json({ error: 'NPSN ini sudah terdaftar di aplikasi' }, { status: 409 })

  const { error } = await db.from('pengajuan_sekolah').insert({
    id: generateId('PGJ'),
    nama_sekolah: namaSekolah,
    npsn,
    username,
    password_hash: await bcrypt.hash(password, 10),
    no_hp: noHp || null,
  })
  if (error) {
    // 23505 = indeks unik: username/NPSN sudah punya pengajuan yang menunggu.
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: 'Pengajuan dengan email atau NPSN ini sudah ada dan sedang menunggu persetujuan' }, { status: 409 })
    }
    console.error('pengajuan_sekolah insert gagal:', error)
    return NextResponse.json({ error: 'Pengajuan gagal, coba lagi' }, { status: 500 })
  }

  // Beri tahu developer lewat WhatsApp (opsional, tidak boleh menggagalkan pengajuan).
  const nomor = process.env.ADMIN_WA_NUMBER
  if (nomor) {
    try {
      await Promise.race([
        kirimWa(nomor, `Pengajuan aktivasi sekolah baru:\n${namaSekolah}\nNPSN ${npsn}\nEmail ${username}\nBuka /developer untuk menyetujui atau menolak.`),
        new Promise(r => setTimeout(r, 4000)),
      ])
    } catch { /* abaikan */ }
  }

  return NextResponse.json({ data: { ok: true } }, { status: 201 })
}
