import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { hitungDanSimpanNilai } from '@/lib/hitung-nilai'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { sesiId } = await req.json()

  // FIX: sebelumnya endpoint ini hanya mengecek role GURU, tidak mengecek
  // apakah guru pemanggil memang pengawas sesi ini — sehingga guru mana pun
  // bisa menutup (dan memicu auto-grade) sesi ujian milik guru lain kalau
  // memanggil API ini langsung.
  const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
  if (!sah) {
    return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId)

  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
  }

  // Ambil dulu NIS siswa yang masih AKTIF/RESET SEBELUM diubah statusnya —
  // mereka butuh dihitung nilainya di bawah.
  const { data: siswaBelumSelesai } = await db
    .from('siswa_ujian')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  // FIX: tambahkan 'RESET' agar siswa yang sedang di-reset juga ikut diselesaikan
  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])   // ← FIX: was .eq('status', 'AKTIF')

  // FIX: sebelumnya siswa yang sesinya ditutup paksa oleh pengawas (mis.
  // karena jaringan mati total dan tidak sempat submit sendiri) hanya
  // ditandai SELESAI tanpa nilai — mereka "hilang" dari rekap nilai dan baru
  // ketahuan lewat menu terpisah "belum nilai" di dashboard Kepsek, butuh
  // tindak lanjut manual guru. Sekarang nilai langsung dihitung dari
  // jawaban yang SUDAH tersimpan di DB (hasil auto-sync selama ujian
  // berjalan) — sama seperti perhitungan submit normal. Kalau memang belum
  // sempat menjawab apa pun, hasilnya otomatis 0 (bukan hilang dari rekap).
  // Dijalankan satu per satu (bukan Promise.all) supaya cache paket
  // soal/kunci per sesi (di hitungDanSimpanNilai) dipakai bersama tanpa
  // race condition saat pertama kali diisi.
  for (const s of siswaBelumSelesai ?? []) {
    try {
      await hitungDanSimpanNilai(db, sesiId, s.nis)
    } catch (e) {
      // Jangan sampai satu siswa gagal dihitung membuat seluruh proses tutup
      // sesi gagal — catat saja, guru tetap bisa input manual/susulan untuk
      // siswa itu lewat menu nilai.
      console.error(`Gagal hitung nilai otomatis untuk NIS ${s.nis} sesi ${sesiId}:`, e)
    }
  }

  return NextResponse.json({ message: 'Sesi berhasil ditutup' })
}
