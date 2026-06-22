/**
 * Data wilayah Indonesia (provinsi + kabupaten/kota) dan mapping ke zona
 * waktu resmi (WIB/WITA/WIT). Dipakai untuk fitur "deteksi zona waktu
 * otomatis" di menu Pengaturan Sekolah.
 *
 * Sumber pembagian zona waktu: Keppres No. 41 Tahun 1987.
 *  - WIB  (UTC+7): Sumatera, Jawa, Kalimantan Barat, Kalimantan Tengah
 *  - WITA (UTC+8): Bali, NTB, NTT, Kalimantan (Selatan/Timur/Utara), Sulawesi, Gorontalo
 *  - WIT  (UTC+9): Maluku, Maluku Utara, Papua (semua provinsi pemekaran)
 *
 * Daftar kabupaten/kota di sini tidak perlu 100% lengkap untuk seluruh
 * Indonesia — yang penting tiap provinsi punya representasi yang cukup.
 * Karena zona waktu ditentukan oleh PROVINSI (bukan oleh kabupaten),
 * kabupaten hanya field pelengkap data sekolah, tidak memengaruhi hasil
 * deteksi zona waktu.
 */

export type ZonaWaktu = 'WIB' | 'WITA' | 'WIT'

export interface ZonaWaktuInfo {
  zona: ZonaWaktu
  offset: string   // format ISO offset, misal '+07:00'
  utcOffsetJam: number // 7, 8, atau 9
  label: string    // misal 'WITA (UTC+8)'
}

export const ZONA_WAKTU_INFO: Record<ZonaWaktu, ZonaWaktuInfo> = {
  WIB:  { zona: 'WIB',  offset: '+07:00', utcOffsetJam: 7, label: 'WIB (UTC+7)' },
  WITA: { zona: 'WITA', offset: '+08:00', utcOffsetJam: 8, label: 'WITA (UTC+8)' },
  WIT:  { zona: 'WIT',  offset: '+09:00', utcOffsetJam: 9, label: 'WIT (UTC+9)' },
}

export interface Provinsi {
  id: string
  nama: string
  zona: ZonaWaktu
  kabupaten: string[]
}

export const DATA_WILAYAH: Provinsi[] = [
  // ── WIB (UTC+7) ──────────────────────────────────────────────
  { id: 'aceh', nama: 'Aceh', zona: 'WIB', kabupaten: ['Banda Aceh', 'Aceh Besar', 'Aceh Utara', 'Lhokseumawe', 'Bireuen', 'Langsa'] },
  { id: 'sumut', nama: 'Sumatera Utara', zona: 'WIB', kabupaten: ['Medan', 'Deli Serdang', 'Binjai', 'Pematangsiantar', 'Tebing Tinggi'] },
  { id: 'sumbar', nama: 'Sumatera Barat', zona: 'WIB', kabupaten: ['Padang', 'Bukittinggi', 'Padang Pariaman', 'Agam', 'Payakumbuh'] },
  { id: 'riau', nama: 'Riau', zona: 'WIB', kabupaten: ['Pekanbaru', 'Kampar', 'Dumai', 'Rokan Hulu', 'Siak'] },
  { id: 'kepri', nama: 'Kepulauan Riau', zona: 'WIB', kabupaten: ['Batam', 'Tanjungpinang', 'Bintan', 'Karimun'] },
  { id: 'jambi', nama: 'Jambi', zona: 'WIB', kabupaten: ['Kota Jambi', 'Muaro Jambi', 'Batanghari', 'Bungo'] },
  { id: 'sumsel', nama: 'Sumatera Selatan', zona: 'WIB', kabupaten: ['Palembang', 'Musi Banyuasin', 'Ogan Ilir', 'Lubuklinggau'] },
  { id: 'babel', nama: 'Kepulauan Bangka Belitung', zona: 'WIB', kabupaten: ['Pangkalpinang', 'Bangka', 'Belitung'] },
  { id: 'bengkulu', nama: 'Bengkulu', zona: 'WIB', kabupaten: ['Kota Bengkulu', 'Bengkulu Utara', 'Rejang Lebong'] },
  { id: 'lampung', nama: 'Lampung', zona: 'WIB', kabupaten: ['Bandar Lampung', 'Lampung Selatan', 'Lampung Tengah', 'Metro'] },
  { id: 'dki', nama: 'DKI Jakarta', zona: 'WIB', kabupaten: ['Jakarta Pusat', 'Jakarta Utara', 'Jakarta Barat', 'Jakarta Selatan', 'Jakarta Timur', 'Kepulauan Seribu'] },
  { id: 'jabar', nama: 'Jawa Barat', zona: 'WIB', kabupaten: ['Bandung', 'Bekasi', 'Bogor', 'Depok', 'Cimahi', 'Tasikmalaya', 'Cirebon', 'Sukabumi'] },
  { id: 'banten', nama: 'Banten', zona: 'WIB', kabupaten: ['Tangerang', 'Tangerang Selatan', 'Serang', 'Cilegon', 'Pandeglang'] },
  { id: 'jateng', nama: 'Jawa Tengah', zona: 'WIB', kabupaten: ['Semarang', 'Surakarta', 'Magelang', 'Pekalongan', 'Tegal', 'Kudus'] },
  { id: 'diy', nama: 'DI Yogyakarta', zona: 'WIB', kabupaten: ['Yogyakarta', 'Sleman', 'Bantul', 'Gunungkidul', 'Kulon Progo'] },
  { id: 'jatim', nama: 'Jawa Timur', zona: 'WIB', kabupaten: ['Surabaya', 'Malang', 'Kediri', 'Madiun', 'Jember', 'Sidoarjo', 'Gresik'] },
  { id: 'kalbar', nama: 'Kalimantan Barat', zona: 'WIB', kabupaten: ['Pontianak', 'Singkawang', 'Kubu Raya', 'Sambas'] },
  { id: 'kalteng', nama: 'Kalimantan Tengah', zona: 'WIB', kabupaten: ['Palangka Raya', 'Kotawaringin Timur', 'Kotawaringin Barat'] },

  // ── WITA (UTC+8) ─────────────────────────────────────────────
  { id: 'bali', nama: 'Bali', zona: 'WITA', kabupaten: ['Denpasar', 'Badung', 'Gianyar', 'Buleleng', 'Tabanan'] },
  { id: 'ntb', nama: 'Nusa Tenggara Barat', zona: 'WITA', kabupaten: ['Mataram', 'Lombok Barat', 'Lombok Timur', 'Sumbawa'] },
  { id: 'ntt', nama: 'Nusa Tenggara Timur', zona: 'WITA', kabupaten: ['Kupang', 'Ende', 'Sikka', 'Manggarai'] },
  { id: 'kalsel', nama: 'Kalimantan Selatan', zona: 'WITA', kabupaten: ['Banjarmasin', 'Banjarbaru', 'Banjar', 'Kotabaru'] },
  { id: 'kaltim', nama: 'Kalimantan Timur', zona: 'WITA', kabupaten: ['Samarinda', 'Balikpapan', 'Kutai Kartanegara', 'Bontang'] },
  { id: 'kaltara', nama: 'Kalimantan Utara', zona: 'WITA', kabupaten: ['Tarakan', 'Bulungan', 'Malinau', 'Nunukan'] },
  { id: 'sulut', nama: 'Sulawesi Utara', zona: 'WITA', kabupaten: ['Manado', 'Minahasa', 'Bitung', 'Kotamobagu'] },
  { id: 'gorontalo', nama: 'Gorontalo', zona: 'WITA', kabupaten: ['Kota Gorontalo', 'Gorontalo', 'Boalemo', 'Bone Bolango'] },
  { id: 'sulteng', nama: 'Sulawesi Tengah', zona: 'WITA', kabupaten: ['Palu', 'Banggai', 'Banggai Kepulauan', 'Poso', 'Parigi Moutong', 'Toli-Toli', 'Donggala', 'Morowali', 'Tojo Una-Una', 'Sigi', 'Buol', 'Banggai Laut', 'Morowali Utara'] },
  { id: 'sulbar', nama: 'Sulawesi Barat', zona: 'WITA', kabupaten: ['Mamuju', 'Polewali Mandar', 'Majene', 'Mamasa'] },
  { id: 'sulsel', nama: 'Sulawesi Selatan', zona: 'WITA', kabupaten: ['Makassar', 'Gowa', 'Bone', 'Parepare', 'Maros'] },
  { id: 'sultra', nama: 'Sulawesi Tenggara', zona: 'WITA', kabupaten: ['Kendari', 'Kolaka', 'Konawe', 'Bau-Bau'] },

  // ── WIT (UTC+9) ──────────────────────────────────────────────
  { id: 'maluku', nama: 'Maluku', zona: 'WIT', kabupaten: ['Ambon', 'Maluku Tengah', 'Tual', 'Buru'] },
  { id: 'malut', nama: 'Maluku Utara', zona: 'WIT', kabupaten: ['Ternate', 'Tidore Kepulauan', 'Halmahera Barat', 'Halmahera Utara'] },
  { id: 'papuabarat', nama: 'Papua Barat', zona: 'WIT', kabupaten: ['Manokwari', 'Sorong', 'Fakfak', 'Kaimana'] },
  { id: 'papuabaratdaya', nama: 'Papua Barat Daya', zona: 'WIT', kabupaten: ['Sorong', 'Raja Ampat', 'Tambrauw', 'Maybrat'] },
  { id: 'papua', nama: 'Papua', zona: 'WIT', kabupaten: ['Jayapura', 'Biak Numfor', 'Keerom', 'Sarmi'] },
  { id: 'papuatengah', nama: 'Papua Tengah', zona: 'WIT', kabupaten: ['Nabire', 'Paniai', 'Mimika', 'Puncak'] },
  { id: 'papuapegunungan', nama: 'Papua Pegunungan', zona: 'WIT', kabupaten: ['Jayawijaya', 'Yahukimo', 'Tolikara'] },
  { id: 'papuaselatan', nama: 'Papua Selatan', zona: 'WIT', kabupaten: ['Merauke', 'Boven Digoel', 'Mappi', 'Asmat'] },
]

export function getProvinsiById(id: string): Provinsi | undefined {
  return DATA_WILAYAH.find(p => p.id === id)
}

export function getZonaWaktuByProvinsiId(provinsiId: string): ZonaWaktuInfo | null {
  const provinsi = getProvinsiById(provinsiId)
  if (!provinsi) return null
  return ZONA_WAKTU_INFO[provinsi.zona]
}
