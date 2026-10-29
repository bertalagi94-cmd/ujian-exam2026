// PERF: modal Q&A dipisah dari src/app/login/page.tsx supaya bisa
// di-lazy-load lewat next/dynamic({ ssr: false }) — kode & data (QA_ROLES)
// modal ini tidak lagi ikut ke initial JS bundle halaman /login.
//
// Pertanyaan DIKELOMPOKKAN PER PERAN: pembaca memilih peran lewat tab di
// bagian atas, lalu hanya melihat pertanyaan untuk peran itu.
'use client'

import { useState } from 'react'
import { HelpCircle, X, BookMarked, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { QA_ROLES, type QaRoleId } from './QaData'

interface QAModalProps {
  year: number
  onClose: () => void
  onOpenGuide: () => void
}

export default function QAModal({ year, onClose, onOpenGuide }: QAModalProps) {
  // Siswa adalah pengguna terbanyak, jadi tab pertama yang terbuka.
  const [activeRole, setActiveRole] = useState<QaRoleId>('siswa')
  const [openQA, setOpenQA] = useState<string | null>(null)
  const role = QA_ROLES.find(r => r.id === activeRole) ?? QA_ROLES[0]

  function pilihRole(id: QaRoleId) {
    setActiveRole(id)
    setOpenQA(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.80)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base sm:text-lg">Q&A / Bantuan</h2>
              <p className="text-xs text-slate-400">Pilih peran Anda untuk melihat pertanyaan yang sesuai</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab peran */}
        <div className="flex-shrink-0 border-b border-slate-100 overflow-x-auto">
          <div className="flex gap-1.5 p-2 sm:p-3 min-w-max" role="tablist" aria-label="Pilih peran">
            {QA_ROLES.map(r => {
              const aktif = r.id === activeRole
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={aktif}
                  onClick={() => pilihRole(r.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap border transition-colors ${
                    aktif
                      ? `${r.bg} ${r.text} ${r.border}`
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}
                >
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                    aktif ? `bg-gradient-to-br ${r.gradient} text-white` : 'bg-slate-100 text-slate-400'
                  }`}>{r.icon}</span>
                  {r.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* Penjelasan "pertanyaan ini untuk siapa" */}
          <div className={`rounded-2xl border ${role.border} ${role.bg} px-4 py-3 flex items-center gap-3`}>
            <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-white bg-gradient-to-br ${role.gradient} flex-shrink-0`}>{role.icon}</span>
            <div>
              <h3 className={`font-bold text-sm ${role.text}`}>Pertanyaan untuk: {role.label}</h3>
              <p className="text-xs text-slate-600">{role.untuk}</p>
            </div>
          </div>

          {role.groups.map(group => (
            <div key={group.category}>
              <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${role.text}`}>{group.category}</h4>
              <div className="space-y-2">
                {group.items.map((item, i) => {
                  const key = `${role.id}-${group.category}-${i}`
                  const isOpen = openQA === key
                  return (
                    <div key={key} className="border border-slate-200 rounded-xl overflow-hidden">
                      <button type="button" onClick={() => setOpenQA(isOpen ? null : key)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                        <span className="text-sm font-medium text-slate-800">{item.q}</span>
                        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                      </button>
                      {isOpen && (
                        <div className={`px-4 pb-4 pt-1 ${role.bg} border-t border-slate-100`}>
                          <p className="text-sm text-slate-600 leading-relaxed">{item.a}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-amber-800 text-sm mb-1">Masalah tidak terdaftar di sini?</h4>
                <p className="text-amber-700 text-sm leading-relaxed">Segera hubungi <strong>Administrator Sistem</strong> sekolah Anda. Untuk masalah teknis kritis, administrator perlu menghubungi pengelola sistem untuk penanganan lebih lanjut.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
          <p className="text-xs text-slate-400 hidden sm:block">SmartExam &copy; {year}</p>
          <div className="flex gap-2 w-full sm:w-auto">
            <button type="button" onClick={() => { onClose(); onOpenGuide() }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
              <BookMarked className="w-4 h-4" /> Panduan
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors">Tutup</button>
          </div>
        </div>
      </div>
    </div>
  )
}
