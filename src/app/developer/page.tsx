'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Yayasan {
  id: string; kode: string; nama: string; status: 'MENUNGGU' | 'AKTIF' | 'NONAKTIF'
  jumlah_siswa?: number; created_at?: string
}
interface Pengajuan {
  id: string; nama_sekolah: string; npsn: string; username: string; no_hp: string | null
  status: 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'; alasan_tolak: string | null
  created_at: string; diputuskan_at: string | null; kode_sekolah?: string | null
}

const input = 'px-3 py-2 rounded-lg text-sm border border-slate-300 bg-white'

export default function DeveloperPage() {
  const router = useRouter()
  const [daftar, setDaftar] = useState<Yayasan[]>([])
  const [pengajuan, setPengajuan] = useState<{ menunggu: Pengajuan[]; riwayat: Pengajuan[] }>({ menunggu: [], riwayat: [] })
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [logoAplikasi, setLogoAplikasi] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const api = useCallback(async (url: string, init?: RequestInit) => {
    const token = localStorage.getItem('dev_token')
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 401) {
      localStorage.removeItem('dev_token'); localStorage.removeItem('dev_user')
      router.replace('/developer/login')
      throw new Error('Sesi berakhir, silakan masuk lagi')
    }
    if (!res.ok) throw new Error(json.error || 'Gagal')
    return json
  }, [router])

  const muat = useCallback(async () => {
    try {
      setDaftar((await api('/api/developer/yayasan')).data)
      setPengajuan((await api('/api/developer/pengajuan')).data)
      setLogoAplikasi((await api('/api/developer/logo-aplikasi')).url ?? '')
    }
    catch (e) { setError((e as Error).message) }
  }, [api])

  useEffect(() => {
    if (!localStorage.getItem('dev_token')) { router.replace('/developer/login'); return }
    setReady(true); muat()
  }, [router, muat])

  function keluar() {
    localStorage.removeItem('dev_token'); localStorage.removeItem('dev_user')
    router.replace('/developer/login')
  }

  async function putuskan(p: Pengajuan, aksi: 'SETUJUI' | 'TOLAK') {
    setError(''); setInfo('')
    let alasan = ''
    if (aksi === 'TOLAK') {
      alasan = (window.prompt(`Alasan menolak ${p.nama_sekolah}:`) ?? '').trim()
      if (!alasan) return
    } else if (!window.confirm(`Setujui ${p.nama_sekolah} (NPSN ${p.npsn})? Email ${p.username} akan menjadi admin sekolah.`)) return
    try {
      const j = await api(`/api/developer/pengajuan/${p.id}`, { method: 'PATCH', body: JSON.stringify({ aksi, alasan }) })
      setInfo(aksi === 'SETUJUI' ? `${p.nama_sekolah} disetujui. Admin bisa login dengan email ${p.username}.` : `${p.nama_sekolah} ditolak.`)
      void j; muat()
    } catch (err) { setError((err as Error).message) }
  }

  async function ubahStatus(id: string, status: string) {
    setError('')
    try { await api(`/api/developer/yayasan/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); muat() }
    catch (err) { setError((err as Error).message) }
  }

  async function unggahLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setInfo('')
    if (!file.type.startsWith('image/')) { setError('File harus berupa gambar'); return }
    if (file.size > 2 * 1024 * 1024) { setError('Ukuran logo maksimal 2MB'); return }
    setUploadingLogo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // Tanpa Content-Type manual: browser mengisi boundary multipart sendiri.
      const res = await fetch('/api/developer/logo-aplikasi', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('dev_token')}` },
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) { keluar(); return }
      if (!res.ok) throw new Error(json.error || 'Upload gagal')
      setLogoAplikasi(json.url)
      setInfo('Logo aplikasi diperbarui untuk semua sekolah.')
    } catch (err) { setError((err as Error).message) }
    finally { setUploadingLogo(false) }
  }

  async function hapusLogo() {
    if (!window.confirm('Hapus logo aplikasi? Halaman login & sidebar semua sekolah akan memakai logo sekolah masing-masing.')) return
    setError(''); setInfo('')
    try {
      await api('/api/developer/logo-aplikasi', { method: 'DELETE' })
      setLogoAplikasi('')
      setInfo('Logo aplikasi dihapus.')
    } catch (err) { setError((err as Error).message) }
  }

  if (!ready) return null

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Panel Developer</h1>
          <button className="text-sm text-slate-500 hover:underline" onClick={keluar}>Keluar</button>
        </div>
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

        {info && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{info}</div>}

        <div className="bg-white rounded-2xl shadow">
          <div className="p-4 border-b font-semibold text-slate-800">
            Logo aplikasi <span className="ml-2 font-normal text-xs text-slate-400">— tampil di halaman login &amp; sidebar semua sekolah (bukan di dokumen cetak)</span>
          </div>
          <div className="p-4 flex items-start gap-4 flex-wrap">
            {logoAplikasi ? (
              <div className="w-24 h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoAplikasi} alt="Logo aplikasi" className="max-w-full max-h-full object-contain p-1" />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                Belum ada
              </div>
            )}
            <div className="flex flex-col gap-2 text-sm">
              <label className={`${input} cursor-pointer text-center ${uploadingLogo ? 'opacity-60 pointer-events-none' : 'hover:bg-slate-50'}`}>
                {uploadingLogo ? 'Mengupload...' : 'Upload logo'}
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" onChange={unggahLogo} disabled={uploadingLogo} />
              </label>
              {logoAplikasi && <button className="text-red-600 text-left" onClick={hapusLogo}>Hapus logo</button>}
              <p className="text-xs text-slate-400">Format: JPG, PNG, GIF, WebP. Maks 2MB. Hanya akun developer yang bisa mengubahnya.</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <div className="p-4 border-b font-semibold text-slate-800">
            Pengajuan sekolah baru {pengajuan.menunggu.length > 0 && <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">{pengajuan.menunggu.length} menunggu</span>}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 border-b">
              <tr><th className="p-3">Sekolah</th><th className="p-3">NPSN</th><th className="p-3">Email</th><th className="p-3">WhatsApp</th><th className="p-3">Diajukan</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {pengajuan.menunggu.map(p => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{p.nama_sekolah}</td>
                  <td className="p-3 font-mono">{p.npsn}</td>
                  <td className="p-3 font-mono">{p.username}</td>
                  <td className="p-3">{p.no_hp || '-'}</td>
                  <td className="p-3 text-slate-500">{new Date(p.created_at).toLocaleString('id-ID')}</td>
                  <td className="p-3 text-right space-x-3 whitespace-nowrap">
                    <button className="text-emerald-700 font-medium" onClick={() => putuskan(p, 'SETUJUI')}>Setujui</button>
                    <button className="text-red-600" onClick={() => putuskan(p, 'TOLAK')}>Tolak</button>
                  </td>
                </tr>
              ))}
              {pengajuan.menunggu.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">Tidak ada pengajuan yang menunggu</td></tr>}
            </tbody>
          </table>
          {pengajuan.riwayat.length > 0 && (
            <details className="border-t">
              <summary className="p-3 text-sm text-slate-500 cursor-pointer">Riwayat keputusan ({pengajuan.riwayat.length} terakhir)</summary>
              <ul className="px-3 pb-3 text-sm space-y-1">
                {pengajuan.riwayat.map(p => (
                  <li key={p.id} className="text-slate-600">
                    <b>{p.nama_sekolah}</b> ({p.npsn}) — {p.status === 'DISETUJUI' ? `disetujui` : `ditolak: ${p.alasan_tolak ?? '-'}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <div className="p-4 border-b font-semibold text-slate-800">Daftar sekolah</div>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 border-b">
              <tr><th className="p-3">Nama sekolah</th><th className="p-3">Status</th><th className="p-3">Siswa</th><th className="p-3">Terdaftar</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {daftar.map(y => (
                <tr key={y.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{y.nama}</td>
                  <td className="p-3">{y.status === 'MENUNGGU' ? 'Menunggu' : y.status === 'AKTIF' ? 'Aktif' : 'Nonaktif'}</td>
                  <td className="p-3">{y.jumlah_siswa ?? 0}</td>
                  <td className="p-3 text-slate-500">{y.created_at ? new Date(y.created_at).toLocaleDateString('id-ID') : '-'}</td>
                  <td className="p-3 text-right space-x-3 whitespace-nowrap">
                    {y.id !== 'YYS_AWAL' && (y.status === 'NONAKTIF'
                      ? <button className="text-emerald-700" onClick={() => ubahStatus(y.id, 'AKTIF')}>Aktifkan</button>
                      : <button className="text-red-600" onClick={() => ubahStatus(y.id, 'NONAKTIF')}>Nonaktifkan</button>)}
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada sekolah</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
