'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, CheckCircle2, XCircle, PenSquare, ImageIcon, Lock } from 'lucide-react'
import { PageLoader, EmptyState, Badge } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor, hitungGrade } from '@/lib/utils'

interface RincianSoal {
  no: number
  teks: string
  jumlah_opsi: number
  opsi_a?: string; opsi_b?: string; opsi_c?: string; opsi_d?: string; opsi_e?: string
  gambar_pertanyaan?: string | null
  gambar_opsi_a?: string | null; gambar_opsi_b?: string | null; gambar_opsi_c?: string | null
  gambar_opsi_d?: string | null; gambar_opsi_e?: string | null
  // FASE 5 FIX (audit lanjutan): soal yang tidak dijawab sekarang tetap
  // dikirim server (bukan dihilangkan dari daftar) — `dijawab: false`.
  dijawab: boolean
  benar: boolean
}

interface NilaiDetail {
  id: string; nama_mapel: string; nilai: number; grade: string
  benar: number; total: number; lulus: boolean; kkm: number; timestamp: string
  // FIX (bug nilai essay tidak tampil di siswa): field gabungan PG+essay,
  // null selama guru belum merilis (lihat masking di API).
  nilai_essay?: number | null
  nilai_total?: number | null
  essay_belum_dirilis?: boolean
  // BUG FIX (nilai remedial tidak masuk ke akun siswa): dihitung server-side
  // (lihat /api/siswa/nilai/[id]/route.ts) — nilai_final/grade_final/
  // lulus_final sudah mengutamakan nilai_edit (remedial) kalau guru
  // pernah menginputnya lewat tab Rekap Nilai.
  nilai_edit?: number | null
  catatan_guru?: string | null
  ada_remedial?: boolean
  nilai_final?: number
  grade_final?: string
  lulus_final?: boolean
  // P0 (audit brief "nilai 0 tapi rincian ada jawaban benar"): true kalau
  // status ujian siswa TERKUNCI karena pelanggaran (sumber kebenaran dari
  // server, lihat /api/siswa/nilai/[id]/route.ts) — dipakai untuk
  // menampilkan banner penjelasan sebelum rincian soal.
  dihentikan_pelanggaran?: boolean
}

// FITUR (Rincian jawaban essay per soal): ditampilkan hanya kalau guru sudah
// merilis nilai essay (lihat masking di API — rincianEssay null selama belum
// dirilis).
interface RincianEssaySoal {
  no: number
  teks: string
  gambar_url: string | null
  bobot_maks: number
  jawaban_teks: string | null
  skor: number | null
}

const LABELS = ['A', 'B', 'C', 'D', 'E'] as const

export default function RincianNilaiPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [nilai, setNilai] = useState<NilaiDetail | null>(null)
  // FASE 3 FIX (audit lanjutan): `rincian` sekarang bisa null — server
  // sengaja tidak mengirim rincian jawaban/kebenaran selama sesi ujian
  // masih BERJALAN (lihat komentar di /api/siswa/nilai/[id]/route.ts),
  // supaya siswa yang sudah submit duluan tidak bisa dipakai untuk
  // membocorkan kunci jawaban ke teman yang masih mengerjakan.
  const [rincian, setRincian] = useState<RincianSoal[] | null>(null)
  const [rincianBelumTersedia, setRincianBelumTersedia] = useState(false)
  const [rincianEssay, setRincianEssay] = useState<RincianEssaySoal[] | null>(null)
  const [essayFotoUrl, setEssayFotoUrl] = useState<string | null>(null)
  const [essayModeJawaban, setEssayModeJawaban] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{
        nilai: NilaiDetail; rincian: RincianSoal[] | null
        rincian_belum_tersedia?: boolean
        rincianEssay: RincianEssaySoal[] | null
        essayFotoUrl: string | null
        essayModeJawaban: string | null
      }>(`/api/siswa/nilai/${params.id}`)
      setNilai(res.nilai)
      setRincian(res.rincian)
      setRincianBelumTersedia(Boolean(res.rincian_belum_tersedia))
      setRincianEssay(res.rincianEssay)
      setEssayFotoUrl(res.essayFotoUrl)
      setEssayModeJawaban(res.essayModeJawaban)
    } catch (e: any) {
      setError(e?.message ?? 'Gagal memuat rincian nilai')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  if (error || !nilai) {
    return <EmptyState message={error ?? 'Data tidak ditemukan'} icon={XCircle} />
  }

  // FIX (bug nilai essay tidak tampil di siswa): sebelumnya kartu ringkasan
  // ini SELALU pakai nilai.nilai/nilai.lulus (nilai PG saja), walau guru
  // sudah merilis nilai_total gabungan PG+essay. Sekarang: kalau sudah
  // dirilis (nilai_total terisi, di-mask null oleh API selama belum
  // dirilis), tampilkan nilai_total sebagai "Nilai" & hitung ulang
  // grade/status lulus dari situ.
  //
  // BUG FIX (nilai remedial tidak masuk ke akun siswa): sebelumnya logika
  // ini tidak pernah tahu tentang nilai_edit (remedial), jadi siswa yang
  // sudah lulus KKM lewat remedial tetap melihat nilai & status lama di
  // halaman rincian mereka sendiri, kontradiktif dengan yang guru & wali
  // kelas lihat. Sekarang pakai nilai_final/grade_final/lulus_final dari
  // server (sudah menghitung prioritas remedial > essay > PG), dengan
  // fallback ke logika lama kalau field itu belum ada.
  const adaRemedial = nilai.ada_remedial === true
  const sudahDirilis = nilai.nilai_total != null
  const nilaiTampil = nilai.nilai_final ?? (sudahDirilis ? nilai.nilai_total! : nilai.nilai)
  const gradeTampil = nilai.grade_final ?? (sudahDirilis ? hitungGrade(nilai.nilai_total!) : nilai.grade)
  const lulusTampil = nilai.lulus_final ?? (sudahDirilis ? nilai.nilai_total! >= nilai.kkm : nilai.lulus)

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => router.back()} className="btn-secondary btn-sm">
        <ChevronLeft className="w-4 h-4" /> Kembali
      </button>

      <div>
        <h1 className="page-title">{nilai.nama_mapel}</h1>
        <p className="page-subtitle">Rincian hasil ujian per nomor soal</p>
      </div>

      {/* Ringkasan */}
      <div className="card flex flex-wrap items-center gap-6">
        <div>
          <div className="text-xs text-slate-500">Nilai</div>
          <div className={`text-3xl font-bold ${nilaiColor(nilaiTampil)}`}>{nilaiTampil}</div>
          {adaRemedial ? (
            <div className="text-[11px] text-indigo-500 mt-0.5">Nilai remedial dari guru</div>
          ) : sudahDirilis && (
            <div className="text-[11px] text-slate-400 mt-0.5">PG {nilai.nilai} + Essay {nilai.nilai_essay}</div>
          )}
          {!adaRemedial && nilai.essay_belum_dirilis && (
            <div className="text-[11px] text-amber-600 mt-0.5">Menunggu rilis nilai essay dari guru</div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500">Grade</div>
          <span className={`badge font-bold ${
            gradeTampil === 'A' ? 'badge-green' :
            gradeTampil === 'B' ? 'badge-blue' :
            gradeTampil === 'C' ? 'badge-yellow' : 'badge-red'
          }`}>{gradeTampil}</span>
        </div>
        <div>
          <div className="text-xs text-slate-500">Benar/Total</div>
          <div className="text-slate-700 font-medium">{nilai.benar}/{nilai.total}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Status</div>
          <span className={`badge ${lulusTampil ? 'badge-green' : 'badge-red'}`}>
            {lulusTampil ? '✓ Lulus' : '✗ Tidak Lulus'}
          </span>
        </div>
        <div>
          <div className="text-xs text-slate-500">Tanggal</div>
          <div className="text-sm text-slate-500">{formatDateTime(nilai.timestamp)}</div>
        </div>
      </div>

      {/* P0 (audit brief "nilai 0 tapi rincian ada jawaban benar"): banner
          penjelasan SEBELUM rincian soal, supaya siswa tidak bingung melihat
          badge "Benar" di beberapa nomor padahal nilai akhirnya 0. Status
          diambil dari server (dihentikan_pelanggaran), bukan ditebak dari
          nilai==0 (nilai wajar juga bisa 0 kalau semua jawaban salah). */}
      {nilai.dihentikan_pelanggaran && (
        <div className="card bg-red-50/60 border-red-100">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-1.5">
            <Lock className="w-4 h-4" /> Hasil Ujian — Ujian Dihentikan
          </div>
          <p className="text-sm text-slate-700">
            Ujian ini dihentikan karena pelanggaran aturan ujian. Oleh karena itu, nilai akhir
            ditetapkan <strong>0</strong>, meskipun terdapat beberapa jawaban yang tercatat benar.
          </p>
          <p className="text-sm text-slate-500 mt-1.5">
            Rincian di bawah ini menunjukkan jawaban yang tersimpan sebelum ujian dihentikan.
          </p>
        </div>
      )}

      {/* BUG FIX (nilai remedial tidak masuk ke akun siswa): catatan dari
          guru saat menyimpan nilai remedial (kalau diisi) sebelumnya tidak
          pernah dikirim/ditampilkan ke siswa sama sekali. */}
      {adaRemedial && nilai.catatan_guru && (
        <div className="card bg-indigo-50/60 border-indigo-100">
          <div className="text-xs font-medium text-indigo-600 mb-1">Catatan dari guru</div>
          <p className="text-sm text-slate-700">{nilai.catatan_guru}</p>
        </div>
      )}

      {/* FITUR (Rincian jawaban essay per soal): hanya muncul kalau ada
          soal essay di sesi ini DAN guru sudah merilis nilainya (rincianEssay
          null selama belum dirilis, lihat masking di API). */}
      {rincianEssay && rincianEssay.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <PenSquare className="w-5 h-5 text-brand-600" /> Rincian Jawaban Essay
          </h2>

          {essayModeJawaban === 'KERTAS' && essayFotoUrl && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
                <ImageIcon className="w-4 h-4 text-slate-400" /> Foto Lembar Jawaban Kamu
              </div>
              <img
                src={essayFotoUrl}
                alt="Foto lembar jawaban essay"
                className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
              />
            </div>
          )}

          {rincianEssay.map(s => (
            <div key={s.no} className="card">
              <div className="flex items-center justify-between gap-2 mb-4">
                <span className="badge-blue font-semibold">Soal Essay {s.no}</span>
                <span className="badge badge-yellow font-bold">
                  Skor: {s.skor ?? 0} / {s.bobot_maks}
                </span>
              </div>

              <p className="text-slate-800 text-base leading-relaxed mb-4">{s.teks}</p>
              {s.gambar_url && (
                <div className="mb-6">
                  <img
                    src={s.gambar_url}
                    alt="Gambar soal essay"
                    className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
                    style={{ maxHeight: '320px' }}
                  />
                </div>
              )}

              {essayModeJawaban === 'DIGITAL' && (
                <div>
                  <div className="text-xs text-slate-500 mb-1.5">Jawaban Kamu</div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700 whitespace-pre-wrap">
                    {s.jawaban_teks || <span className="text-slate-400 italic">Tidak dijawab</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* FASE 3 FIX (audit lanjutan): selama sesi ujian masih BERJALAN,
          server tidak mengirim rincian PG sama sekali (`rincian: null`) —
          tampilkan pesan penjelas alih-alih daftar kosong yang membingungkan. */}
      {rincianBelumTersedia && (
        <div className="card bg-amber-50/60 border-amber-100">
          <p className="text-sm text-slate-700">
            Rincian jawaban pilihan ganda akan tersedia setelah sesi ujian ini
            selesai untuk semua peserta, supaya jawaban yang benar tidak
            bocor ke peserta lain yang masih mengerjakan.
          </p>
        </div>
      )}

      {/* Daftar soal */}
      {rincian && rincian.length > 0 && (
      <div className="space-y-4">
        {rincianEssay && rincianEssay.length > 0 && (
          <h2 className="text-lg font-semibold text-slate-800">Rincian Jawaban Pilihan Ganda</h2>
        )}
        {rincian.map(s => (
          <div key={s.no} className="card">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="badge-blue font-semibold">Soal {s.no}</span>
              {!s.dijawab ? (
                <span className="badge badge-yellow flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Tidak Dijawab
                </span>
              ) : s.benar ? (
                <span className="badge badge-green flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Benar
                </span>
              ) : (
                <span className="badge badge-red flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Salah
                </span>
              )}
            </div>

            <p className="text-slate-800 text-base leading-relaxed mb-4">{s.teks}</p>
            {s.gambar_pertanyaan && (
              <div className="mb-6">
                <img
                  src={s.gambar_pertanyaan}
                  alt="Gambar soal"
                  className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
                  style={{ maxHeight: '320px' }}
                />
              </div>
            )}

            <div className="space-y-2">
              {LABELS.slice(0, s.jumlah_opsi || 4).map(label => {
                const opsiText = s[`opsi_${label.toLowerCase()}` as keyof RincianSoal] as string | undefined
                const opsiGambar = s[`gambar_opsi_${label.toLowerCase()}` as keyof RincianSoal] as string | null | undefined
                if (!opsiText) return null
                return (
                  <div key={label} className="soal-opsi soal-opsi-default w-full text-left cursor-default">
                    <span className="w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 bg-slate-100 text-slate-600">
                      {label}
                    </span>
                    <span className="text-slate-800 flex flex-col gap-1">
                      {opsiText}
                      {opsiGambar && (
                        <img
                          src={opsiGambar}
                          alt={`Gambar opsi ${label}`}
                          className="w-full max-w-xs rounded-lg border border-slate-200 mt-1 object-contain"
                          style={{ maxHeight: '160px' }}
                        />
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
