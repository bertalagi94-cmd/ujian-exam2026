import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Cek di tabel users (guru, admin, pengawas, kepsek)
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('username', username.trim())
      .eq('status', 'AKTIF')
      .single()

    if (user) {
      const match = await bcrypt.compare(String(password), user.password_hash)
      if (!match) {
        return NextResponse.json({ error: 'Password salah' }, { status: 401 })
      }
      const token = signToken({
        username: user.username,
        nama: user.nama,
        role: user.role,
      })
      // Update last_login
      await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('username', user.username)

      return NextResponse.json({
        token,
        username: user.username,
        nama: user.nama,
        role: user.role,
      })
    }

    // Cek di tabel siswa (login dengan NIS)
    const { data: siswa } = await supabase
      .from('siswa')
      .select('*')
      .eq('nis', username.trim())
      .eq('status', 'AKTIF')
      .single()

    if (siswa) {
      const match = await bcrypt.compare(String(password), siswa.password_hash)
      if (!match) {
        return NextResponse.json({ error: 'Password salah' }, { status: 401 })
      }
      const token = signToken({
        username: siswa.nis,
        nama: siswa.nama,
        role: 'SISWA',
        nis: siswa.nis,
        kelas: siswa.kelas,
      })
      await supabase
        .from('siswa')
        .update({ last_login: new Date().toISOString() })
        .eq('nis', siswa.nis)

      return NextResponse.json({
        token,
        username: siswa.nis,
        nama: siswa.nama,
        role: 'SISWA',
        nis: siswa.nis,
        kelas: siswa.kelas,
      })
    }

    return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
