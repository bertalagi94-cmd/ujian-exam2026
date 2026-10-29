// Isi tab "Q&A" di jendela Tentang (beranda login).
// Dulu ini berupa jendela sendiri (QAModal); sekarang hanya isinya saja,
// dan "pembungkus"-nya ada di TentangModal.tsx.
//
// Pertanyaan DIKELOMPOKKAN PER PERAN: pembaca memilih peran lewat tab di
// bagian atas, lalu hanya melihat pertanyaan untuk peran itu.
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { QA_ROLES, type QaRoleId } from './QaData'

export default function QAPanel() {
  // Siswa adalah pengguna terbanyak, jadi tab pertama yang terbuka.
  const [activeRole, setActiveRole] = useState<QaRoleId>('siswa')
  const [openQA, setOpenQA] = useState<string | null>(null)
  const role = QA_ROLES.find(r => r.id === activeRole) ?? QA_ROLES[0]

  function pilihRole(id: QaRoleId) {
    setActiveRole(id)
    setOpenQA(null)
  }

  return (
    <div>
      {/* Tab peran */}
      <div className="border-b border-slate-100 overflow-x-auto">
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

      <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
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
    </div>
  )
}
