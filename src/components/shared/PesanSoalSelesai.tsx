'use client'

// ── Pesan penutup di bawah diagram donat ──────────────────────────────────────
// Ditampilkan menggantikan teks "X dari Y ... belum disetujui" ketika SEMUA
// paket soal sudah berstatus Disetujui. Judul besar bergradasi warna dengan kilau
// yang bergerak pelan; di bawahnya pesan kecil yang mengingatkan agar fokus
// ke pengawasan ujian. Animasi dimatikan otomatis bila perangkat memilih
// "kurangi gerakan". Font dimuat dari Google Fonts dengan cadangan font sistem,
// jadi tetap rapi saat offline.

import { PartyPopper } from 'lucide-react'

export function PesanSoalSelesai({ untuk = 'guru' }: { untuk?: 'guru' | 'admin' }) {
  const pesan =
    untuk === 'admin'
      ? 'Seluruh paket soal dari para guru sudah disetujui dan siap dipakai. Sekarang saatnya memastikan ujian berjalan jujur, tertib, dan lancar. Jaga kelancaran ruang ujian dan pantau pengawasannya.'
      : 'Semua paket soal Anda sudah disetujui dan siap dipakai. Kini saatnya mengalihkan fokus ke pengawasan: hadir tepat waktu, pantau ruang ujian dengan teliti, dan jaga agar ujian berjalan jujur, tertib, dan lancar.'

  return (
    <div className="psl-kotak relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-indigo-50 px-4 py-5 text-center animate-fade-in">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Pacifico&family=Poppins:wght@400;500&display=swap');
        @keyframes psl-kilau { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes psl-melayang { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-4px) rotate(6deg); } }
        .psl-judul {
          font-family: 'Pacifico', 'Brush Script MT', 'Segoe Script', cursive;
          background-image: linear-gradient(90deg, #059669, #0ea5e9, #6366f1, #d946ef, #059669);
          background-size: 200% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: psl-kilau 6s linear infinite;
          filter: drop-shadow(0 2px 6px rgba(99,102,241,.18));
        }
        .psl-pesan { font-family: 'Poppins', system-ui, sans-serif; }
        .psl-ikon { animation: psl-melayang 3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .psl-judul, .psl-ikon { animation: none; } }
      `}</style>

      <span aria-hidden className="pointer-events-none absolute -left-8 -top-8 h-28 w-28 rounded-full bg-emerald-200/50 blur-2xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-10 -right-8 h-32 w-32 rounded-full bg-indigo-200/50 blur-2xl" />

      <div className="relative">
        <PartyPopper aria-hidden className="psl-ikon mx-auto mb-1 h-6 w-6 text-amber-500" />
        <h3 className="psl-judul text-2xl leading-snug sm:text-3xl">
          Pembuatan Soal Anda sudah selesai
        </h3>
        <p className="psl-judul mt-0.5 text-lg sm:text-xl">Terima Kasih</p>
        <p className="psl-pesan mx-auto mt-3 max-w-md text-xs leading-relaxed text-slate-500">{pesan}</p>
      </div>
    </div>
  )
}
