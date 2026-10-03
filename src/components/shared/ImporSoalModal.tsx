'use client'

// ── MODAL "IMPOR SOAL DARI WORD" (PG & Essay) ──────────────────────────────
// Alur guru:
//   1. Unduh template Word (tabel per nomor soal) → isi di Word/WPS/LibreOffice.
//   2. Unggah file .docx → dibaca LOKAL di browser (parser-docx.ts) →
//      pratinjau lengkap dengan gambar + daftar kesalahan per nomor soal.
//   3. Klik Impor → gambar diunggah satu per satu lewat endpoint upload yang
//      sudah ada, lalu semua soal disimpan sekaligus (atomik) lewat
//      /api/guru/soal/impor atau /api/guru/soal-essay/impor.
//
// Tidak ada yang tersimpan ke database sebelum guru menekan tombol Impor.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileDown, FileUp, FileText, AlertTriangle, CheckCircle2, XCircle, ImageOff,
} from 'lucide-react'
import { Modal, Spinner } from '@/components/ui'
import { apiRequest, generateId } from '@/lib/utils'
import { buatTemplateDocx, namaFileTemplate } from '@/lib/impor-soal/template-docx'
import {
  bacaDocxPg, bacaDocxEssay, gambarLangsungDidukung, SEMUA_HURUF, BATAS_SOAL_PER_IMPOR,
  type GambarRef, type HasilBacaPg, type HasilBacaEssay,
} from '@/lib/impor-soal/parser-docx'

const BATAS_UPLOAD_BYTE = 1_900_000 // endpoint upload menolak > 2 MB; sisakan margin
const BATAS_FILE_WORD_MB = 40

export interface ImporSoalHasil {
  jenis: 'pg' | 'essay'
  jumlah: number
  /** PG: id paket (baru dibuat atau yang sudah ada). */
  paketId?: string
  /** PG: jumlah opsi yang dipakai file (4/5). */
  jumlahOpsi?: 4 | 5
}

interface Props {
  open: boolean
  onClose: () => void
  jenis: 'pg' | 'essay'
  namaMapel: string
  namaKelas: string
  /** PG: kosong ('') = paket belum dibuat; akan dibuat saat impor. Essay: wajib id paket. */
  paketId: string
  /** PG saja */
  mapelId?: string
  kelasId?: string
  acak?: 'YA' | 'TIDAK'
  /** PG: jumlah opsi yang WAJIB dipakai (paket sudah berisi soal / dikunci admin). null = bebas. */
  jumlahOpsiPaksa?: 4 | 5 | null
  /** PG: jumlah opsi bawaan untuk template jika tidak dipaksa. */
  jumlahOpsiBawaan?: 4 | 5
  onSelesai: (hasil: ImporSoalHasil) => void
}

type Hasil = HasilBacaPg | HasilBacaEssay

// ───────────── persiapan gambar ─────────────

function ekstensiDariMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

async function kompresKeJpeg(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new window.Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Gambar tidak bisa diproses'))
      i.src = url
    })
    const sisiMaks = Math.max(img.naturalWidth, img.naturalHeight)
    for (const sisi of [1600, 1280, 1024, 800, 600]) {
      const skala = Math.min(1, sisi / sisiMaks)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * skala))
      c.height = Math.max(1, Math.round(img.naturalHeight * skala))
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('Gambar tidak bisa diproses')
      ctx.fillStyle = '#ffffff' // JPEG tidak punya transparansi
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      for (const q of [0.88, 0.75, 0.6]) {
        const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', q))
        if (b && b.size <= BATAS_UPLOAD_BYTE) return b
      }
    }
    throw new Error('Ukuran gambar terlalu besar (lebih dari 2 MB) dan tidak bisa dikecilkan otomatis')
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function siapkanFileGambar(ref: GambarRef, bytes: Uint8Array): Promise<File> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: ref.mime })
  if (gambarLangsungDidukung(ref.mime) && blob.size <= BATAS_UPLOAD_BYTE) {
    return new File([blob], `impor.${ekstensiDariMime(ref.mime)}`, { type: ref.mime })
  }
  // Format yang bisa didekode browser (BMP/TIFF/ dst.) atau terlalu besar → konversi JPEG.
  if (gambarLangsungDidukung(ref.mime) || ref.mime === 'image/bmp' || ref.mime === 'image/tiff') {
    const kecil = await kompresKeJpeg(blob)
    return new File([kecil], 'impor.jpg', { type: 'image/jpeg' })
  }
  throw new Error(
    'Format gambar tidak didukung (EMF/WMF/SVG). Simpan gambar sebagai PNG atau JPG lalu sisipkan ulang di Word'
  )
}

async function unggahGambar(file: File): Promise<string> {
  const token = localStorage.getItem('token')
  const kirim = async () => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/guru/soal/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Upload gambar gagal')
    return data.url as string
  }
  try {
    return await kirim()
  } catch {
    // Satu kali coba ulang (mis. jaringan sempat putus sesaat).
    return await kirim()
  }
}

// ───────────── komponen ─────────────

export function ImporSoalModal(p: Props) {
  const isPg = p.jenis === 'pg'
  const inputRef = useRef<HTMLInputElement>(null)

  const [jumlahTpl, setJumlahTpl] = useState('10')
  const [opsiTpl, setOpsiTpl] = useState<4 | 5>(p.jumlahOpsiPaksa ?? p.jumlahOpsiBawaan ?? 4)
  const [unduhBusy, setUnduhBusy] = useState(false)

  const [namaFile, setNamaFile] = useState('')
  const [membaca, setMembaca] = useState(false)
  const [hasil, setHasil] = useState<Hasil | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [errBaca, setErrBaca] = useState('')

  const [bobotDefault, setBobotDefault] = useState('')
  const [lewati, setLewati] = useState(false)

  const [bekerja, setBekerja] = useState(false)
  const [progres, setProgres] = useState('')
  const [errImpor, setErrImpor] = useState('')
  const idemRef = useRef('')
  const thumbsRef = useRef<string[]>([])

  const bersihkanThumbs = useCallback(() => {
    thumbsRef.current.forEach(u => URL.revokeObjectURL(u))
    thumbsRef.current = []
    setThumbs({})
  }, [])

  const reset = useCallback(() => {
    bersihkanThumbs()
    setNamaFile('')
    setHasil(null)
    setErrBaca('')
    setErrImpor('')
    setProgres('')
    setBobotDefault('')
    setLewati(false)
    idemRef.current = ''
    if (inputRef.current) inputRef.current.value = ''
  }, [bersihkanThumbs])

  // Tutup modal → bersihkan semua state & object URL.
  useEffect(() => {
    if (!p.open) reset()
  }, [p.open, reset])
  useEffect(() => () => { thumbsRef.current.forEach(u => URL.revokeObjectURL(u)) }, [])

  async function unduhTemplate() {
    const n = Math.max(1, Math.min(100, Math.floor(Number(jumlahTpl)) || 10))
    setUnduhBusy(true)
    try {
      const blob = await buatTemplateDocx({ jenis: p.jenis, jumlah: n, jumlahOpsi: opsiTpl })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = namaFileTemplate(p.jenis)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } finally {
      setUnduhBusy(false)
    }
  }

  async function pilihFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    reset()
    setNamaFile(f.name)
    if (!/\.docx$/i.test(f.name)) {
      setErrBaca('Format file harus .docx. Jika file Anda .doc, buka di Word lalu Simpan Sebagai ▸ Word Document (.docx).')
      return
    }
    if (f.size > BATAS_FILE_WORD_MB * 1024 * 1024) {
      setErrBaca(`Ukuran file terlalu besar (maksimal ${BATAS_FILE_WORD_MB} MB).`)
      return
    }
    setMembaca(true)
    try {
      const buf = await f.arrayBuffer()
      const h: Hasil = isPg
        ? await bacaDocxPg(buf, { jumlahOpsiPaksa: p.jumlahOpsiPaksa ?? null })
        : await bacaDocxEssay(buf)
      // Thumbnail untuk pratinjau (hanya format yang bisa ditampilkan browser).
      const refs = new Map<string, GambarRef>()
      for (const s of h.soal) {
        if ('gambarSoal' in s) {
          if (s.gambarSoal) refs.set(s.gambarSoal.path, s.gambarSoal)
          for (const hh of SEMUA_HURUF) { const g = s.opsi[hh].gambar; if (g) refs.set(g.path, g) }
        } else if (s.gambar) refs.set(s.gambar.path, s.gambar)
      }
      const peta: Record<string, string> = {}
      for (const [path, ref] of refs) {
        if (!gambarLangsungDidukung(ref.mime) && ref.mime !== 'image/bmp') continue
        const bytes = await h.ambilBytes(path)
        if (!bytes) continue
        const u = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: ref.mime }))
        thumbsRef.current.push(u)
        peta[path] = u
      }
      setThumbs(peta)
      setHasil(h)
      idemRef.current = generateId('IMPOR')
    } catch (err) {
      setErrBaca(err instanceof Error ? err.message : 'File tidak bisa dibaca')
    } finally {
      setMembaca(false)
    }
  }

  // ── Turunan tampilan ──
  const bobotDefNum = Number(bobotDefault.replace(',', '.'))
  const bobotDefValid = Number.isFinite(bobotDefNum) && bobotDefNum > 0

  const daftarTampil = (hasil?.soal ?? []).map(s => {
    const galat = [...s.galat]
    let bobotEfektif: number | null = null
    if (!isPg) {
      const se = s as HasilBacaEssay['soal'][number]
      bobotEfektif = se.bobot ?? (bobotDefValid ? bobotDefNum : null)
      if (se.bobot === null && !bobotDefValid) galat.push('Bobot belum diisi (isi di Word, atau isi "Bobot bawaan" di atas).')
    }
    return { s, galat, bobotEfektif }
  })
  const jumlahValid = daftarTampil.filter(d => d.galat.length === 0).length
  const jumlahBermasalah = daftarTampil.length - jumlahValid
  const adaBobotKosong = !isPg && ((hasil?.soal ?? []) as HasilBacaEssay['soal']).some(s => s.bobot === null)
  const melebihiBatas = (hasil?.soal.length ?? 0) > BATAS_SOAL_PER_IMPOR
  const bolehImpor =
    !!hasil && !bekerja && !melebihiBatas && jumlahValid > 0 && (jumlahBermasalah === 0 || lewati)
  const totalBobot = !isPg
    ? daftarTampil.filter(d => d.galat.length === 0).reduce((a, d) => a + (d.bobotEfektif ?? 0), 0)
    : 0

  async function jalankanImpor() {
    if (!hasil || !bolehImpor) return
    setBekerja(true)
    setErrImpor('')
    try {
      const layak = daftarTampil.filter(d => d.galat.length === 0)

      // 1) Unggah semua gambar yang dipakai (berurutan; nama file di server
      //    memakai Date.now(), jadi upload paralel bisa bentrok).
      const perlu = new Map<string, GambarRef>()
      for (const { s } of layak) {
        if ('gambarSoal' in s) {
          if (s.gambarSoal) perlu.set(s.gambarSoal.path, s.gambarSoal)
          for (const hh of SEMUA_HURUF.slice(0, (hasil as HasilBacaPg).jumlahOpsi)) {
            const g = s.opsi[hh].gambar
            if (g) perlu.set(g.path, g)
          }
        } else if (s.gambar) perlu.set(s.gambar.path, s.gambar)
      }
      const urlPer = new Map<string, string>()
      let i = 0
      for (const [path, ref] of perlu) {
        i++
        setProgres(`Mengunggah gambar ${i} dari ${perlu.size}…`)
        const bytes = await hasil.ambilBytes(path)
        if (!bytes) throw new Error('Gambar di dalam file tidak bisa dibaca')
        let file: File
        try {
          file = await siapkanFileGambar(ref, bytes)
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : 'Gambar tidak bisa disiapkan')
        }
        urlPer.set(path, await unggahGambar(file))
      }

      // 2) Simpan semua soal sekaligus.
      setProgres(`Menyimpan ${layak.length} soal…`)
      if (hasil.jenis === 'pg') {
        const h = hasil as HasilBacaPg
        const res = await apiRequest<{ paket_id: string; jumlah: number }>('/api/guru/soal/impor', {
          method: 'POST',
          timeoutMs: 90_000,
          body: JSON.stringify({
            mapel_id: p.mapelId,
            kelas_id: p.kelasId,
            paket_id: p.paketId || null,
            acak: p.acak ?? 'YA',
            jumlah_opsi: h.jumlahOpsi,
            soal: layak.map(({ s }) => {
              const sp = s as HasilBacaPg['soal'][number]
              const o: Record<string, unknown> = {
                teks: sp.teks,
                gambar_pertanyaan: sp.gambarSoal ? urlPer.get(sp.gambarSoal.path) ?? null : null,
                kunci: sp.kunci,
                pembahasan: sp.pembahasan || null,
              }
              for (const hh of SEMUA_HURUF) {
                o[`opsi_${hh}`] = sp.opsi[hh].teks
                o[`gambar_opsi_${hh}`] = sp.opsi[hh].gambar ? urlPer.get(sp.opsi[hh].gambar!.path) ?? null : null
              }
              return o
            }),
          }),
        })
        p.onSelesai({ jenis: 'pg', jumlah: res.jumlah, paketId: res.paket_id, jumlahOpsi: h.jumlahOpsi })
      } else {
        const res = await apiRequest<{ jumlah: number }>('/api/guru/soal-essay/impor', {
          method: 'POST',
          timeoutMs: 90_000,
          body: JSON.stringify({
            paket_id: p.paketId,
            idempotency_key: idemRef.current,
            soal: layak.map(({ s, bobotEfektif }) => {
              const se = s as HasilBacaEssay['soal'][number]
              return {
                teks: se.teks,
                gambar_url: se.gambar ? urlPer.get(se.gambar.path) ?? null : null,
                bobot_maks: bobotEfektif,
              }
            }),
          }),
        })
        p.onSelesai({ jenis: 'essay', jumlah: res.jumlah })
      }
      p.onClose()
    } catch (err) {
      setErrImpor(err instanceof Error ? err.message : 'Impor gagal')
    } finally {
      setBekerja(false)
      setProgres('')
    }
  }

  function Thumb({ g, label }: { g: GambarRef | null; label: string }) {
    if (!g) return null
    const u = thumbs[g.path]
    return u ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={u} alt={label} title={label} className="h-14 max-w-[7rem] object-contain rounded border border-slate-200 bg-white" />
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1" title={label}>
        <ImageOff className="w-3.5 h-3.5" /> {label}: format {g.mime.replace('image/', '').replace('x-', '').toUpperCase()}
      </span>
    )
  }

  const namaJenis = isPg ? 'Pilihan Ganda' : 'Essay'

  return (
    <Modal
      open={p.open}
      onClose={() => { if (!bekerja) p.onClose() }}
      title={`Impor Soal ${namaJenis} dari Word`}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={p.onClose} disabled={bekerja}>Batal</button>
          <button className="btn-primary" onClick={jalankanImpor} disabled={!bolehImpor}>
            {bekerja ? <><Spinner size="sm" /> {progres || 'Memproses…'}</> : <><FileUp className="w-4 h-4" /> Impor {jumlahValid > 0 ? `${jumlahValid} Soal` : 'Soal'}</>}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          {p.namaMapel} · Kelas {p.namaKelas}
          {isPg && !p.paketId ? ' · paket baru akan dibuat saat impor' : ''}
        </p>

        {/* ── Langkah 1: template ── */}
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center">1</span>
            Unduh template Word
          </div>
          <p className="text-sm text-slate-600">
            Template berisi satu tabel untuk setiap nomor soal, jadi soal, opsi, kunci, dan gambarnya tetap utuh.
            Gambar (pada soal, opsi jawaban{isPg ? '' : ', maupun soal essay'}) cukup disisipkan lewat <b>Sisipkan ▸ Gambar</b> di dalam sel yang sesuai.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Jumlah tabel soal</label>
              <input type="number" min={1} max={100} className="input w-28" value={jumlahTpl} onChange={e => setJumlahTpl(e.target.value)} />
            </div>
            {isPg && (
              <div>
                <label className="label">Jumlah opsi</label>
                <select className="input w-32" value={opsiTpl} disabled={!!p.jumlahOpsiPaksa}
                  onChange={e => setOpsiTpl(Number(e.target.value) === 5 ? 5 : 4)}>
                  <option value={4}>4 (A–D)</option>
                  <option value={5}>5 (A–E)</option>
                </select>
              </div>
            )}
            <button className="btn-secondary" onClick={unduhTemplate} disabled={unduhBusy}>
              {unduhBusy ? <Spinner size="sm" /> : <FileDown className="w-4 h-4" />} Unduh Template (.docx)
            </button>
          </div>
          {isPg && p.jumlahOpsiPaksa && (
            <p className="text-xs text-slate-500">Paket ini memakai {p.jumlahOpsiPaksa} opsi jawaban, jadi file yang diimpor harus memakai {p.jumlahOpsiPaksa} opsi juga.</p>
          )}
        </div>

        {/* ── Langkah 2: unggah ── */}
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center">2</span>
            Unggah file yang sudah diisi
          </div>
          <input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden" onChange={pilihFile} />
          <div className="flex items-center gap-3 flex-wrap">
            <button className="btn-secondary" onClick={() => inputRef.current?.click()} disabled={membaca || bekerja}>
              <FileText className="w-4 h-4" /> {namaFile ? 'Ganti File' : 'Pilih File .docx'}
            </button>
            {namaFile && <span className="text-sm text-slate-600 truncate max-w-xs">{namaFile}</span>}
            {membaca && <Spinner size="sm" />}
          </div>
          {errBaca && (
            <div className="alert-error text-sm flex items-start gap-2">
              <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{errBaca}</span>
            </div>
          )}
        </div>

        {/* ── Pratinjau ── */}
        {hasil && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              <span className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center">3</span>
              Periksa hasil baca
            </div>

            <div className="text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span><b className="text-emerald-700">{jumlahValid}</b> soal siap diimpor</span>
              {jumlahBermasalah > 0 && <span><b className="text-red-600">{jumlahBermasalah}</b> soal bermasalah</span>}
              {isPg && <span>Opsi jawaban: {(hasil as HasilBacaPg).jumlahOpsi}</span>}
              {!isPg && jumlahValid > 0 && <span>Total bobot: {totalBobot}</span>}
              {hasil.ringkasan.tabelContoh > 0 && <span>{hasil.ringkasan.tabelContoh} tabel contoh dilewati</span>}
              {hasil.ringkasan.tabelKosong > 0 && <span>{hasil.ringkasan.tabelKosong} tabel kosong dilewati</span>}
              {hasil.ringkasan.tabelTidakDikenali > 0 && <span>{hasil.ringkasan.tabelTidakDikenali} tabel lain diabaikan</span>}
            </div>

            {hasil.peringatanUmum.length > 0 && (
              <div className="alert-warning text-sm space-y-1">
                {[...new Set(hasil.peringatanUmum)].map((w, i) => (
                  <div key={i} className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{w}</span></div>
                ))}
              </div>
            )}

            {hasil.soal.length === 0 && (
              <div className="alert-warning text-sm">
                Tidak ada soal terisi yang ditemukan. Pastikan soal diisi di dalam tabel template (jangan mengubah label di kolom kiri) dan bukan di tabel &ldquo;Contoh&rdquo;.
              </div>
            )}

            {adaBobotKosong && (
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <label className="label mb-0">Bobot bawaan untuk soal yang bobotnya kosong:</label>
                <input className="input w-24" inputMode="decimal" placeholder="mis. 10" value={bobotDefault}
                  onChange={e => setBobotDefault(e.target.value)} />
              </div>
            )}

            <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1">
              {daftarTampil.map(({ s, galat, bobotEfektif }) => {
                const pg = 'gambarSoal' in s ? (s as HasilBacaPg['soal'][number]) : null
                const es = !pg ? (s as HasilBacaEssay['soal'][number]) : null
                const ok = galat.length === 0
                return (
                  <div key={s.urutan} className={`rounded-lg border px-3 py-2 text-sm ${ok ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50/60'}`}>
                    <div className="flex items-start gap-2">
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {s.urutan}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-slate-800 whitespace-pre-line line-clamp-3">{s.teks || <i className="text-slate-400">(soal berupa gambar)</i>}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {pg && <Thumb g={pg.gambarSoal} label="Gambar soal" />}
                          {es && <Thumb g={es.gambar} label="Gambar soal" />}
                        </div>
                        {pg && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
                            {SEMUA_HURUF.slice(0, (hasil as HasilBacaPg).jumlahOpsi).map(h => (
                              <div key={h} className={`flex items-center gap-1.5 ${pg.kunci === h.toUpperCase() ? 'text-emerald-700 font-semibold' : ''}`}>
                                <span className="font-semibold">{h.toUpperCase()}.</span>
                                <span className="truncate">{pg.opsi[h].teks || (pg.opsi[h].gambar ? '' : '—')}</span>
                                <Thumb g={pg.opsi[h].gambar} label={`Opsi ${h.toUpperCase()}`} />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-xs text-slate-500">
                          {pg && <>Kunci: <b>{pg.kunci || '—'}</b></>}
                          {es && <>Bobot: <b>{bobotEfektif ?? '—'}</b></>}
                          {s.nomorDokumen && <> · No. di dokumen: {s.nomorDokumen}</>}
                        </div>
                        {galat.map((g, i) => (
                          <div key={`g${i}`} className="text-xs text-red-700 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {g}</div>
                        ))}
                        {s.peringatan.map((w, i) => (
                          <div key={`w${i}`} className="text-xs text-amber-700 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {w}</div>
                        ))}
                      </div>
                      {ok && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-1" />}
                    </div>
                  </div>
                )
              })}
            </div>

            {jumlahBermasalah > 0 && (
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={lewati} onChange={e => setLewati(e.target.checked)} />
                <span>
                  Lewati {jumlahBermasalah} soal yang bermasalah dan impor yang sudah benar saja.
                  <span className="block text-xs text-slate-500">
                    Jika tidak dicentang, perbaiki dulu file Word-nya lalu unggah ulang.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        {errImpor && (
          <div className="alert-error text-sm flex items-start gap-2">
            <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{errImpor} Jika koneksi sempat terputus, periksa dulu daftar soal paket sebelum mencoba lagi agar tidak ada soal ganda.</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
