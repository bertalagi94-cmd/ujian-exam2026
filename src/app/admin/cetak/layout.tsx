// Layout halaman cetak.
// PERBAIKAN: sebelumnya mengembalikan <html><body> bersarang di dalam <body>
// milik root layout (tidak valid, memicu mismatch hidrasi). <html>/<body>
// hanya boleh ada di src/app/layout.tsx. Tampilan "tanpa sidebar" dicapai di
// page.tsx lewat portal ke <body> + aturan CSS yang menyembunyikan sisanya.
export default function CetakLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
