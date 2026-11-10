'use client'

// ── Pesan penutup di samping diagram donat ────────────────────────────────────
// Ditampilkan menggantikan SELURUH legenda status (Disetujui / Menunggu / Draft /
// Ditolak) dan teks "belum disetujui" ketika semua paket soal sudah Disetujui.
// Judul besar bergradasi warna dengan kilau pelan, huruf serif formal (Playfair
// Display) dipadu Montserrat untuk isi pesan. Font dimuat dari Google Fonts dengan
// cadangan font sistem, jadi tetap rapi saat offline. Animasi dimatikan otomatis
// bila perangkat memilih "kurangi gerakan".

import { Award } from 'lucide-react'

export function PesanSoalSelesai({ untuk = 'guru' }: { untuk?: 'guru' | 'admin' }) {
  const pesan =
    untuk === 'admin'
      ? 'Seluruh paket soal dari para guru sudah disetujui dan siap dipakai. Kini saatnya memastikan ujian berjalan jujur, tertib, dan lancar: jaga kelancaran ruang ujian dan pantau pengawasannya.'
      : 'Semua paket soal Anda sudah disetujui dan siap dipakai. Kini saatnya mengalihkan fokus ke pengawasan: hadir tepat waktu, pantau ruang ujian dengan teliti, dan jaga agar ujian berjalan jujur, tertib, dan lancar.'

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-emerald-50/80 via-white to-indigo-50/80 px-5 py-8 text-center shadow-sm animate-fade-in sm:px-8 sm:py-10">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Playfair+Display:ital,wght@0,700;0,800;1,600&display=swap');
        @keyframes psl-kilau { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes psl-denyut { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(217,119,6,.25); } 50% { transform: scale(1.06); box-shadow: 0 0 0 8px rgba(217,119,6,0); } }
        .psl-judul {
          font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
          font-weight: 800;
          letter-spacing: -0.01em;
          background-image: linear-gradient(90deg, #0f766e, #4338ca, #7c3aed, #0f766e);
          background-size: 200% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: psl-kilau 7s linear infinite;
        }
        .psl-terima { font-family: 'Playfair Display', Georgia, serif; font-style: italic; font-weight: 600; letter-spacing: .04em; }
        .psl-pesan { font-family: 'Montserrat', system-ui, sans-serif; }
        .psl-lencana { animation: psl-denyut 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .psl-judul, .psl-lencana { animation: none; } }
      `}</style>

      <span aria-hidden className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full bg-emerald-200/50 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-12 -right-10 h-40 w-40 rounded-full bg-indigo-200/50 blur-3xl" />

      <div className="relative">
        <span className="psl-lencana mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-500/30">
          <Award aria-hidden className="h-6 w-6" />
        </span>

        <h3 className="psl-judul text-3xl leading-tight sm:text-4xl">
          Pembuatan Soal Anda<br className="hidden sm:block" /> sudah selesai
        </h3>

        <p className="psl-terima mt-2 text-xl text-slate-700 sm:text-2xl">Terima Kasih</p>

        <span aria-hidden className="mx-auto my-4 block h-px w-20 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />

        <p className="psl-pesan mx-auto max-w-lg text-sm leading-relaxed text-slate-600 sm:text-[15px]">{pesan}</p>
      </div>
    </div>
  )
}
