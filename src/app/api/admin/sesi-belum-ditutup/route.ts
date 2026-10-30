import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { muatPengingatSesi } from '@/lib/sesi-belum-ditutup'

// GET /api/admin/sesi-belum-ditutup
//
// Daftar sesi ujian yang SUDAH MELEWATI waktunya tetapi belum ditutup
// pengawas (dari hari kemarin, atau waktu ujian + toleransi sudah lewat),
// lengkap dengan nama dan nomor HP pengawas supaya admin bisa langsung
// menghubungi lewat WhatsApp. Penutupan paksa memakai endpoint yang SUDAH ada
// (POST /api/admin/sesi/[id]/tutup-paksa), tidak diubah.
//
// HANYA MEMBACA. Sesi yang baru "semua peserta sudah selesai" tapi belum
// terlambat tidak ikut dimuat di sini (itu urusan pengingat di akun pengawas).
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    const semua = await muatPengingatSesi(tenantDb(yayasanIdDari(auth.user)), {
      sertakanKontak: true,
      yayasanId: yayasanIdDari(auth.user),
    })
    const data = semua.filter(s => s.kemarin || s.lewatWaktu)
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gagal memuat daftar sesi' },
      { status: 500 }
    )
  }
}
