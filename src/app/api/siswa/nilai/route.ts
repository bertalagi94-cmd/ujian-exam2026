import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { data: nilaiList, error } = await db
    .from('nilai')
    .select('*')
    .eq('nis', user.nis!)
    .order('timestamp', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const mapelIds = [...new Set((nilaiList ?? []).map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__'])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  // FIX (keamanan): sebelumnya endpoint ini mengembalikan SEMUA kolom tabel
  // `nilai` apa adanya, termasuk `nilai_essay` dan `nilai_total`. Akibatnya
  // siswa bisa melihat nilai essay/total lewat panggilan API ini walau guru
  // BELUM menekan tombol rilis (kolom `dirilis` masih false) — gate rilis
  // yang dimaksud di 07_essay.sql cuma ditegakkan di satu halaman UI
  // (/siswa/ujian, tampilan "?" setelah submit essay), bukan di endpoint ini.
  //
  // Karena app ini pakai service_role di semua route (RLS di-bypass, lihat
  // 05_fix_rls.sql), satu-satunya penjaga akses adalah kode di sini. Maka:
  // kolom yang baru boleh dilihat siswa SETELAH `dirilis === true` di-mask
  // jadi null selama belum dirilis. Kolom nilai PG dasar (`nilai`, `grade`,
  // `lulus`, `benar`, `total`) TIDAK disentuh karena tidak pernah diubah
  // oleh alur koreksi essay (lihat koreksi-essay/route.ts) — jadi aman
  // ditampilkan seperti biasa.
  // FIX (bug nilai essay tidak tampil di siswa): tambahkan flag
  // `essay_belum_dirilis` supaya UI bisa membedakan "mapel ini memang
  // PG-only" vs "essay ada tapi guru belum merilis" — sebelumnya tidak ada
  // cara bagi frontend membedakan keduanya sehingga nilai_total/nilai_essay
  // tidak pernah ditampilkan sama sekali. Pakai helper yang sama dengan
  // guru/kirim-nilai supaya logikanya konsisten di kedua sisi.
  const essayAktifMap = await petakanEssayAktifPerSesi(db, (nilaiList ?? []).map(n => n.sesi_id))

  const enriched = (nilaiList ?? []).map(n => {
    const essayDirilis = n.dirilis === true
    const essayAktif = n.sesi_id ? (essayAktifMap.get(n.sesi_id) ?? false) : false
    return {
      ...n,
      nilai_essay: essayDirilis ? n.nilai_essay : null,
      nilai_total: essayDirilis ? n.nilai_total : null,
      dinilai_pada: essayDirilis ? n.dinilai_pada : null,
      dinilai_oleh: essayDirilis ? n.dinilai_oleh : null,
      nama_mapel: mapelMap[n.mapel_id] ?? n.mapel_id,
      essay_belum_dirilis: essayAktif && !essayDirilis,
    }
  })

  // BUG FIX (rekap nilai siswa belum menyesuaikan fitur essay): sebelumnya
  // kartu statistik ("Rata-rata"/"Tertinggi"/"Terendah") di halaman Nilai
  // Saya dihitung murni dari `n.nilai` (PG-only) — padahal baris tabelnya
  // sendiri (lihat siswa/nilai/page.tsx) sudah menampilkan nilai_total
  // begitu essay dirilis. Sekarang dipakai nilai efektif yang sama supaya
  // konsisten dengan apa yang siswa lihat di baris tabel.
  const nilaiEfektif = (n: (typeof enriched)[number]) => {
    const essayAktif = n.sesi_id ? (essayAktifMap.get(n.sesi_id) ?? false) : false
    return (essayAktif && n.dirilis === true && n.nilai_total != null) ? n.nilai_total : (n.nilai || 0)
  }
  const nums = enriched.map(nilaiEfektif)
  const stats = {
    totalUjian: nums.length,
    rataRata: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
  }

  return NextResponse.json({ data: enriched, stats })
}
