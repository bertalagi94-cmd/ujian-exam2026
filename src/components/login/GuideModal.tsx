// PERF: modal Panduan dipisah dari src/app/login/page.tsx supaya bisa
// di-lazy-load lewat next/dynamic({ ssr: false }) — kode & data (ROLES)
// modal ini tidak lagi ikut ke initial JS bundle halaman /login.
'use client'

import { useState } from 'react'
import { BookMarked, X, HelpCircle, CheckCircle } from 'lucide-react'
import { ROLES } from './RolesData'

interface GuideModalProps {
  year: number
  onClose: () => void
  onOpenQA: () => void
}

export default function GuideModal({ year, onClose, onOpenQA }: GuideModalProps) {
  const [activeRole, setActiveRole] = useState('admin')
  const activeRoleData = ROLES.find(r => r.id === activeRole) ?? ROLES[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.80)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <BookMarked className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base sm:text-lg">Panduan Penggunaan</h2>
              <p className="text-xs text-slate-400">SmartExam — Sistem Ujian Digital</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
          <div className="sm:w-44 flex-shrink-0 sm:border-r border-b sm:border-b-0 border-slate-100 sm:py-4 overflow-x-auto sm:overflow-y-auto">
            <div className="flex sm:flex-col gap-1 p-2 sm:p-0 min-w-max sm:min-w-0">
              {ROLES.map(role => (
                <button key={role.id} type="button" onClick={() => setActiveRole(role.id)}
                  className={`flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-none text-left transition-all text-xs sm:text-sm font-medium whitespace-nowrap sm:whitespace-normal sm:w-full sm:border-r-2 ${
                    activeRole === role.id
                      ? `${role.bgLight} ${role.text} border ${role.border} sm:border-0 sm:border-r-2`
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-transparent'
                  }`}
                >
                  <span className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    activeRole === role.id ? `bg-gradient-to-br ${role.color} text-white` : 'bg-slate-100 text-slate-400'
                  }`}>{role.icon}</span>
                  {role.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className={`rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6 bg-gradient-to-br ${activeRoleData.color} text-white`}>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">{activeRoleData.icon}</div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg">{activeRoleData.label}</h3>
                  <p className="text-white/80 text-xs sm:text-sm">{activeRoleData.desc}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {activeRoleData.steps.map((step, i) => (
                <div key={i} className={`rounded-xl border ${activeRoleData.border} ${activeRoleData.bgLight} p-3 sm:p-4`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br ${activeRoleData.color} text-white flex items-center justify-center flex-shrink-0 mt-0.5`}>{step.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeRoleData.badge}`}>{i + 1}</span>
                        <h4 className={`font-semibold text-sm ${activeRoleData.text}`}>{step.title}</h4>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 sm:mt-5 p-3 sm:p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-500 leading-relaxed">Butuh bantuan lebih lanjut? Hubungi administrator sistem atau lihat section <strong>Q&A / Bantuan</strong>.</p>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
          <p className="text-xs text-slate-400 hidden sm:block">SmartExam &copy; {year}</p>
          <div className="flex gap-2 w-full sm:w-auto">
            <button type="button" onClick={() => { onClose(); onOpenQA() }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
              <HelpCircle className="w-4 h-4" /> Q&amp;A
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors">Tutup</button>
          </div>
        </div>
      </div>
    </div>
  )
}
