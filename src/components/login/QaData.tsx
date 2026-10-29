// Q&A / Bantuan di beranda login — DIKELOMPOKKAN PER PERAN supaya pembaca
// langsung menemukan pertanyaan yang sesuai dengan akunnya (Siswa, Guru,
// Kepala Sekolah, Admin). Tab "Umum" hanya berisi hal yang berlaku untuk semua.
//
// Catatan isi:
//   - Pengawas, Wali Kelas, dan Admin Kelas BUKAN akun terpisah: itu tugas
//     tambahan akun Guru, jadi pertanyaannya ada di tab Guru.
//   - "Admin" di sini = Super Admin (pengelola aplikasi sekolah/yayasan).
//   - Bahasa sengaja dibuat sederhana dan sehari-hari: tidak semua pengguna
//     paham istilah IT. Nama menu ditulis persis seperti yang tampil di aplikasi.
//
// PERF: data diekstrak dari src/app/login/page.tsx dan di-lazy-load lewat TentangModal (tab Q&A).
import type { ReactNode } from 'react'
import { Info, GraduationCap, Users, UserCheck, Shield } from 'lucide-react'

export interface QaEntry {
  q: string
  a: string
}

export interface QaGroup {
  category: string
  items: QaEntry[]
}

export type QaRoleId = 'umum' | 'siswa' | 'guru' | 'kepsek' | 'admin'

export interface QaRole {
  id: QaRoleId
  label: string
  /** Kalimat "untuk siapa" yang tampil di atas daftar pertanyaan. */
  untuk: string
  icon: ReactNode
  text: string
  bg: string
  border: string
  gradient: string
  groups: QaGroup[]
}

export const QA_ROLES: QaRole[] = [
  // ───────────────────────────── UMUM ─────────────────────────────
  {
    id: 'umum',
    label: 'Umum',
    untuk: 'Berlaku untuk semua pengguna, apa pun peran Anda.',
    icon: <Info className="w-4 h-4" />,
    text: 'text-slate-700',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    gradient: 'from-slate-500 to-slate-700',
    groups: [
      {
        category: 'Tentang SmartExam',
        items: [
          {
            q: 'Apa itu SmartExam?',
            a: 'SmartExam adalah aplikasi ujian lewat komputer atau HP untuk berbagai sekolah dan jenjang. Guru membuat soal, admin memeriksa dan menjadwalkan ujian, dan siswa mengerjakan ujian secara online dengan diawasi langsung oleh pengawas.',
          },
          {
            q: 'Ada peran apa saja, dan saya termasuk yang mana?',
            a: 'Ada empat jenis akun: (1) Siswa, masuk dengan NISN. (2) Guru, membuat soal, memeriksa essay, dan bisa mendapat tugas tambahan. (3) Kepala Sekolah, memantau ujian dan hasilnya. (4) Admin (Super Admin), pengelola aplikasi sekolah. Pengawas, Wali Kelas, dan Admin Kelas bukan akun tersendiri. Itu tugas tambahan yang diberikan admin kepada akun Guru, dan menunya muncul sendiri di menu samping guru tersebut. Pilih tab peran Anda di atas untuk melihat pertanyaan yang sesuai.',
          },
          {
            q: 'Aplikasi apa yang disarankan untuk membuka SmartExam?',
            a: 'Kebanyakan siswa mengerjakan ujian lewat HP, jadi pakai Chrome versi terbaru di Android atau Safari versi terbaru di iPhone/iPad. Di laptop atau komputer, pakai Google Chrome atau Mozilla Firefox versi terbaru. Hindari aplikasi pembuka internet yang sudah lama tidak diperbarui.',
          },
          {
            q: 'Apakah bisa dipakai di HP?',
            a: 'Bisa, dan inilah cara yang paling sering dipakai siswa. Tampilannya dan penjaga kejujuran ujian (layar penuh, mendeteksi pindah aplikasi, dll) sudah dibuat untuk HP. Pastikan baterai cukup, HP tidak dalam mode hemat baterai atau hemat data yang terlalu ketat, dan matikan suara notifikasi lain dulu supaya tidak dianggap pindah aplikasi.',
          },
        ],
      },
      {
        category: 'Bantuan Umum',
        items: [
          {
            q: 'Halaman error atau tidak bisa dibuka, apa yang harus dilakukan?',
            a: 'Muat ulang halamannya (tekan F5, atau tarik layar ke bawah di HP). Kalau masih bermasalah, tunggu beberapa menit lalu coba lagi. Siswa: kabari pengawas ruangan. Guru dan Kepala Sekolah: kabari admin sekolah. Admin: lihat pertanyaan di tab Admin.',
          },
          {
            q: 'Masalah saya tidak ada di daftar ini',
            a: 'Hubungi Admin sekolah Anda. Siswa cukup menyampaikan ke pengawas atau guru, nanti diteruskan ke admin.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── SISWA ─────────────────────────────
  {
    id: 'siswa',
    label: 'Siswa',
    untuk: 'Untuk siswa yang masuk memakai NISN.',
    icon: <GraduationCap className="w-4 h-4" />,
    text: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    gradient: 'from-orange-500 to-amber-500',
    groups: [
      {
        category: 'Masuk & Akun',
        items: [
          {
            q: 'Username dan password saya apa?',
            a: 'Username Anda adalah NISN (Nomor Induk Siswa Nasional). Password awalnya biasanya juga NISN Anda. Setelah berhasil masuk, sebaiknya ganti sendiri lewat menu Profil Saya.',
          },
          {
            q: 'Saya lupa password, bagaimana caranya?',
            a: 'Kalau Anda masih ingat password lama, ganti sendiri lewat menu Profil Saya (cukup masukkan password lama). Kalau benar-benar lupa, minta guru atau admin sekolah untuk mengembalikan password Anda ke password awal.',
          },
        ],
      },
      {
        category: 'Sebelum Ujian',
        items: [
          {
            q: 'Bagaimana saya tahu ujian sudah dibuka pengawas?',
            a: 'Setelah pengawas membuka ujian, muncul angka kecil berwarna merah pada menu Beranda dan Mulai Ujian selama Anda belum menyelesaikan ujian itu. Kalau ujian sudah dibuka saat Anda masuk, muncul juga pemberitahuan satu kali. Untuk memulai, buka menu Mulai Ujian lalu masukkan kode ujian dari pengawas.',
          },
          {
            q: 'Menu Mulai Ujian tidak ada, kenapa?',
            a: 'Menu Mulai Ujian hanya muncul kalau Anda punya ujian yang bisa diikuti: ujian yang dijadwalkan hari ini, atau ujian (termasuk susulan) yang sedang dibuka pengawas dan belum Anda ikuti. Cek menu Jadwal untuk melihat jadwal Anda. Kalau seharusnya ada ujian tapi menunya tidak muncul, kabari pengawas atau guru.',
          },
          {
            q: 'Nama saya tidak ada di daftar peserta ujian',
            a: 'Kabari pengawas atau guru. Penyebab yang paling sering: Anda belum terdaftar di kelas yang dijadwalkan, atau baru ditambahkan setelah ujian dibuat. Admin akan memeriksa data kelas Anda.',
          },
        ],
      },
      {
        category: 'Saat Ujian',
        items: [
          {
            q: 'Apakah jawaban saya tersimpan sendiri?',
            a: 'Ya, setiap jawaban yang Anda pilih langsung tersimpan sendiri. Tidak perlu cemas kalau koneksi putus sebentar: jawaban yang sudah terisi tetap aman.',
          },
          {
            q: 'Apa yang dimaksud pelanggaran?',
            a: 'Aplikasi tahu kalau Anda pindah halaman, mengecilkan jendela, keluar dari layar penuh, atau membuka aplikasi lain. Setiap kali itu terjadi, ujian Anda langsung berhenti sementara (statusnya RESET). Untuk lanjut, Anda perlu kode 7 karakter dari pengawas. Kalau jumlah pelanggaran melewati batas yang ditetapkan admin, pengawas yang memutuskan apakah akun Anda perlu dikunci permanen.',
          },
          {
            q: 'Status ujian saya "RESET" / saya diminta kode, apa yang harus dilakukan?',
            a: 'Angkat tangan atau panggil pengawas ruangan, lalu minta kode 7 karakter. Masukkan kode itu untuk melanjutkan dari soal terakhir. Kalau pelanggaran sudah melewati batas, pengawas bisa mengunci akun Anda secara permanen untuk ujian itu.',
          },
          {
            q: 'Kenapa ujian harus dalam layar penuh?',
            a: 'Ini bagian dari penjaga kejujuran ujian. Keluar dari layar penuh dianggap sama seperti pindah halaman atau aplikasi, yaitu pelanggaran. Di HP, membuka panel notifikasi atau pengaturan cepat, mengganti WiFi, membalas chat, atau menekan tombol Home langsung dicatat sebagai pelanggaran. Kalau perangkat Anda sama sekali tidak mendukung layar penuh (beberapa iPhone/iPad), kabari pengawas sebelum ujian dimulai.',
          },
          {
            q: 'Internet saya putus saat ujian, bagaimana?',
            a: 'Tenang, dan JANGAN keluar dari layar ujian untuk membuka pengaturan WiFi atau data karena itu dicatat sebagai pelanggaran. Tetap di halaman ujian saja: jawaban yang sudah terisi tersimpan di perangkat Anda dan terkirim sendiri begitu internet kembali. Kalau internet tidak kunjung pulih dan Anda terpaksa membuka pengaturan HP, kabari pengawas DULU sebelum melakukannya.',
          },
          {
            q: 'Saya tidak sengaja menutup halaman ujian, bagaimana?',
            a: 'Buka lagi aplikasi pembuka internet Anda, masuk lagi, lalu buka halaman ujian. Ini dicatat sebagai pelanggaran dan ujian berhenti sementara, jadi minta kode 7 karakter ke pengawas untuk melanjutkan dari soal terakhir.',
          },
          {
            q: 'Bisakah saya mengerjakan ujian yang sama di HP dan laptop sekaligus?',
            a: 'Tidak. Satu ujian hanya boleh dibuka di satu perangkat. Kalau Anda masuk ke ujian yang sama di perangkat kedua, ujian di perangkat pertama otomatis terputus. Pakai satu perangkat saja sampai ujian selesai.',
          },
          {
            q: 'Internet mati total dan soal essay belum sempat dibuka, apa yang harus dilakukan?',
            a: 'Tetap tenang dan tetap di layar ujian. Minta "kode darurat" ke pengawas ruangan. Kode ini dibacakan langsung atau ditulis di papan, bukan dikirim lewat internet. Masukkan kode itu untuk membuka soal essay tanpa internet. Begitu internet pulih, jawaban dan waktu pengerjaan Anda terkirim sendiri.',
          },
          {
            q: 'Ada menu "Pengiriman Tertunda", itu untuk apa?',
            a: 'Menu ini hanya muncul kalau ada jawaban Anda yang belum berhasil terkirim (biasanya karena internet sempat putus). Aplikasi terus mencoba mengirim ulang sendiri. Anda juga bisa menekan "Kirim Sekarang" supaya lebih cepat. Jawaban yang sudah tersimpan tidak akan hilang.',
          },
          {
            q: 'Listrik atau HP mati di tengah ujian, apa yang harus dilakukan?',
            a: 'Segera kabari pengawas. Jawaban yang sudah terisi sebelum mati tetap tersimpan. Kalau Anda tidak bisa melanjutkan, guru pengawas atau admin bisa memberi kesempatan ujian susulan dengan kode akses baru.',
          },
        ],
      },
      {
        category: 'Setelah Ujian & Nilai',
        items: [
          {
            q: 'Nilai tidak muncul setelah ujian selesai',
            a: 'Pastikan Anda benar-benar menekan "Selesai Ujian", bukan hanya menutup halaman. Lalu muat ulang halaman Nilai Saya. Untuk mata pelajaran yang punya soal essay, nilai total baru muncul setelah guru selesai memeriksa essay dan mengumumkan nilainya.',
          },
          {
            q: 'Akun saya dikunci permanen oleh pengawas, bagaimana dengan nilai saya?',
            a: 'Dikunci permanen berarti ujian Anda pada kali itu dihentikan dan nilainya menjadi 0 (terkunci berarti gugur), kecuali nilai yang sudah terlanjur dikirim ke wali kelas. Kalau menurut Anda ini terjadi karena masalah pada perangkat atau jaringan, bicarakan dengan pengawas dan guru mata pelajaran. Kesempatan ujian susulan hanya bisa diberikan oleh guru pengawas atau admin.',
          },
          {
            q: 'Soal essay dikerjakan dengan diketik atau di kertas?',
            a: 'Tergantung pilihan guru untuk ujian itu: bisa diketik di layar atau ditulis di kertas. Pengawas akan menjelaskan sebelum essay dimulai. Essay baru bisa dikerjakan setelah pengawas membukanya.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── GURU ─────────────────────────────
  {
    id: 'guru',
    label: 'Guru',
    untuk: 'Untuk guru, termasuk guru yang juga bertugas sebagai Pengawas, Wali Kelas, atau Admin Kelas.',
    icon: <Users className="w-4 h-4" />,
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    gradient: 'from-emerald-500 to-teal-600',
    groups: [
      {
        category: 'Akun & Tugas Tambahan',
        items: [
          {
            q: 'Username dan password guru dari mana? Lupa password bagaimana?',
            a: 'Username dan password awal dibuatkan oleh Admin di menu Data Pengguna. Kalau lupa password, minta Admin mengembalikannya ke password awal lewat menu yang sama.',
          },
          {
            q: 'Menu Jadwal Mengawas Saya, Wali Kelas, atau Admin Kelas tidak muncul di menu samping saya',
            a: 'Menu itu hanya muncul kalau Admin menugaskan Anda. Jadwal Mengawas Saya untuk guru yang punya jadwal jaga, Wali Kelas untuk guru yang ditunjuk jadi wali kelas, dan Admin Kelas untuk guru yang ditunjuk menyetujui soal (itu pun hanya kalau fitur Admin Kelas dinyalakan). Minta Admin memeriksa penugasan Anda.',
          },
          {
            q: 'Satu guru mengajar di lebih dari satu sekolah/jenjang, bisa?',
            a: 'Bisa. Admin dapat menghubungkan satu akun guru ke lebih dari satu sekolah di menu Data Pengguna, jadi Anda melihat kelas dan kisi-kisi dari semua sekolah tempat Anda mengajar dalam satu akun.',
          },
        ],
      },
      {
        category: 'Membuat Soal & Mengirim Paket',
        items: [
          {
            q: 'Bagaimana cara memasukkan soal dari Word?',
            a: 'Buka menu Buat Soal, lalu klik "Impor dari Word" (untuk essay: "Impor Soal dari Word"). Unduh contoh formatnya, isi satu tabel untuk tiap nomor soal di Word, lalu unggah file .docx. Periksa tampilan awalnya, kemudian klik Impor. Tidak ada soal yang tersimpan sebelum tombol Impor ditekan. Isi hanya kolom kuning dan jangan ubah kolom biru (nama baris). Tulisan soal dan gambar soal ditaruh di kotak yang sama: klik di dalam kotak Soal, lalu Sisipkan ▸ Gambar (satu gambar per kotak). Caranya sama untuk pilihan jawaban bergambar. Tabel oranye di awal hanya contoh dan tidak ikut dimasukkan.',
          },
          {
            q: 'Kenapa setelah impor selesai, form menampilkan nomor soal berikutnya?',
            a: 'Form di halaman Buat Soal selalu dipakai untuk menambah soal berikutnya. Setelah 5 soal berhasil dimasukkan, form menampilkan "Soal ke-6". Semua soal hasil impor sudah tersimpan dan bisa dilihat di bagian "Soal yang sudah dibuat" di bawah form, tempat tiap soal bisa diubah atau dihapus. Kalau jumlah soalnya sudah cukup, form tidak perlu diisi; lanjut saja ke tahap kirim paket.',
          },
          {
            q: 'Saya tidak sengaja memasukkan file yang sama dua kali, apakah soalnya jadi ganda?',
            a: 'Tidak. Sebelum dimasukkan, aplikasi membandingkan tulisan soal, tulisan pilihan jawaban, dan kunci dengan soal yang sudah ada di paket. Soal yang persis sama ditandai kuning di tampilan awal dan dilewati. Untuk essay, yang dibandingkan adalah tulisan soalnya. Gambar tidak ikut dibandingkan, jadi dua soal yang tulisan, pilihan, dan kuncinya sama tapi gambarnya beda tetap dianggap kembar. Kalau itu memang soal yang berbeda, tambahkan lewat form "Soal ke-N".',
          },
          {
            q: 'Soal saya ditandai merah di tampilan awal impor, artinya apa?',
            a: 'Ada isian yang perlu diperbaiki. Alasannya tertulis di bawah soal itu, misalnya: soal atau pilihan jawaban belum diisi, kunci kosong atau tidak cocok (kunci harus satu huruf sesuai jumlah pilihan, mis. A sampai D), atau bobot essay belum diisi atau bukan angka di atas 0. Perbaiki di file Word lalu unggah lagi, atau centang "Lewati soal yang bermasalah" untuk memasukkan soal yang sudah benar saja.',
          },
          {
            q: 'Gambar atau rumus di soal Word saya tidak terbaca, bagaimana?',
            a: 'Pakai gambar berformat PNG atau JPG yang dimasukkan lewat Sisipkan ▸ Gambar. Format EMF, WMF, dan SVG tidak bisa dibaca. Diagram, bentuk, atau kotak teks di Word juga bukan gambar sehingga tidak ikut terbawa. Cara termudah: ubah jadi gambar (foto layar), lalu sisipkan lagi. Hanya satu gambar per kotak yang dipakai, dan gambar yang terlalu besar dikecilkan sendiri.',
          },
          {
            q: 'Muncul pesan paket terkunci atau jumlah pilihan jawaban tidak sama',
            a: 'Soal hanya bisa ditambah, diubah, atau dihapus selama paket masih berstatus draft atau ditolak. Paket yang sudah dikirim atau disetujui terkunci, begitu juga kalau ujian mata pelajaran dan kelas itu sudah dimulai. Semua soal dalam satu paket harus punya jumlah pilihan jawaban yang sama (4 atau 5). Kalau paket sudah berisi soal 4 pilihan, unduh contoh format yang 4 pilihan. Kalau admin mengunci jumlah pilihan, jumlahnya mengikuti pengaturan admin dan tidak bisa diganti per soal.',
          },
          {
            q: 'Paket tidak bisa dikirim: muncul pesan "minimal ... soal, saat ini baru ..."',
            a: 'Admin menetapkan jumlah soal minimal untuk mata pelajaran Anda (misalnya 30 soal PG atau 5 soal essay). Paket tidak bisa dikirim sampai jumlah soalnya mencapai batas itu. Pesannya menyebut batas dan jumlah soal Anda sekarang. Tambahkan soal yang kurang (bisa lewat Impor dari Word), lalu kirim lagi. Aturan ini hanya berlaku untuk pengiriman baru, jadi paket yang sudah dikirim atau disetujui tidak terpengaruh. Kalau menurut Anda angkanya tidak sesuai, hubungi Admin.',
          },
          {
            q: 'Kalau saya kirim paket PG, apakah paket Essay ikut terkirim (dan sebaliknya)?',
            a: 'Setelah Anda menekan Kirim, aplikasi bertanya apakah paket pasangannya (mata pelajaran dan kelas yang sama) ikut dikirim sekalian. Pasangan yang jumlah soalnya masih kurang dari batas minimal tidak ikut terkirim; Anda diberi tahu alasannya, dan paket itu bisa dikirim sendiri setelah soalnya cukup. Admin tetap memeriksa paket PG dan Essay secara terpisah.',
          },
          {
            q: 'Paket saya ditolak admin, apa yang harus dilakukan?',
            a: 'Buka paket yang berstatus ditolak, baca catatan dari admin, perbaiki soal yang dimaksud (soal pada paket yang ditolak boleh diubah), lalu kirim lagi. Paket yang sudah dikirim dan masih menunggu persetujuan juga bisa Anda tarik kembali kalau ingin mengubahnya.',
          },
          {
            q: 'Apakah soal bisa dipakai lagi untuk ujian berikutnya?',
            a: 'Soal PG dan essay dibuat langsung di dalam satu paket lewat menu Buat Soal, jadi tidak ada bank soal terpisah yang bisa dipakai lintas paket. Yang bisa Anda lakukan: gandakan paket yang sudah ada untuk ujian susulan atau semester berikutnya. Kalau perlu banyak soal baru, pakai Impor dari Word.',
          },
          {
            q: 'Siapa yang menentukan lama waktu soal essay?',
            a: 'Anda bisa mengusulkan lama waktu essay di pengaturan essay, tetapi keputusan akhirnya diisi Admin di jadwal ujian. Kalau Admin mengosongkannya, jadwal mengikuti usulan Anda.',
          },
        ],
      },
      {
        category: 'Penilaian',
        items: [
          {
            q: 'Di mana saya memeriksa essay dan mengumumkan nilai?',
            a: 'Menu Penilaian punya tiga tab: Periksa Jawaban Essay (menilai jawaban essay), Rekap Nilai (nilai gabungan PG dan essay tiap siswa), dan Kirim Nilai ke Wali Kelas. Untuk mata pelajaran yang punya essay, nilai total siswa baru muncul setelah Anda selesai memeriksa dan mengumumkan nilainya.',
          },
          {
            q: 'Siswa bilang nilainya tidak muncul, apa yang perlu saya cek?',
            a: 'Pastikan siswa menekan "Selesai Ujian" (bukan hanya menutup halaman). Lalu lihat tab Rekap Nilai di menu Penilaian, apakah datanya sudah masuk. Kalau mata pelajaran punya essay, pastikan essay sudah diperiksa dan nilainya sudah diumumkan.',
          },
        ],
      },
      {
        category: 'Mengawas Ujian (Pengawas)',
        items: [
          {
            q: 'Bagaimana cara membuka ujian dan memantau siswa?',
            a: 'Buka menu Jadwal Mengawas Saya lalu pilih tab Mode Pengawas. Di sana Anda membuka ujian (kode ujian dibagikan ke siswa), memantau peserta secara langsung, mengaktifkan kembali siswa yang kena pelanggaran, membuka atau menutup izin mulai soal essay, dan menutup ujian. Kalau ada ujian yang sedang berjalan, halaman ini langsung terbuka di Mode Pengawas.',
          },
          {
            q: 'Siswa kena pelanggaran dan minta kode, apa yang saya lakukan?',
            a: 'Setiap pelanggaran menghentikan ujian siswa sementara. Aktifkan kembali siswa itu di Mode Pengawas untuk memberinya kode lanjut 7 karakter. Kalau jumlah pelanggarannya sudah melewati batas dari Admin, Anda bisa memilih mengunci akunnya secara permanen untuk ujian itu. Nilai siswa pada ujian itu menjadi 0 (terkunci berarti gugur), jadi lakukan hanya kalau memang perlu.',
          },
          {
            q: 'Internet mati total saat ujian, apa yang harus dilakukan pengawas?',
            a: 'Untuk soal pilihan ganda tidak perlu berbuat apa-apa: jawaban siswa tersimpan di perangkat masing-masing dan terkirim sendiri begitu internet kembali. Untuk essay, buka Mode Pengawas lalu tekan "Tampilkan Kode Darurat", dan bacakan atau tulis kode itu di papan tulis (jangan lewat grup chat atau internet) supaya siswa bisa membuka soal essay tanpa internet. Begitu internet pulih, data essay siswa terkirim sendiri.',
          },
          {
            q: 'Listrik mati atau siswa tidak sempat ujian, bagaimana memberi susulan?',
            a: 'Catat kejadiannya dan laporkan ke Admin. Guru pengawas atau Admin bisa membuka ujian susulan dengan kode akses baru lewat fitur Susulan. Jawaban sebelum gangguan tetap tersimpan.',
          },
          {
            q: 'Kenapa Layar Pantau meminta izin Admin?',
            a: 'Layar Pantau adalah papan nilai ujian secara langsung untuk layar besar atau TV, dan hanya bisa dibuka lewat laptop atau komputer. Akun Guru harus mendapat persetujuan Admin dulu (lewat menu Izin Layar Pantau di akun Admin). Izin berlaku 10 jam, setelah itu perlu diajukan lagi. Papan baru berisi data kalau ada ujian yang sedang berjalan.',
          },
        ],
      },
      {
        category: 'Admin Kelas & Wali Kelas',
        items: [
          {
            q: 'Apa itu Admin Kelas dan apa tugasnya?',
            a: 'Admin Kelas adalah guru yang ditunjuk Admin untuk menyetujui paket soal di kelas tertentu. Menu Admin Kelas muncul di menu samping Anda hanya kalau fitur ini dinyalakan Admin dan Anda ditunjuk. Anda hanya melihat paket dari kelas yang jadi tanggung jawab Anda; kelas lain tetap diperiksa Admin. Tugas Anda menilai apakah paket yang dikirim guru layak dipakai. Jumlah soal minimal sudah dijaga otomatis saat paket dikirim.',
          },
          {
            q: 'Apa tugas Wali Kelas di aplikasi ini?',
            a: 'Menu Wali Kelas muncul untuk guru yang ditunjuk sebagai wali kelas. Di sana Anda memantau dan menerima nilai siswa di kelas Anda, yang dikirim guru mata pelajaran lewat tab Kirim Nilai ke Wali Kelas.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── KEPALA SEKOLAH ─────────────────────────────
  {
    id: 'kepsek',
    label: 'Kepala Sekolah',
    untuk: 'Untuk Kepala Sekolah. Akun ini untuk memantau; data tidak bisa diubah.',
    icon: <UserCheck className="w-4 h-4" />,
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    gradient: 'from-blue-500 to-cyan-600',
    groups: [
      {
        category: 'Masuk & Akun',
        items: [
          {
            q: 'Username dan password Kepala Sekolah dari mana? Lupa password bagaimana?',
            a: 'Akun dibuatkan oleh Admin di menu Data Pengguna. Kalau lupa password, minta Admin mengembalikannya ke password awal lewat menu yang sama.',
          },
        ],
      },
      {
        category: 'Memantau Ujian & Hasil',
        items: [
          {
            q: 'Apa saja yang bisa saya lihat di akun Kepala Sekolah?',
            a: 'Halaman depan berisi ringkasan ujian, Monitoring Ujian (ujian yang sedang berjalan, siapa yang sudah atau belum mengerjakan, dan pelanggaran), Hasil Ujian (rekap nilai per kelas, mata pelajaran, dan siswa), Jadwal Ujian, Kisi-kisi, Data Kelas, serta Guru & Mapel. Akun ini hanya untuk melihat, bukan mengubah data.',
          },
          {
            q: 'Kelas, guru, atau ujian di akun saya kosong / tidak muncul',
            a: 'Kepala Sekolah hanya melihat data sekolahnya sendiri. Kalau semuanya kosong, kemungkinan akun Anda belum dihubungkan dengan sekolah. Minta Admin mengatur sekolah untuk akun Anda di menu Data Pengguna. Kalau baru ada jadwal yang belum dimulai, data nilainya memang belum ada.',
          },
          {
            q: 'Nilai suatu mata pelajaran belum lengkap di Hasil Ujian',
            a: 'Untuk mata pelajaran yang punya soal essay, nilai total baru lengkap setelah guru selesai memeriksa essay dan mengumumkan nilainya. Kalau sudah lama belum lengkap, tanyakan ke guru mata pelajaran yang bersangkutan.',
          },
          {
            q: 'Bagaimana cara membuka Layar Pantau?',
            a: 'Layar Pantau menampilkan papan nilai ujian secara langsung dan hanya bisa dibuka lewat laptop atau komputer (tombolnya ada di beranda login). Kepala Sekolah tidak perlu izin Admin, cukup masuk. Papan baru berisi data kalau ada ujian yang sedang berjalan.',
          },
        ],
      },
    ],
  },

  // ───────────────────────────── ADMIN ─────────────────────────────
  {
    id: 'admin',
    label: 'Admin',
    untuk: 'Untuk Admin (Super Admin) yang mengelola aplikasi sekolah atau yayasan.',
    icon: <Shield className="w-4 h-4" />,
    text: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    gradient: 'from-violet-500 to-purple-600',
    groups: [
      {
        category: 'Akun & Data Utama',
        items: [
          {
            q: 'Saya lupa password Admin, bagaimana?',
            a: 'Hubungi pengelola aplikasi (developer). Admin tidak bisa mengatur ulang passwordnya sendiri dari halaman login.',
          },
          {
            q: 'Bagaimana cara mengembalikan password guru, kepala sekolah, dan siswa ke password awal?',
            a: 'Guru dan Kepala Sekolah: lewat menu Data Pengguna. Siswa: lewat menu Data Siswa (guru juga bisa membantu siswa). Setelah dikembalikan ke password awal, pemilik akun bisa menggantinya sendiri.',
          },
          {
            q: 'Bagaimana cara memasukkan data siswa sekaligus banyak?',
            a: 'Pakai tombol impor di halaman Data Siswa (bukan menu terpisah). Unduh contoh format Excel di sana, isi data siswa sesuai format (NISN, nama, kelas, dll), lalu unggah lagi. Aplikasi memeriksa dan memasukkan datanya sendiri. Buat kelas dan mata pelajaran lebih dulu sebelum memasukkan data siswa.',
          },
          {
            q: 'Satu guru mengajar di lebih dari satu sekolah/jenjang, bisa?',
            a: 'Bisa. Hubungkan satu akun guru ke lebih dari satu sekolah di menu Data Pengguna, jadi guru melihat kelas dan kisi-kisi dari semua sekolah tempat ia mengajar dalam satu akun.',
          },
          {
            q: 'Siswa tidak muncul di daftar peserta ujian',
            a: 'Kemungkinan penyebabnya: (1) siswa belum terdaftar di kelas yang dijadwalkan, (2) kelas siswa tidak sesuai dengan jadwal ujian, (3) siswa baru ditambahkan setelah ujian dibuat. Periksa data siswa dan kelasnya di menu Data Siswa dan Jadwal Ujian.',
          },
          {
            q: 'Apa itu fitur "Lihat Sebagai"?',
            a: 'Fitur ini membuat Admin bisa masuk sementara sebagai akun guru, kepala sekolah, atau siswa tertentu untuk memeriksa atau memperbaiki masalah dari sudut pandang mereka, tanpa perlu tahu passwordnya. Setelah 2 jam Admin otomatis kembali ke akunnya, dan pemilik akun melihat pemberitahuan bahwa akunnya sedang dilihat Admin.',
          },
        ],
      },
      {
        category: 'Soal, Persetujuan & Pengaturan Ujian',
        items: [
          {
            q: 'Bagaimana mengatur jumlah soal minimal untuk tiap mata pelajaran?',
            a: 'Buka Pengaturan, tab Pengaturan Ujian, kartu "Batas Minimal Jumlah Soal". Nyalakan saklarnya (awalnya mati). Untuk PG dan Essay masing-masing, klik "Tambah kelompok", isi angka minimalnya (misalnya 30), lalu centang mata pelajaran yang masuk kelompok itu. Buat kelompok lain untuk angka lain (misalnya 35). Satu mata pelajaran hanya bisa ada di satu kelompok, dan yang tidak dicentang tetap memakai aturan awal (minimal 1 soal). Aturan ini dicek saat guru mengirim paket, jadi paket yang sudah dikirim atau disetujui tidak terpengaruh. Jangan lupa tekan Simpan Batas Soal.',
          },
          {
            q: 'Apa itu Admin Kelas dan bagaimana menyalakannya?',
            a: 'Admin Kelas adalah guru yang Anda tunjuk untuk menyetujui paket soal di kelas tertentu, supaya pekerjaan memeriksa tidak semuanya di Admin. Buka menu Admin Kelas, nyalakan fiturnya (awalnya mati), lalu pilih guru untuk tiap kelas (satu kelas satu Admin Kelas). Kelas yang belum punya Admin Kelas tetap Anda periksa sendiri di menu Validasi Soal. Mematikan fitur ini tidak menghapus penunjukan, hanya menghentikan berlakunya.',
          },
          {
            q: 'Apa saja yang bisa diatur di tab Pengaturan Ujian?',
            a: 'Batas pelanggaran (sebelum siswa bisa dikunci), jumlah pilihan jawaban yang dipakai (beserta pilihan untuk mengunci jumlahnya supaya guru tidak bisa mengubah), waktu paling cepat siswa boleh mengirim jawaban, batas lama essay, dan jumlah soal minimal tiap mata pelajaran. Waktu paling cepat mengirim jawaban tidak bisa diubah selama ada ujian yang sedang berjalan; tunggu sampai semua ujian selesai.',
          },
          {
            q: 'Siapa yang menentukan lama waktu soal essay?',
            a: 'Guru boleh mengusulkan lama waktu essay, dan usulan itu tampil di form jadwal. Keputusan akhirnya Anda isi di jadwal ujian. Kalau dikosongkan, jadwal mengikuti usulan guru.',
          },
        ],
      },
      {
        category: 'Saat Ujian Berlangsung',
        items: [
          {
            q: 'Guru meminta izin Layar Pantau, bagaimana menyetujuinya?',
            a: 'Buka menu Izin Layar Pantau. Di sana Anda melihat permintaan guru, lalu bisa menyetujui, menolak, atau mencabut izin. Izin berlaku 10 jam sejak disetujui. Admin dan Kepala Sekolah tidak perlu izin. Layar Pantau hanya bisa dibuka lewat laptop atau komputer.',
          },
          {
            q: 'Bagaimana memberi ujian susulan, misalnya karena listrik mati?',
            a: 'Di menu Jadwal Ujian, buka ujian susulan untuk jadwal itu dan pilih guru yang jadi pengawasnya. Susulan tidak bisa dibuka kalau jadwal itu masih punya ujian yang sedang berjalan, supaya tidak bentrok. Guru pengawas juga bisa membuka susulan dari akunnya.',
          },
          {
            q: 'Ada siswa yang dikunci permanen oleh pengawas, bagaimana nilainya?',
            a: 'Aturannya: dikunci berarti gugur. Pada ujian itu siswa tidak bisa melanjutkan dan nilainya menjadi 0, kecuali nilai yang sudah terlanjur dikirim ke wali kelas. Kalau pengunciannya terjadi karena gangguan pada perangkat atau jaringan, Anda bisa memberi kesempatan lewat ujian susulan.',
          },
          {
            q: 'Nilai tidak muncul setelah ujian selesai',
            a: 'Pastikan siswa menekan "Selesai Ujian", bukan hanya menutup halaman. Lihat menu Rekap Nilai, apakah datanya sudah masuk. Untuk mata pelajaran yang punya essay, nilai total baru muncul setelah guru memeriksa essay dan mengumumkan nilainya di menu Penilaian.',
          },
        ],
      },
      {
        category: 'Masalah Teknis & Perawatan',
        items: [
          {
            q: 'Berapa banyak siswa yang bisa memakai aplikasi bersamaan?',
            a: 'Tergantung paket layanan server yang dipakai. Paket gratis cukup untuk ratusan pengguna bersamaan. Kalau siswanya sangat banyak, sebaiknya tanyakan ke pengelola aplikasi tentang menaikkan ke paket berbayar supaya tetap lancar.',
          },
          {
            q: 'Aplikasi error / halaman tidak bisa dibuka',
            a: 'Muat ulang halamannya. Kalau masih bermasalah, tunggu beberapa menit lalu coba lagi. Pastikan juga tidak ada pekerjaan besar yang sedang berjalan, seperti memasukkan data siswa dalam jumlah banyak. Untuk masalah yang serius, hubungi pengelola aplikasi.',
          },
          {
            q: 'Data sekolah hilang setelah Reset Data',
            a: 'Kalau Reset "Semua Data" dilakukan, semua pengaturan ikut terhapus, termasuk data dan logo tiap sekolah. Isi lagi di halaman Informasi Sekolah (dibuka lewat kartu di atas tab Pengaturan). Selalu buat cadangan dulu di tab Backup & Restore sebelum menghapus data apa pun.',
          },
        ],
      },
    ],
  },
]
