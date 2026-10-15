import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import { hashKodeRegistrasi, multiYayasanAktif } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Registrasi mandiri sekolah baru memakai Kode Registrasi dari developer.
// Semua langkah (klaim kode, buat admin, buat jenjang) terjadi dalam satu
// transaksi di fungsi database registrasi_yayasan_atomik().
const PESAN: Record<string, [string, number]> = {
  KODE_TIDAK_VALID: ['Kode registrasi tidak valid', 400],
  KODE_SUDAH_DIPAKAI: ['Kode registrasi sudah pernah dipakai', 400],
  KODE_KEDALUWARSA: ['Kode registrasi sudah kedaluwarsa. Minta kode baru ke developer', 400],
  YAYASAN_NONAKTIF: ['Sekolah ini sedang dinonaktifkan. Hubungi developer', 403],
  USERNAME_DIPAKAI: ['Username sudah dipakai, pilih username lain', 409],
  JENJANG_TIDAK_VALID: ['Isi minimal 1 dan maksimal 10 jenjang', 400],
}

function ipKlien(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  // Dikunci sampai route API selesai dibuat sadar-yayasan (lihat docs/MULTI_YAYASAN.md).
  if (!multiYayasanAktif()) {
    return NextResponse.json({ error: 'Registrasi sekolah baru belum dibuka' }, { status: 503 })
  }

  // Batasi tebak-tebakan kode: 8 percobaan / 15 menit per IP (per-instance).
  const kunci = `reg:${ipKlien(req)}`
  const pernah = cacheGet<number>(kunci) ?? 0
  if (pernah >= 8) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi' }, { status: 429 })
  }
  cacheSet(kunci, pernah + 1, 15 * 60)

  const b = await req.json().catch(() => ({}))
  const username = String(b.username ?? '').trim()
  const password = String(b.password ?? '')
  const nama = String(b.nama ?? '').trim()

  if (!b.kode_registrasi) return NextResponse.json({ error: 'Kode registrasi wajib diisi' }, { status: 400 })
  if (!/^[A-Za-z0-9._-]{4,30}$/.test(username)) {
    return NextResponse.json({ error: 'Username 4–30 karakter (huruf, angka, titik, strip, garis bawah)' }, { status: 400 })
  }
  if (password.length < 8) return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 })
  if (!nama) return NextResponse.json({ error: 'Nama admin wajib diisi' }, { status: 400 })

  const jenjang = Array.isArray(b.jenjang)
    ? b.jenjang.slice(0, 10).map((j: any) => ({
        label: String(j?.label ?? '').trim().slice(0, 30),
        nama_sekolah: String(j?.nama_sekolah ?? '').trim().slice(0, 120),
        npsn: String(j?.npsn ?? '').trim().slice(0, 20),
        kota: String(j?.kota ?? '').trim().slice(0, 60),
      }))
    : []

  const { data, error } = await createAdminClient().rpc('registrasi_yayasan_atomik', {
    p_kode_hash: hashKodeRegistrasi(b.kode_registrasi),
    p_username: username,
    p_password_hash: await bcrypt.hash(password, 10),
    p_nama: nama,
    p_no_hp: String(b.no_hp ?? '').trim().slice(0, 20),
    p_jenjang: jenjang,
  })
  if (error) {
    console.error('registrasi_yayasan_atomik gagal:', error)
    return NextResponse.json({ error: 'Registrasi gagal, coba lagi' }, { status: 500 })
  }
  if (!data?.ok) {
    const [pesan, status] = PESAN[data?.kode] ?? ['Registrasi gagal', 400]
    return NextResponse.json({ error: pesan }, { status })
  }
  return NextResponse.json({ data: { kode_sekolah: data.kode_sekolah } }, { status: 201 })
}
