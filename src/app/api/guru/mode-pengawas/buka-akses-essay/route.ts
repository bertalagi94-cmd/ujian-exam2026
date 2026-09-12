// Taruh di: src/app/api/guru/mode-pengawas/buka-akses-essay/route.ts
//
// FIX BUG (mekanisme "Buka Akses Kirim" mode KERTAS sudah tidak fungsional
// sama sekali): endpoint ini dulu men-set siswa_ujian.akses_kirim_essay_dibuka
// = true dengan tujuan menjadi gerbang tombol "Kirim" di akun siswa mode
// KERTAS (lihat 07_essay.sql). Tapi desain mode KERTAS sudah sengaja diubah
// (lihat komentar di essay/kirim/route.ts): guru menilai langsung dari kertas
// fisik, siswa cukup menekan "Selesai" kapan pun, TANPA syarat "akses kirim
// dibuka" lagi. Akibatnya field akses_kirim_essay_dibuka tidak pernah dibaca
// di mana pun lagi (grep -rn di seluruh src mengonfirmasi ini) — endpoint ini
// jadi dead code yang terlihat berfungsi di UI/UX (response sukses) padahal
// tidak mengubah perilaku siswa sama sekali. Ini berbahaya karena README
// masih mendaftarkan tombol ini sebagai pekerjaan frontend yang belum
// dibuat — kalau dibangun nanti, tombolnya akan terlihat berfungsi (guru
// dapat pesan sukses) padahal tidak berefek apa pun ke siswa.
//
// FIX: endpoint dinonaktifkan secara eksplisit (410 Gone) dengan pesan yang
// jelas, alih-alih dibiarkan pura-pura berhasil. Kalau sekolah memang masih
// butuh gerbang manual pengawas untuk mode KERTAS, endpoint ini perlu
// dibangun ulang dari nol supaya essay/kirim/route.ts benar-benar
// memeriksa akses_kirim_essay_dibuka lagi sebelum menerima "Kirim" — lihat
// juga catatan README bagian "SISA PEKERJAAN" yang sudah diperbarui.
import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error:
        'Fitur "Buka Akses Kirim" (mode KERTAS) sudah dinonaktifkan. Sejak ' +
        'perubahan desain terbaru, siswa mode KERTAS boleh menekan "Kirim" ' +
        'kapan pun tanpa perlu dibuka pengawas, dan guru menilai langsung ' +
        'dari kertas fisik. Endpoint ini tidak lagi mengubah perilaku apa pun.',
    },
    { status: 410 }
  )
}
