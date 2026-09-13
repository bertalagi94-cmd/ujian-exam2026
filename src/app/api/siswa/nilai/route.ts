import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'
import { hitungGrade } from '@/lib/utils'

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

    // BUG FIX (nilai remedial guru tidak masuk ke akun siswa): endpoint ini
    // sebelumnya TIDAK PERNAH memakai nilai_edit/grade_edit/lulus_edit
    // (nilai remedial yang guru input di tab "Rekap Nilai" — lihat
    // RekapNilaiTab.tsx) walau kolomnya sudah ikut terambil oleh
    // `select('*')` di atas. Akibatnya siswa yang sudah lulus KKM lewat
    // remedial (dan sudah tampil lulus di tab Rekap Nilai guru maupun di
    // tab Kirim Nilai/wali kelas) tetap melihat nilai & status LAMA
    // (sebelum remedial) di akun mereka sendiri — kontradiktif dengan apa
    // yang guru & wali kelas lihat. Sekarang nilai_edit (kalau diisi) jadi
    // prioritas utama, PERSIS urutan prioritas hitungNilaiFinal() di
    // api/guru/kirim-nilai/route.ts. Bedanya dengan versi guru: di sini
    // nilai_total (PG+Essay) TETAP tidak boleh dipakai sebelum essay
    // benar-benar dirilis (`essayDirilis`) — nilai_edit sendiri BOLEH
    // dilihat siswa kapan saja karena itu keputusan final guru yang
    // sengaja menggantikan hasil ujian, terlepas dari status rilis essay.
    const adaRemedial = n.nilai_edit !== null && n.nilai_edit !== undefined
    const nilaiEfektifSiswa = (essayAktif && essayDirilis && n.nilai_total != null) ? n.nilai_total : n.nilai
    const nilaiFinal = adaRemedial ? (n.nilai_edit as number) : nilaiEfektifSiswa
    const gradeFinal = adaRemedial
      ? (n.grade_edit ?? hitungGrade(nilaiFinal))
      : (essayDirilis && essayAktif && n.nilai_total != null ? hitungGrade(n.nilai_total) : n.grade)
    const lulusFinal = adaRemedial
      ? (n.lulus_edit ?? (nilaiFinal >= n.kkm))
      : (essayDirilis && essayAktif && n.nilai_total != null ? n.nilai_total >= n.kkm : n.lulus)

    return {
      ...n,
      nilai_essay: essayDirilis ? n.nilai_essay : null,
      nilai_total: essayDirilis ? n.nilai_total : null,
      dinilai_pada: essayDirilis ? n.dinilai_pada : null,
      dinilai_oleh: essayDirilis ? n.dinilai_oleh : null,
      nama_mapel: mapelMap[n.mapel_id] ?? n.mapel_id,
      essay_belum_dirilis: essayAktif && !essayDirilis,
      ada_remedial: adaRemedial,
      nilai_final: nilaiFinal,
      grade_final: gradeFinal,
      lulus_final: lulusFinal,
    }
  })

  // BUG FIX (rekap nilai siswa belum menyesuaikan fitur essay): sebelumnya
  // kartu statistik ("Rata-rata"/"Tertinggi"/"Terendah") di halaman Nilai
  // Saya dihitung murni dari `n.nilai` (PG-only) — padahal baris tabelnya
  // sendiri (lihat siswa/nilai/page.tsx) sudah menampilkan nilai_total
  // begitu essay dirilis. Sekarang dipakai nilai efektif yang sama supaya
  // konsisten dengan apa yang siswa lihat di baris tabel.
  //
  // BUG FIX (nilai remedial tidak ikut kartu statistik): pakai nilai_final
  // (sudah dihitung di atas, termasuk remedial) supaya kartu ini juga tidak
  // ketinggalan begitu guru menyimpan nilai remedial.
  const nums = enriched.map(n => n.nilai_final)
  const stats = {
    totalUjian: nums.length,
    rataRata: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
  }

  return NextResponse.json({ data: enriched, stats })
}
