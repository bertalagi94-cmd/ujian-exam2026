'use client'

import Link from 'next/link'
import { ClipboardList, CheckSquare, Send, ChevronRight, Check } from 'lucide-react'

// FIX (kejelasan alur Essay): proses nilai Essay melewati 4 menu terpisah
// (Buat Soal → Mode Pengawas untuk mode KERTAS → Koreksi Essay → Kirim
// Nilai), dan sebelum ini tidak ada satu pun tempat yang merangkum urutan
// lengkapnya — guru harus tahu sendiri dari pengalaman. Komponen ini HANYA
// menampilkan ringkasan & link antar-halaman yang sudah ada; tidak
// menambah/mengubah endpoint, state, atau aturan bisnis apa pun.
//
// `current` menyorot langkah yang sedang dilihat guru supaya dia tahu
// "saya di tahap mana" dan "apa selanjutnya" tanpa perlu bertanya.
export type EssayFlowStep = 'buat-soal' | 'koreksi' | 'rilis'

const STEPS: {
  key: EssayFlowStep
  label: string
  desc: string
  href: string
  icon: React.ElementType
}[] = [
  {
    key: 'buat-soal',
    label: 'Buat Soal Essay',
    desc: 'Tulis soal & atur mode jawaban/durasi/bobot di menu Buat Soal',
    href: '/guru/paket',
    icon: ClipboardList,
  },
  {
    key: 'koreksi',
    label: 'Koreksi Essay',
    desc: 'Baca jawaban siswa (diketik, atau langsung dari kertas fisik untuk mode Kertas), input nilai per soal',
    href: '/guru/koreksi-essay',
    icon: CheckSquare,
  },
  {
    key: 'rilis',
    label: 'Rilis Nilai',
    desc: 'Buka nilai Essay & Total ke siswa, lalu kirim ke wali kelas',
    href: '/guru/kirim-nilai',
    icon: Send,
  },
]

export function EssayFlowGuide({ current }: { current: EssayFlowStep }) {
  const currentIdx = STEPS.findIndex(s => s.key === current)

  return (
    <div className="card-sm border-indigo-100 bg-indigo-50/40">
      <p className="text-xs font-semibold text-indigo-800 mb-3">
        Alur nilai Essay — 4 langkah lintas menu
      </p>
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
        {STEPS.map((step, i) => {
          const isCurrent = step.key === current
          const isDone = i < currentIdx
          const Icon = step.icon
          const body = (
            <div
              className={`flex-1 flex items-start gap-2.5 rounded-xl px-3 py-2.5 border text-left transition-colors ${
                isCurrent
                  ? 'bg-white border-indigo-300 shadow-sm'
                  : isDone
                    ? 'bg-white/60 border-indigo-100'
                    : 'bg-transparent border-transparent hover:bg-white/50'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
                  isCurrent
                    ? 'bg-indigo-600 text-white'
                    : isDone
                      ? 'bg-indigo-200 text-indigo-700'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <div className="min-w-0">
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${isCurrent ? 'text-indigo-900' : 'text-slate-700'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {step.label}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{step.desc}</p>
              </div>
            </div>
          )
          return (
            <div key={step.key} className="flex items-center gap-2 flex-1">
              {isCurrent ? body : <Link href={step.href} className="flex-1 flex">{body}</Link>}
              {i < STEPS.length - 1 && (
                <ChevronRight className="w-4 h-4 text-indigo-300 hidden sm:block flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
