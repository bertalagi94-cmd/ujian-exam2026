'use client'

// Tab "Reset Password Siswa" di menu Admin Kelas (guru).
//
// Permintaan paling sering saat hari ujian: siswa lupa password. Dulu hanya
// Super Admin yang bisa. Batasan (ditegakkan di SERVER, bukan hanya di sini):
//   - hanya siswa di kelas yang Anda pegang (bukan akun tester);
//   - password kembali ke NISN, sama seperti reset oleh Super Admin;
//   - setiap reset tercatat di log aktivitas atas nama Anda.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { Confirm, EmptyState, Pagination, SearchInput, Spinner, StatusBadge, Toast } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import type { ResponSiswaAdminKelas, SiswaAdminKelas } from '@/lib/admin-kelas-shared'

const PER_HALAMAN = 25

export function ResetPasswordTab() {
  const [respon, setRespon] = useState<ResponSiswaAdminKelas | null>(null)
  const [loading, setLoading] = useState(true)
  const [galat, setGalat] = useState<string | null>(null)
  const [filterKelas, setFilterKelas] = useState('SEMUA')
  const [cari, setCari] = useState('')
  const [halaman, setHalaman] = useState(1)
  const [target, setTarget] = useState<SiswaAdminKelas | null>(null)
  const [memproses, setMemproses] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const muat = useCallback(async () => {
    setLoading(true)
    setGalat(null)
    try {
      setRespon(await apiRequest<ResponSiswaAdminKelas>('/api/guru/admin-kelas/siswa', { timeoutMs: 20_000 }))
    } catch (e) {
      setGalat(e instanceof Error ? e.message : 'Gagal memuat daftar siswa')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { muat() }, [muat])
  useEffect(() => { setHalaman(1) }, [filterKelas, cari])

  const namaKelasUnik = useMemo(
    () => [...new Set((respon?.data ?? []).map(s => s.kelas))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
    [respon]
  )

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase()
    return (respon?.data ?? []).filter(s => {
      if (filterKelas !== 'SEMUA' && s.kelas !== filterKelas) return false
      return !q || s.nama.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q)
    })
  }, [respon, filterKelas, cari])

  const totalHalaman = Math.max(1, Math.ceil(tersaring.length / PER_HALAMAN))
  const tampil = tersaring.slice((halaman - 1) * PER_HALAMAN, halaman * PER_HALAMAN)

  async function jalankanReset() {
    if (!target) return
    setMemproses(true)
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/guru/admin-kelas/siswa/${encodeURIComponent(target.nis)}/reset-password`,
        { method: 'POST' }
      )
      setToast({ msg: res.message, type: 'success' })
      setTarget(null)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal mereset password', type: 'error' })
    } finally {
      setMemproses(false)
    }
  }

  if (loading && !respon) return <div className="flex justify-center py-16"><Spinner /></div>
  if (galat && !respon) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-600">{galat}</p>
        <button onClick={muat} className="btn-secondary btn-sm mx-auto"><RefreshCw className="w-4 h-4" /> Coba lagi</button>
      </div>
    )
  }
  if (!respon) return null

  return (
    <div className="space-y-5">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          Reset mengembalikan password siswa ke <b>NISN</b>-nya. Anda hanya bisa mereset siswa di kelas yang Anda pegang,
          dan setiap reset tercatat atas nama Anda. Pastikan yang meminta benar-benar siswa yang bersangkutan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {namaKelasUnik.length > 1 && (
          <select className="input w-auto" value={filterKelas} onChange={e => setFilterKelas(e.target.value)} aria-label="Filter kelas">
            <option value="SEMUA">Semua kelas ({namaKelasUnik.length})</option>
            {namaKelasUnik.map(k => <option key={k} value={k}>Kelas {k}</option>)}
          </select>
        )}
        <SearchInput value={cari} onChange={setCari} placeholder="Cari nama atau NISN..." className="flex-1 min-w-[200px] max-w-sm" />
        <span className="text-xs text-slate-500 ml-auto">{tersaring.length} siswa</span>
        <button onClick={muat} disabled={loading} className="btn-secondary btn-sm" title="Muat ulang data">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
      </div>

      {tersaring.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Users}
            title={respon.data.length === 0 ? 'Belum ada siswa di kelas Anda' : 'Tidak ada siswa yang cocok'}
            description={respon.data.length === 0 ? 'Siswa muncul di sini setelah didaftarkan Super Admin ke kelas Anda.' : 'Ubah filter atau kata pencarian.'}
          />
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="table-wrapper rounded-none border-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>NISN</th>
                    <th>Nama</th>
                    <th>Kelas</th>
                    <th>Status</th>
                    <th>Login terakhir</th>
                    <th className="text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {tampil.map(s => (
                    <tr key={s.nis}>
                      <td className="font-mono text-xs">{s.nis}</td>
                      <td className="font-medium text-slate-800">{s.nama}</td>
                      <td>{s.kelas}</td>
                      <td><StatusBadge status={s.status ?? 'AKTIF'} /></td>
                      <td className="text-xs text-slate-500">{s.last_login ? formatDateTime(s.last_login) : 'Belum pernah'}</td>
                      <td className="text-right">
                        <button onClick={() => setTarget(s)} className="btn-secondary btn-sm">
                          <KeyRound className="w-4 h-4" /> Reset
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {totalHalaman > 1 && (
            <Pagination page={halaman} totalPages={totalHalaman} onPage={setHalaman} total={tersaring.length} perPage={PER_HALAMAN} />
          )}
        </>
      )}

      <Confirm
        open={!!target}
        onClose={() => !memproses && setTarget(null)}
        onConfirm={jalankanReset}
        title="Reset password siswa"
        message={target
          ? `Reset password ${target.nama} (NISN ${target.nis}, kelas ${target.kelas}) ke NISN? Siswa lalu masuk memakai NISN sebagai password. Tindakan ini dicatat atas nama Anda.`
          : ''}
        confirmLabel="Ya, reset password"
        variant="primary"
        loading={memproses}
      />
    </div>
  )
}
