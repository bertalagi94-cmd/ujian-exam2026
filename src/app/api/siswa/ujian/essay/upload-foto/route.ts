// Taruh di: src/app/api/siswa/ujian/essay/upload-foto/route.ts
//
// FIX (keputusan desain baru — mode KERTAS TIDAK LAGI memakai foto sama
// sekali): sebelumnya endpoint ini menerima upload foto lembar jawaban
// (mode KERTAS) dan menyimpan foto_url ke tabel jawaban_essay_foto. Setelah
// dicek, endpoint ini TERNYATA dead code — tidak pernah dipanggil dari mana
// pun di frontend (grep -rn "upload-foto" di seluruh src mengonfirmasi ini):
// halaman siswa/ujian/page.tsx untuk mode KERTAS sejak awal didesain HANYA
// menampilkan soal + tombol "Selesai", TANPA tombol unggah foto apa pun
// (lihat komentar di siswa/ujian/page.tsx, sekitar bagian "Mode KERTAS:
// TIDAK ada tombol kirim/unggah foto sama sekali").
//
// Keputusan eksplisit: lembar jawaban fisik mode KERTAS dikumpulkan MANUAL
// oleh pengawas ruang ujian, lalu diserahkan ke guru untuk dinilai langsung
// dari kertas — bukan lewat foto yang diunggah ke aplikasi. Guru tetap
// memberi skor per soal lewat UI koreksi essay (lihat koreksi-essay/route.ts
// & PeriksaEssayTab.tsx), hanya saja tanpa referensi foto.
//
// FIX: endpoint dinonaktifkan secara eksplisit (410 Gone) dengan pesan yang
// jelas, mengikuti pola yang sama dengan
// guru/mode-pengawas/buka-akses-essay/route.ts, alih-alih dibiarkan sebagai
// dead code yang masih bisa dipanggil langsung (Postman/curl) dan diam-diam
// mengunggah foto ke storage tanpa pernah dipakai siapa pun.
import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error:
        'Fitur unggah foto lembar jawaban (mode KERTAS) sudah dinonaktifkan. ' +
        'Sesuai desain terbaru, siswa mode KERTAS cukup menulis jawaban di ' +
        'kertas fisik dan menekan "Selesai" — lembar jawaban dikumpulkan ' +
        'manual oleh pengawas ruang ujian, lalu dinilai guru langsung dari ' +
        'kertas. Endpoint ini tidak lagi menyimpan apa pun.',
    },
    { status: 410 }
  )
}
