'use client'

// Admin → Ruang Khusus.
// Untuk siswa yang tidak punya HP dan ujian di lab komputer. Admin memilih
// jadwal yang belum selesai (yang sedang berjalan boleh) dan satu guru pengawas
// ruang. Sistem memastikan guru itu bebas pada jam jadwal-jadwal tersebut.
// Selanjutnya guru itu mendapat menu "Pengawas Ruang Khusus".
import { useState, useEffect, useCallback } from 'react'
import { Spinner, Toast, Confirm } from '@/components/ui'
import { apiRequest } from '@/lib/utils'

interface JadwalOpsi { id: string; tanggal: string; jam_mulai: string; jam_selesai: string; mapel: string; kelas: string; berjalan: boolean }
interface Guru { username: string; nama: string }
interface RuangItem {
  id: string; nama: string | null; status: 'MENUNGGU' | 'BERJALAN' | 'SELESAI' | 'DIBATALKAN'
  kode_ruang: string; pengawas: string; nama_pengawas: string; jumlah_siswa: number
  jadwal: { id: string; tanggal: string; jam: string; mapel: string; kelas: string }[]
}
interface Muat { tanggal: string; jadwal: JadwalOpsi[]; guru: Guru[]; ruang: RuangItem[] }

const WARNA_STATUS: Record<RuangItem['status'], string> = {
  MENUNGGU: 'bg-amber-100 text-amber-700',
  BERJALAN: 'bg-emerald-100 text-emerald-700',
  SELESAI: 'bg-slate-100 text-slate-600',
  DIBATALKAN: 'bg-red-50 text-red-600',
}

export default function RuangKhususAdminPage() {
  const [data, setData] = useState<Muat | null>(null)
  const [loading, setLoading] = useState(true)
  const [tanggal, setTanggal] = useState('')
  const [nama, setNama] = useState('')
  const [pengawas, setPengawas] = useState('')
  const [pilih, setPilih] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [batalId, setBatalId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const muat = useCallback(async (tgl?: string) => {
    setLoading(true)
    try {
      const r = await apiRequest<Muat>(`/api/admin/ruang-khusus${tgl ? `?tanggal=${tgl}` : ''}`)
      setData(r)
      setTanggal(r.tanggal)
      // Buang pilihan yang tidak ada lagi di daftar tanggal ini.
      setPilih(p => new Set([...p].filter(id => r.jadwal.some(j => j.id === id))))
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal memuat', type: 'error' })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { muat() }, [muat])

  function toggle(id: string) {
    setPilih(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function simpan() {
    setSaving(true)
    try {
      const r = await apiRequest<{ message: string; kodeRuang: string }>('/api/admin/ruang-khusus', {
        method: 'POST',
        body: JSON.stringify({ nama, pengawas, jadwalIds: [...pilih] }),
      })
      setToast({ msg: r.message, type: 'success' })
      setNama(''); setPengawas(''); setPilih(new Set())
      await muat(tanggal)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal menyimpan', type: 'error' })
    } finally { setSaving(false) }
  }

  async function batalkan() {
    if (!batalId) return
    try {
      const r = await apiRequest<{ message: string }>('/api/admin/ruang-khusus', {
        method: 'PATCH', body: JSON.stringify({ id: batalId, aksi: 'batal' }),
      })
      setToast({ msg: r.message, type: 'success' })
      await muat(tanggal)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal membatalkan', type: 'error' })
    } finally { setBatalId(null) }
  }

  const siapSimpan = pilih.size > 0 && !!pengawas && !saving

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <Confirm
        open={!!batalId} onClose={() => setBatalId(null)} onConfirm={batalkan}
        title="Batalkan ruang khusus?" confirmLabel="Ya, batalkan"
        message="Siswa yang sudah diproses di ruang ini kembali ke sesi kelasnya masing-masing."
      />
      <div>
        <h1 className="page-title">Ruang Khusus</h1>
        <p className="page-subtitle">
          Untuk siswa yang tidak punya HP dan ujian di lab komputer. Satu ruang punya satu pengawas dan satu kode,
          meskipun siswanya dari beberapa kelas dan mapel.
        </p>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="font-semibold text-slate-900">Buat ruang baru</h2>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Tanggal ujian</label>
            <input type="date" className="input" value={tanggal} onChange={e => { setTanggal(e.target.value); if (e.target.value) muat(e.target.value) }} />
          </div>
          <div>
            <label className="label">Nama ruang (opsional)</label>
            <input className="input" placeholder="mis. Lab Komputer 1" maxLength={60} value={nama} onChange={e => setNama(e.target.value)} />
          </div>
          <div>
            <label className="label">Guru pengawas ruang</label>
            <select className="select" value={pengawas} onChange={e => setPengawas(e.target.value)}>
              <option value="">— pilih guru —</option>
              {data?.guru.map(g => <option key={g.username} value={g.username}>{g.nama}</option>)}
            </select>
          </div>
        </div>

        <div>
          <p className="label">Jadwal yang dipakai ruang ini</p>
          <p className="text-xs text-slate-500 mb-2">
            Hanya jadwal yang belum selesai. Jadwal yang sedang berjalan boleh dipilih. Pilih beberapa jadwal bila ruang dipakai bergantian.
          </p>
          {loading ? <div className="flex justify-center py-6"><Spinner /></div>
            : !data?.jadwal.length ? <p className="text-sm text-slate-500 py-3">Tidak ada jadwal yang belum selesai pada tanggal ini.</p>
            : (
              <div className="grid sm:grid-cols-2 gap-2">
                {data.jadwal.map(j => (
                  <label key={j.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${pilih.has(j.id) ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                    <input type="checkbox" className="mt-1" checked={pilih.has(j.id)} onChange={() => toggle(j.id)} />
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-800">{j.mapel} — Kelas {j.kelas}</span>
                      <span className="block text-xs text-slate-500">
                        {j.jam_mulai}–{j.jam_selesai}{j.berjalan ? ' · sedang berjalan' : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" disabled={!siapSimpan} onClick={simpan}>
            {saving ? 'Memeriksa & menyimpan…' : 'Simpan ruang'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Saat disimpan, sistem memeriksa guru tidak punya tugas mengawas, ruang khusus lain, atau sesi susulan yang jamnya bertabrakan.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-slate-900">Ruang yang ada</h2>
        {loading ? null : !data?.ruang.length ? (
          <p className="text-sm text-slate-500">Belum ada ruang khusus.</p>
        ) : data.ruang.map(r => (
          <div key={r.id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-900">{r.nama || 'Ruang khusus'}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${WARNA_STATUS[r.status]}`}>{r.status}</span>
                </div>
                <p className="text-sm text-slate-600">Pengawas: {r.nama_pengawas} · {r.jumlah_siswa} siswa diproses</p>
                <p className="text-xs text-slate-500">Kode ruang: <span className="font-mono font-semibold tracking-wider text-slate-700">{r.kode_ruang}</span></p>
              </div>
              {r.status === 'MENUNGGU' && (
                <button className="btn-secondary text-sm" onClick={() => setBatalId(r.id)}>Batalkan</button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.jadwal.map(j => (
                <span key={j.id} className="px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  {j.mapel} · {j.kelas} · {j.tanggal} {j.jam}
                </span>
              ))}
            </div>
            {r.status === 'BERJALAN' && (
              <p className="text-xs text-slate-500">Ruang berjalan ditutup lewat Tutup Paksa sesi, atau oleh pengawas ruangnya.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
