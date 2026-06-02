'use client'

import { useState, useEffect, useCallback } from 'react'
import { Save, Settings } from 'lucide-react'
import { PageLoader, Toast, Spinner } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Pengaturan } from '@/types'

export default function AdminPengaturanPage() {
  const [settings, setSettings] = useState<Pengaturan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Pengaturan[] }>('/api/admin/pengaturan')
      setSettings(res.data)
      setValues(Object.fromEntries(res.data.map(s => [s.key, s.value ?? ''])))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await apiRequest('/api/admin/pengaturan', {
        method: 'PUT',
        body: JSON.stringify({ settings: Object.entries(values).map(([key, value]) => ({ key, value })) }),
      })
      setToast({ msg: 'Pengaturan berhasil disimpan', type: 'success' })
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Gagal menyimpan', type: 'error' })
    } finally { setSaving(false) }
  }

  const inputTypeMap: Record<string, string> = {
    batasPelanggaran: 'number',
    durasiDefault: 'number',
    kkm: 'number',
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Pengaturan Sistem</h1>
        <p className="page-subtitle">Konfigurasi aplikasi SmartExam</p>
      </div>

      <form onSubmit={handleSave}>
        <div className="card space-y-5">
          <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
            <Settings className="w-4 h-4 text-brand-600" />
            <h2 className="font-semibold text-slate-900">Konfigurasi Umum</h2>
          </div>

          {settings.map(s => (
            <div key={s.key}>
              <label className="label">
                {s.deskripsi ?? s.key}
                <span className="text-slate-400 font-normal ml-1 text-xs">({s.key})</span>
              </label>
              {s.key.toLowerCase().includes('logo') || s.key.toLowerCase().includes('url') ? (
                <input
                  type="url"
                  className="input"
                  value={values[s.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [s.key]: e.target.value }))}
                  placeholder="https://..."
                />
              ) : (
                <input
                  type={inputTypeMap[s.key] ?? 'text'}
                  className="input"
                  value={values[s.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [s.key]: e.target.value }))}
                  min={inputTypeMap[s.key] === 'number' ? 0 : undefined}
                />
              )}
            </div>
          ))}

          <div className="pt-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan Pengaturan</>}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
