# Ganti password tidak lagi dipaksa saat login (3 Nov 2026)

Ekstrak zip di root repo (folder yang berisi package.json), timpa file yang sama.

| File | Perubahan |
|---|---|
| `src/lib/auth.ts` | `WAJIB_GANTI_PASSWORD_AKTIF` = `false`. Login tidak lagi mengarahkan ke halaman ganti password, dan token lama yang membawa klaim wajib-ganti tidak lagi memblokir endpoint. |
| `src/components/shared/Sidebar.tsx` | Menu "Ganti Password" (admin, guru, kepsek) di atas tombol Keluar. Siswa tetap lewat "Profil Saya". |
| `src/app/ganti-password/page.tsx` | Mode sukarela: teks netral + tombol "Kembali". Mode wajib (kalau saklar dinyalakan lagi) tetap seperti semula. |

Untuk mengaktifkan paksa ganti password lagi: ubah saklar di `src/lib/auth.ts` ke `true`.
`npx tsc --noEmit` lulus.
