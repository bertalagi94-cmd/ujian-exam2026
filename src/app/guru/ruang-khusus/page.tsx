'use client'

// Guru → Pengawas Ruang Khusus.
// Alur: (1) cari & centang siswa, (2) tekan "Proses" — siswa yang tidak relevan
// diabaikan dengan alasan, (3) tekan "Mulai sesi", (4) pantau di Mode Pengawas
// (tampilannya sama dengan pengawas biasa: pelanggaran, status login, R1–R3).
// Satu kode ruang dipakai semua siswa lab; sistem mengarahkan tiap siswa ke
// sesi yang sesuai kelas dan mapelnya.
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Spinner, Toast, SearchInput } from '@/components/ui'
import { apiRequest } from '@/lib/utils'

interface RuangRingkas { id: string; nama: string | null; status: string }
interface Detail {
  ruang: { id: string; nama: string | null; status: 'MENUNGGU' | 'BERJALAN'; kode_ruang: string }
  essay: { jumlahSesi: number; jumlahDibuka: number; kodeDarurat: string | null }
  jadwal: { id: string; tanggal: string; jam: string; mapel: string; kelas: string; sesi_status: string | null }[]
  diproses: { nis: string; nama: string; kelas: string; jadwal_id: string; mapel: string; status: string }[]
  kandidat: { nis: string; nama: string; kelas: string; ditempatkan: boolean; ruang_lain: boolean; kelas_ada_jadwal: boolean }[]
  kelas: string[]
}
interface HasilProses { nis: string; nama: string; status: 'DIPROSES' | 'DIABAIKAN'; alasan?: string; mapel?: string[] }

const LABEL_STATUS: Record<string, { teks: string; kelas: string }> = {
  BELUM_MASUK: { teks: 'Belum masuk', kelas: 'bg-orange-50 text-orange-600' },
  AKTIF: { teks: '● Ujian', kelas: 'bg-emerald-100 text-emerald-700' },
  RESET: { teks: '⏳ Tunggu kode', kelas: 'bg-amber-100 text-amber-700' },
  SELESAI: { teks: '✓ Selesai', kelas: 'bg-blue-100 text-blue-700' },
  TERKUNCI: { teks: '🔒 Terkunci', kelas: 'bg-red-100 text-red-700' },
}

export default function PengawasRuangKhususPage() {
  const [daftar, setDaftar] = useState<RuangRingkas[] | null>(null)
  const [ruangId, setRuangId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [cari, setCari] = useState('')
  const [kelas, setKelas] = useState('')
  const [pilih, setPilih] = useState<Set<string>>(new Set())
  const [bekerja, setBekerja] = useState<null | 'proses' | 'mulai' | string>(null)
  const [hasil, setHasil] = useState<HasilProses[] | null>(null)
  const [lihatKodeDarurat, setLihatKodeDarurat] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  const muatDaftar = useCallback(async () => {
    try {
      const r = await apiRequest<{ ruang: RuangRingkas[] }>('/api/guru/ruang-khusus')
      setDaftar(r.ruang)
      setRuangId(cur => cur && r.ruang.some(x => x.id === cur) ? cur : (r.ruang[0]?.id ?? null))
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal memuat', type: 'error' })
      setDaftar([])
    }
  }, [])
  useEffect(() => { muatDaftar() }, [muatDaftar])

  const muatDetail = useCallback(async () => {
    if (!ruangId) { setDetail(null); setLoading(false); return }
    setLoading(true)
    try {
      const qs = new URLSearchParams({ ruang: ruangId })
      if (cari.trim()) qs.set('q', cari.trim())
      if (kelas) qs.set('kelas', kelas)
      setDetail(await apiRequest<Detail>(`/api/guru/ruang-khusus?${qs.toString()}`))
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal memuat ruang', type: 'error' })
    } finally { setLoading(false) }
  }, [ruangId, cari, kelas])

  // Pencarian ditunda sebentar supaya tidak menembak API tiap ketukan.
  useEffect(() => {
    const t = setTimeout(muatDetail, cari ? 350 : 0)
    return () => clearTimeout(t)
  }, [muatDetail, cari])

  function toggle(nis: string) {
    setPilih(p => { const n = new Set(p); n.has(nis) ? n.delete(nis) : n.add(nis); return n })
  }

  async function aksi<T>(nama: 'proses' | 'mulai' | 'lepas' | 'essay', extra: Record<string, unknown> = {}) {
    if (!ruangId) return null
    setBekerja(nama === 'lepas' ? String(extra.nis) : nama)
    try {
      return await apiRequest<T>('/api/guru/ruang-khusus', {
        method: 'POST', body: JSON.stringify({ aksi: nama, ruangId, ...extra }),
      })
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal', type: 'error' })
      return null
    } finally { setBekerja(null) }
  }

  async function proses() {
    const r = await aksi<{ message: string; hasil: HasilProses[]; peringatan?: string[] }>('proses', { nis: [...pilih] })
    if (!r) return
    setHasil(r.hasil)
    setPilih(new Set())
    setToast({ msg: r.peringatan?.length ? `${r.message} ${r.peringatan[0]}` : r.message, type: r.peringatan?.length ? 'info' : 'success' })
    await muatDetail()
  }

  async function mulai() {
    const r = await aksi<{ message: string; gagal?: { alasan: string }[] }>('mulai')
    if (!r) return
    setToast({ msg: r.gagal?.length ? `${r.message} ${r.gagal[0].alasan}` : r.message, type: r.gagal?.length ? 'info' : 'success' })
    await muatDetail(); await muatDaftar()
  }

  async function ubahEssay(buka: boolean) {
    const r = await aksi<{ message: string; dilewati?: { label: string; alasan: string }[] }>('essay', { buka })
    if (!r) return
    const lewat = r.dilewati?.filter(d => d.alasan !== 'tidak punya essay')
    setToast({
      msg: lewat?.length ? `${r.message} Dilewati: ${lewat.map(d => `${d.label} — ${d.alasan}`).join('; ')}` : r.message,
      type: lewat?.length ? 'info' : 'success',
    })
    await muatDetail()
  }

  async function lepas(nis: string) {
    const r = await aksi<{ message: string }>('lepas', { nis })
    if (r) { setToast({ msg: r.message, type: 'success' }); await muatDetail() }
  }

  if (daftar === null) return <div className="flex justify-center py-16"><Spinner /></div>

  if (daftar.length === 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="page-title">Pengawas Ruang Khusus</h1>
        <div className="card p-6 text-sm text-slate-600">Anda belum ditugaskan sebagai pengawas ruang khusus oleh admin.</div>
      </div>
    )
  }

  const berjalan = detail?.ruang.status === 'BERJALAN'
  const adaDiproses = (detail?.diproses.length ?? 0) > 0
  const nisDiproses = new Set(detail?.diproses.map(d => d.nis) ?? [])

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Pengawas Ruang Khusus</h1>
          <p className="page-subtitle">Centang siswa yang ujian di ruang Anda, tekan Proses, lalu Mulai sesi.</p>
        </div>
        <button className="btn-secondary text-sm" onClick={() => { muatDaftar(); muatDetail() }}>Refresh</button>
      </div>

      {daftar.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {daftar.map(r => (
            <button key={r.id} onClick={() => { setRuangId(r.id); setPilih(new Set()); setHasil(null) }}
              className={r.id === ruangId ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
              {r.nama || 'Ruang khusus'}
            </button>
          ))}
        </div>
      )}

      {detail && (
        <>
          <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-slate-500">Kode ruang (sebutkan ke semua siswa di lab)</p>
              <p className="font-mono text-3xl font-bold tracking-[0.25em] text-slate-900">{detail.ruang.kode_ruang}</p>
              <p className="text-xs text-slate-500 mt-1">
                {berjalan ? 'Sesi berjalan.' : 'Siswa baru bisa masuk setelah Anda menekan Mulai sesi.'}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {berjalan && (
                <Link href="/guru/jadwal-pengawasan?tab=mode" className="btn-primary text-sm">Buka pemantauan</Link>
              )}
              {!berjalan && (
                <button className="btn-primary" disabled={!adaDiproses || bekerja === 'mulai'} onClick={mulai}>
                  {bekerja === 'mulai' ? 'Membuka sesi…' : 'Mulai sesi'}
                </button>
              )}
            </div>
          </div>

          {berjalan && detail.essay.jumlahSesi > 0 && (
            <div className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-slate-900 text-sm">Essay untuk seluruh ruang</p>
                  <p className="text-xs text-slate-500">
                    Mulai Essay dibuka di {detail.essay.jumlahDibuka} dari {detail.essay.jumlahSesi} sesi yang punya essay.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary text-sm" disabled={bekerja === 'essay'} onClick={() => ubahEssay(true)}>Buka Mulai Essay</button>
                  <button className="btn-secondary text-sm" disabled={bekerja === 'essay'} onClick={() => ubahEssay(false)}>Tutup</button>
                </div>
              </div>
              {detail.essay.kodeDarurat && (
                <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Kode darurat essay (satu kode untuk semua sesi di ruang ini)</p>
                    <p className="text-xs text-slate-400">Hanya dibacakan bila perangkat siswa offline dan essay tidak bisa dibuka.</p>
                  </div>
                  <button className="font-mono text-lg font-bold tracking-[0.2em] text-slate-800" onClick={() => setLihatKodeDarurat(v => !v)}>
                    {lihatKodeDarurat ? detail.essay.kodeDarurat : '••••••  (ketuk)'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card p-4 space-y-2">
            <p className="font-semibold text-slate-900 text-sm">Jadwal di ruang ini</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.jadwal.map(j => (
                <span key={j.id} className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  {j.mapel} · Kelas {j.kelas} · {j.tanggal} {j.jam}
                  {j.sesi_status === 'BERJALAN' ? ' · berjalan' : j.sesi_status === 'SELESAI' ? ' · selesai' : ''}
                </span>
              ))}
            </div>
          </div>

          {hasil && (
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900 text-sm">Hasil Proses terakhir</p>
                <button className="text-xs text-slate-500 underline" onClick={() => setHasil(null)}>Tutup</button>
              </div>
              <ul className="divide-y divide-slate-100 text-sm">
                {hasil.map(h => (
                  <li key={h.nis} className="py-1.5 flex items-start gap-2">
                    <span className={h.status === 'DIPROSES' ? 'text-emerald-600' : 'text-red-500'}>{h.status === 'DIPROSES' ? '✓' : '✗'}</span>
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800">{h.nama}</span>
                      <span className="block text-xs text-slate-500">
                        {h.status === 'DIPROSES' ? `Diproses: ${(h.mapel ?? []).join(', ')}` : `Diabaikan — ${h.alasan}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ── Pilih siswa ── */}
            <div className="card p-4 space-y-3">
              <p className="font-semibold text-slate-900 text-sm">Pilih siswa</p>
              <div className="flex gap-2 flex-wrap">
                <SearchInput value={cari} onChange={setCari} placeholder="Cari nama atau NISN…" className="flex-1 min-w-[10rem]" />
                <select className="select w-auto" value={kelas} onChange={e => setKelas(e.target.value)}>
                  <option value="">Semua kelas</option>
                  {detail.kelas.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="max-h-[26rem] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {loading ? <div className="flex justify-center py-6"><Spinner /></div>
                  : detail.kandidat.length === 0 ? <p className="text-sm text-slate-500 p-3">Tidak ada siswa yang cocok.</p>
                  : detail.kandidat.map(s => {
                    const sudah = nisDiproses.has(s.nis)
                    return (
                      <label key={s.nis} className={`flex items-center gap-2 px-3 py-2 text-sm ${sudah ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                        <input type="checkbox" disabled={sudah} checked={pilih.has(s.nis)} onChange={() => toggle(s.nis)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-slate-800">{s.nama}</span>
                          <span className="block text-xs text-slate-500">Kelas {s.kelas} · {s.nis}</span>
                        </span>
                        {sudah && <span className="text-xs text-emerald-600">diproses</span>}
                        {!sudah && s.ruang_lain && <span className="text-xs text-amber-600">ruang lain</span>}
                        {!sudah && !s.ruang_lain && !s.kelas_ada_jadwal && <span className="text-xs text-slate-400">tak ada mapel</span>}
                      </label>
                    )
                  })}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{pilih.size} dicentang</span>
                <button className="btn-primary" disabled={pilih.size === 0 || bekerja === 'proses'} onClick={proses}>
                  {bekerja === 'proses' ? 'Memproses…' : `Proses (${pilih.size})`}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Siswa yang sudah/sedang ujian, beda agama dengan mapelnya, atau kelasnya tidak punya mapel pada ruang ini akan diabaikan otomatis.
              </p>
            </div>

            {/* ── Siswa diproses ── */}
            <div className="card p-4 space-y-3">
              <p className="font-semibold text-slate-900 text-sm">Siswa di ruang ini ({detail.diproses.length})</p>
              {detail.diproses.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada siswa yang diproses.</p>
              ) : (
                <div className="max-h-[26rem] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {detail.diproses.map(d => {
                    const st = LABEL_STATUS[d.status] ?? LABEL_STATUS.BELUM_MASUK
                    return (
                      <div key={`${d.nis}|${d.jadwal_id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-slate-800">{d.nama}</span>
                          <span className="block text-xs text-slate-500">Kelas {d.kelas} · {d.mapel}</span>
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.kelas}`}>{st.teks}</span>
                        {d.status === 'BELUM_MASUK' && (
                          <button className="text-xs text-red-600 underline disabled:opacity-50" disabled={bekerja === d.nis} onClick={() => lepas(d.nis)}>
                            Lepas
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-slate-500">
                &quot;Lepas&quot; mengembalikan siswa ke sesi kelasnya, hanya selama ia belum pernah masuk ujian di ruang ini.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
