// GET /api/developer/penyimpanan — ukuran Supabase Storage & Database, khusus developer.
//
// Hanya ukuran dan jumlah file (agregat). Tidak ada nama file / isi file /
// data siswa, sesuai dinding keamanan Panel Developer.
//
// Kuota TIDAK bisa dibaca dari Supabase lewat API, jadi diatur lewat env
// (sesuaikan dengan paket Supabase Bapak):
//   SUPABASE_STORAGE_KUOTA_MB  (default 1024  = 1 GB,  kuota paket Free)
//   SUPABASE_DB_KUOTA_MB       (default 500   = 500 MB, kuota paket Free)
// Paket Pro: 102400 (100 GB) dan 8192 (8 GB) sudah termasuk di harga dasar.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/developer-auth'

export const dynamic = 'force-dynamic'

const MB = 1024 * 1024

function kuotaByte(env: string | undefined, bawaanMb: number): number {
  const n = Number(env)
  return (Number.isFinite(n) && n > 0 ? n : bawaanMb) * MB
}

function ringkas(pakai: number, kuota: number) {
  return {
    pakaiByte: pakai,
    kuotaByte: kuota,
    sisaByte: Math.max(0, kuota - pakai),
    persen: kuota > 0 ? Math.min(100, Math.round((pakai / kuota) * 1000) / 10) : 0,
  }
}

interface BarisFolder { bucket_id: string; folder: string; jumlah_file: number; ukuran_byte: number }

export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const [folder, dbSize, yayasan] = await Promise.all([
    db.rpc('ukuran_storage_per_folder'),
    db.rpc('ukuran_database'),
    db.from('yayasan').select('id, nama'),
  ])

  if (folder.error || dbSize.error) {
    const pesan = (folder.error ?? dbSize.error)!.message
    return NextResponse.json({
      error: `Gagal membaca ukuran penyimpanan (${pesan}). Pastikan migrasi supabase/52_ukuran_storage.sql sudah dijalankan di SQL Editor.`,
    }, { status: 500 })
  }

  const baris = (folder.data ?? []) as BarisFolder[]
  const namaYayasan = new Map<string, string>(
    ((yayasan.data ?? []) as { id: string; nama: string }[]).map(y => [String(y.id), y.nama])
  )

  // Folder pertama = id yayasan (kecuali yayasan awal yang file-nya di akar,
  // dan berkas umum seperti logo aplikasi). Selain id yayasan → "umum".
  const perSekolah = new Map<string, { id: string; nama: string; jumlahFile: number; ukuranByte: number }>()
  const perBucket = new Map<string, { bucket: string; jumlahFile: number; ukuranByte: number }>()
  let totalByte = 0
  let totalFile = 0

  for (const b of baris) {
    const ukuran = Number(b.ukuran_byte) || 0
    const jumlah = Number(b.jumlah_file) || 0
    totalByte += ukuran
    totalFile += jumlah

    const kb = perBucket.get(b.bucket_id) ?? { bucket: b.bucket_id, jumlahFile: 0, ukuranByte: 0 }
    kb.jumlahFile += jumlah; kb.ukuranByte += ukuran
    perBucket.set(b.bucket_id, kb)

    const kunci = namaYayasan.has(b.folder) ? b.folder : '_UMUM'
    const ks = perSekolah.get(kunci) ?? {
      id: kunci,
      nama: kunci === '_UMUM' ? 'Yayasan utama & berkas umum' : namaYayasan.get(kunci)!,
      jumlahFile: 0, ukuranByte: 0,
    }
    ks.jumlahFile += jumlah; ks.ukuranByte += ukuran
    perSekolah.set(kunci, ks)
  }

  const kuotaStorage = kuotaByte(process.env.SUPABASE_STORAGE_KUOTA_MB, 1024)
  const kuotaDb = kuotaByte(process.env.SUPABASE_DB_KUOTA_MB, 500)

  return NextResponse.json({
    storage: { ...ringkas(totalByte, kuotaStorage), jumlahFile: totalFile },
    database: ringkas(Number(dbSize.data) || 0, kuotaDb),
    perSekolah: [...perSekolah.values()].sort((a, b) => b.ukuranByte - a.ukuranByte),
    perBucket: [...perBucket.values()].sort((a, b) => b.ukuranByte - a.ukuranByte),
    timestamp: new Date().toISOString(),
  })
}
