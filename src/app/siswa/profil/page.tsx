'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  User, CreditCard, GraduationCap, Cake, MapPin, Calendar,
  Clock, KeyRound, Eye, EyeOff, ShieldCheck,
} from 'lucide-react'
import { PageLoader, Toast } from '@/components/ui'
import { apiRequest, formatDate, formatDateTime } from '@/lib/utils'

// FITUR (Halaman profil + ganti password sendiri): sebelumnya siswa tidak
// punya halaman untuk melihat biodatanya sendiri secara lengkap, dan hanya
// admin yang bisa mengganti password akun siswa (selalu direset ke NIS).
// Dua fitur ini digabung dalam satu halaman karena sama-sama berhubungan
// dengan "akun saya" dan supaya tidak menambah menu sidebar berlebihan.

interface Profil {
  nis: string
  nama: string
  kelas: string
  jurusan: string | null
  wali_kelas: string | null
  status: string
  tempat_lahir: string | null
  tanggal_lahir: string | null
  jenis_kelamin: string | null
  last_login: string | null
  terdaftar_sejak: string | null
}

function BiodataRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="text-sm font-medium text-slate-800 break-words">{value ?? '-'}</div>
      </div>
    </div>
  )
}

export default function SiswaProfilPage() {
  const [profil, setProfil] = useState<Profil | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  // ── Form ganti password ──────────────────────────────────────────────
  const [passwordLama, setPasswordLama] = useState('')
  const [passwordBaru, setPasswordBaru] = useState('')
  const [konfirmasiBaru, setKonfirmasiBaru] = useState('')
  const [showLama, setShowLama] = useState(false)
  const [showBaru, setShowBaru] = useState(false)
  const [menyimpan, setMenyimpan] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ profil: Profil }>('/api/siswa/profil')
      setProfil(res.profil)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat profil', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submitGantiPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordLama || !passwordBaru || !konfirmasiBaru) {
      showToast('Semua kolom wajib diisi', 'error')
      return
    }
    if (passwordBaru.length < 6) {
      showToast('Password baru minimal 6 karakter', 'error')
      return
    }
    if (passwordBaru !== konfirmasiBaru) {
      showToast('Konfirmasi password baru tidak cocok', 'error')
      return
    }

    setMenyimpan(true)
    try {
      await apiRequest('/api/siswa/ganti-password', {
        method: 'PUT',
        body: JSON.stringify({ passwordLama, passwordBaru }),
      })
      showToast('Password berhasil diganti')
      setPasswordLama('')
      setPasswordBaru('')
      setKonfirmasiBaru('')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengganti password', 'error')
    } finally {
      setMenyimpan(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="page-title">Profil Saya</h1>
        <p className="page-subtitle">Biodata akun dan pengaturan keamanan</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Kartu biodata */}
        <div className="card">
          <div className="flex items-center gap-4 pb-5 mb-1 border-b border-slate-100">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
              {profil?.nama?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 text-lg truncate">{profil?.nama}</div>
              <div className="text-sm text-slate-500">NIS {profil?.nis} &middot; Kelas {profil?.kelas}</div>
              <span className={`badge mt-1 ${profil?.status === 'AKTIF' ? 'badge-green' : 'badge-red'}`}>
                {profil?.status === 'AKTIF' ? 'Akun Aktif' : profil?.status}
              </span>
            </div>
          </div>

          <div className="mt-2">
            <BiodataRow icon={CreditCard} label="NIS" value={profil?.nis} />
            <BiodataRow icon={User} label="Nama Lengkap" value={profil?.nama} />
            <BiodataRow
              icon={GraduationCap}
              label="Kelas"
              value={profil?.jurusan && profil.jurusan !== '-' ? `${profil.kelas} (${profil.jurusan})` : profil?.kelas}
            />
            {profil?.wali_kelas && <BiodataRow icon={User} label="Wali Kelas" value={profil.wali_kelas} />}
            <BiodataRow
              icon={MapPin}
              label="Tempat, Tanggal Lahir"
              value={
                profil?.tempat_lahir || profil?.tanggal_lahir
                  ? `${profil?.tempat_lahir ?? '-'}, ${formatDate(profil?.tanggal_lahir)}`
                  : null
              }
            />
            <BiodataRow
              icon={Cake}
              label="Jenis Kelamin"
              value={profil?.jenis_kelamin === 'L' ? 'Laki-laki' : profil?.jenis_kelamin === 'P' ? 'Perempuan' : profil?.jenis_kelamin}
            />
            <BiodataRow icon={Clock} label="Login Terakhir" value={formatDateTime(profil?.last_login)} />
            <BiodataRow icon={Calendar} label="Terdaftar Sejak" value={formatDate(profil?.terdaftar_sejak)} />
          </div>

          <p className="text-xs text-slate-400 mt-4">
            Data di atas berasal dari data induk sekolah. Jika ada yang salah, hubungi wali kelas atau admin sekolah untuk diperbaiki.
          </p>
        </div>

        {/* Kartu ganti password */}
        <div className="card h-fit">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Ganti Password</div>
              <p className="text-xs text-slate-500">Gunakan password baru yang mudah kamu ingat, jangan bagikan ke siapa pun.</p>
            </div>
          </div>

          <form onSubmit={submitGantiPassword} className="space-y-4">
            <div>
              <label className="label">Password Lama</label>
              <div className="relative">
                <input
                  type={showLama ? 'text' : 'password'}
                  className="input pr-10"
                  value={passwordLama}
                  onChange={e => setPasswordLama(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Masukkan password saat ini"
                />
                <button type="button" onClick={() => setShowLama(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showLama ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="label">Password Baru</label>
              <div className="relative">
                <input
                  type={showBaru ? 'text' : 'password'}
                  className="input pr-10"
                  value={passwordBaru}
                  onChange={e => setPasswordBaru(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Minimal 6 karakter"
                />
                <button type="button" onClick={() => setShowBaru(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showBaru ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="label">Konfirmasi Password Baru</label>
              <input
                type={showBaru ? 'text' : 'password'}
                className="input"
                value={konfirmasiBaru}
                onChange={e => setKonfirmasiBaru(e.target.value)}
                autoComplete="new-password"
                placeholder="Ulangi password baru"
              />
            </div>

            <button type="submit" disabled={menyimpan} className="btn-primary w-full justify-center disabled:opacity-70">
              <ShieldCheck className="w-4 h-4" />
              {menyimpan ? 'Menyimpan...' : 'Simpan Password Baru'}
            </button>
          </form>
        </div>
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
