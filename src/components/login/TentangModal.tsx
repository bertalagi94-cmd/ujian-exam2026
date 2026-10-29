// Jendela "Tentang" di beranda login — menggabungkan Fitur, Panduan, dan Q&A
// dalam satu tombol. Dibuka dari tombol "Tentang" di dekat tombol
// "Aktivasi Sekolah".
//
// PERF: dipisah dari src/app/login/page.tsx dan di-lazy-load lewat
// next/dynamic({ ssr: false }), jadi kodenya baru diunduh saat tombolnya
// pertama kali ditekan — tidak ikut bundle awal halaman /login.
'use client'

import { useState, type ReactNode } from 'react'
import { Info, X, Sparkles, BookMarked, HelpCircle } from 'lucide-react'
import FiturPanel from './FiturPanel'
import GuidePanel from './GuidePanel'
import QAPanel from './QAPanel'

export type TentangTab = 'fitur' | 'panduan' | 'qa'

interface TentangModalProps {
  year: number
  onClose: () => void
  /** Tab yang terbuka pertama kali. Bawaan: Fitur. */
  initialTab?: TentangTab
}

const TABS: { id: TentangTab; label: string; icon: ReactNode }[] = [
  { id: 'fitur', label: 'Fitur', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'panduan', label: 'Panduan', icon: <BookMarked className="w-4 h-4" /> },
  { id: 'qa', label: 'Q&A', icon: <HelpCircle className="w-4 h-4" /> },
]

export default function TentangModal({ year, onClose, initialTab = 'fitur' }: TentangModalProps) {
  const [tab, setTab] = useState<TentangTab>(initialTab)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.80)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog" aria-modal="true" aria-label="Tentang SmartExam">
        {/* Kepala */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-sky-500 to-teal-500 flex items-center justify-center flex-shrink-0">
              <Info className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base sm:text-lg">Tentang SmartExam</h2>
              <p className="text-xs text-slate-400">Fitur, panduan, dan jawaban atas pertanyaan umum</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab */}
        <div className="flex-shrink-0 border-b border-slate-100">
          <div className="flex gap-1.5 p-2 sm:p-3" role="tablist" aria-label="Bagian Tentang">
            {TABS.map(t => {
              const aktif = t.id === tab
              return (
                <button key={t.id} type="button" role="tab" aria-selected={aktif}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 sm:flex-none sm:min-w-[120px] flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    aktif
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}
                >
                  {t.icon}{t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Isi — hanya tab aktif yang dirender */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'fitur' && <FiturPanel />}
          {tab === 'panduan' && <GuidePanel />}
          {tab === 'qa' && <QAPanel />}
        </div>

        {/* Kaki */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
          <p className="text-xs text-slate-400 hidden sm:block">SmartExam &copy; {year}</p>
          <button type="button" onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors">Tutup</button>
        </div>
      </div>
    </div>
  )
}
