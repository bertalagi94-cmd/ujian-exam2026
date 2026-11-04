'use client'

// Petunjuk Penilaian — SATU tempat untuk semua penjelasan cara kerja menu
// Penilaian (rumus nilai PG, essay, nilai akhir, remedial, rilis, kirim ke
// wali kelas). Dibuka lewat tombol "Petunjuk Penilaian" di judul halaman
// (lihat page.tsx).
//
// Penjelasan yang dulu selalu tampil di tiap tab (Rekap Nilai, Kirim Nilai,
// dan modal Petunjuk khusus Periksa Essay) digabung ke sini supaya tampilan
// tab tetap bersih. Pesan yang berubah sesuai keadaan data (peringatan,
// status, jumlah siswa) TETAP di tempatnya masing-masing.
//
// RUMUS DI SINI HARUS SAMA dengan kode — kalau rumus diubah, ubah juga teks ini:
//   - nilai PG   : src/lib/penilaian-ujian.ts (hitungHasilPenilaian)
//   - nilai essay & nilai akhir : src/app/api/guru/koreksi-essay/route.ts
import { Modal } from '@/components/ui'

function Bagian({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="font-semibold text-slate-800 mb-1.5">{judul}</h4>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Rumus({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 leading-relaxed">
      {children}
    </p>
  )
}

export function PetunjukPenilaianModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Petunjuk Penilaian"
      size="lg"
      footer={<button onClick={onClose} className="btn-primary">Mengerti</button>}
    >
      <div className="space-y-5 text-sm text-slate-600 leading-relaxed">
        <Bagian judul="Alur kerja di menu ini">
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Periksa Jawaban Essay</strong> — hanya ada kalau mapel Anda punya soal essay. Beri skor lalu rilis nilainya ke siswa.</li>
            <li><strong>Rekap dan Edit Nilai</strong> — lihat dan unduh nilai, serta input nilai remedial kalau perlu.</li>
            <li><strong>Kirim Nilai ke Wali Kelas</strong> — kirim nilai akhir siswa. Ini langkah terakhir.</li>
          </ol>
        </Bagian>

        <Bagian judul="Cara nilai pilihan ganda (PG) dihitung">
          <Rumus>Nilai PG = (jumlah jawaban benar ÷ total soal PG) × 100</Rumus>
          <ul className="list-disc pl-5 space-y-1">
            <li>Pembaginya <strong>selalu total soal di paket</strong>, bukan jumlah soal yang dijawab. Soal yang dikosongkan dihitung salah.</li>
            <li>Jawaban salah <strong>tidak mengurangi</strong> nilai.</li>
            <li>Semua soal PG berbobot sama.</li>
            <li>Hasilnya dibulatkan ke bilangan bulat.</li>
          </ul>
          <p>Contoh: 30 soal, benar 24 → 24 ÷ 30 × 100 = <strong>80</strong>.</p>
        </Bagian>

        <Bagian judul="Grade dan status lulus">
          <p>
            Grade: <strong>A</strong> untuk nilai 90 ke atas, <strong>B</strong> 80–89, <strong>C</strong> 70–79,
            {' '}<strong>D</strong> 60–69, <strong>E</strong> di bawah 60.
          </p>
          <p>
            Siswa dinyatakan <strong>lulus</strong> kalau nilainya mencapai KKM mata pelajaran (kalau KKM belum
            diisi, dipakai 75).
          </p>
        </Bagian>

        <Bagian judul="Kalau ujian ada soal essay">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Nilai PG <strong>tidak langsung tampil</strong> setelah siswa selesai mengerjakan PG. Siswa
              mengerjakan essay dulu, dan nilai PG baru terbuka setelah essay dikirim.
            </li>
            <li>
              <strong>Nilai akhir</strong> baru muncul di siswa setelah Anda menilai essay dan merilisnya.
            </li>
          </ul>
          <Rumus>
            Nilai essay = (total skor semua soal ÷ total skor maksimal) × 100<br />
            Nilai akhir = (Nilai PG × bobot PG%) + (Nilai essay × bobot essay%)
          </Rumus>
          <p>
            Bobot PG dan essay diatur di jadwal ujian (bawaannya 50 : 50) dan tampil di atas daftar siswa pada tab
            Periksa Jawaban Essay, lengkap dengan tombol <strong>Edit</strong>. Perubahan bobot langsung menghitung
            ulang nilai akhir siswa yang sudah dinilai. Bobot tidak bisa diubah lagi setelah ada nilai yang terkirim
            ke wali kelas — minta wali kelas mengembalikan nilainya dulu kalau bobot perlu direvisi.
          </p>
          <p>
            Status lulus dihitung ulang dari <strong>nilai akhir</strong>, jadi bisa berbeda dari status lulus
            berdasarkan PG saja. Contoh: PG 80, essay 60, bobot 50 : 50 → nilai akhir <strong>70</strong>.
          </p>
        </Bagian>

        <Bagian judul="Memberi skor essay">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Beri skor tiap soal sesuai bobot maksimalnya (rubrik yang dibuat di menu Buat Soal). Sistem
              menjumlahkan dan mengonversinya ke skala 0–100 otomatis. Pratinjaunya langsung terlihat setelah
              semua soal siswa terisi, sebelum Anda menekan Simpan.
            </li>
            <li>
              Mode <strong>Digital</strong>: jawaban siswa tampil sebagai teks, kolom skor ada di tiap kartu jawaban.
              Mode <strong>Kertas</strong>: lembar jawaban dikumpulkan pengawas dan diserahkan ke Anda — beri skor
              langsung dari kertasnya.
            </li>
            <li>
              Siswa yang tidak menjawab essay: tekan <strong>Tidak Mengerjakan</strong> pada barisnya, nilai essay
              otomatis 0.
            </li>
            <li>
              Siswa yang sesinya ditutup paksa dan essay-nya belum dinilai harus diputuskan dulu (dinilai, atau
              Tidak Mengerjakan) sebelum nilai bisa dirilis ke semua siswa.
            </li>
          </ul>
        </Bagian>

        <Bagian judul="Merilis nilai essay ke siswa">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Rilis satu per satu lewat <strong>Rilis ke Siswa Ini</strong>, atau sekaligus lewat{' '}
              <strong>Rilis Nilai ke Semua Siswa</strong> (aktif setelah semua siswa dinilai).
            </li>
            <li>
              Nilai yang sudah dirilis langsung bisa dilihat siswa. Tidak ada tombol untuk membatalkan rilis; kalau
              bobot diedit, rilis yang terpengaruh otomatis ditarik dan perlu dirilis ulang.
            </li>
            <li>
              Tombol rilis sekaligus di tab Periksa Jawaban Essay sama dengan <strong>Rilis Semua ke Siswa</strong> di
              tab Kirim Nilai — cukup lakukan dari salah satunya.
            </li>
          </ul>
        </Bagian>

        <Bagian judul="Remedial dan edit nilai">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Di tab Rekap dan Edit Nilai, tekan ikon pensil di baris siswa untuk input nilai remedial. Nilai itu
              langsung dipakai sebagai <strong>Nilai Akhir</strong> di rekap dan saat dikirim ke wali kelas.
            </li>
            <li>
              Baris berlabel oranye <strong>"Dikembalikan wali kelas"</strong> berarti nilainya sudah bisa diedit lagi
              dan ditampilkan paling atas.
            </li>
          </ul>
        </Bagian>

        <Bagian judul="Mengirim nilai ke wali kelas">
          <p>Ada dua tombol penting di tab Kirim Nilai:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <strong>Rilis Nilai Essay</strong> (kalau ada essay) — panel ungu di tiap mapel. Tekan ini
              <strong> dulu</strong> supaya siswa bisa melihat nilai essay-nya.
            </li>
            <li>
              <strong>Kirim ke Wali Kelas</strong> — tombol hijau paling bawah tiap mapel. Inilah yang benar-benar
              mengirim nilai final siswa ke wali kelas.
            </li>
          </ol>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Kolom <strong>Nilai Final</strong> adalah angka yang dikirim ke wali kelas, sudah termasuk nilai
              remedial kalau pernah diinput. Nilai tidak bisa diketik di tab ini; ubah lewat tab Rekap dan Edit Nilai.
            </li>
            <li>
              Siswa yang essay-nya belum dirilis dilewati saat tombol kirim ditekan, sampai nilainya dirilis.
            </li>
          </ul>
        </Bagian>
      </div>
    </Modal>
  )
}
