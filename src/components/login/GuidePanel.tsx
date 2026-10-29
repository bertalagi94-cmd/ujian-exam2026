// Isi tab "Panduan" di jendela Tentang (beranda login).
// Dulu ini berupa jendela sendiri (GuideModal); sekarang hanya isinya saja,
// dan "pembungkus"-nya ada di TentangModal.tsx.
'use client'

import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { ROLES } from './RolesData'

export default function GuidePanel() {
  const [activeRole, setActiveRole] = useState('admin')
  const activeRoleData = ROLES.find(r => r.id === activeRole) ?? ROLES[0]

  return (
    <div className="flex flex-col sm:flex-row">
      <div className="sm:w-44 flex-shrink-0 sm:border-r border-b sm:border-b-0 border-slate-100 sm:py-4 overflow-x-auto">
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
      <div className="flex-1 p-4 sm:p-6 min-w-0">
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
          <p className="text-xs text-slate-500 leading-relaxed">Butuh bantuan lebih lanjut? Hubungi administrator sekolah atau buka tab <strong>Q&amp;A</strong>.</p>
        </div>
      </div>
    </div>
  )
}
