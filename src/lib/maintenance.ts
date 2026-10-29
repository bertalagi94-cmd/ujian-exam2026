// Kunci pengaturan Mode Maintenance (per yayasan, tabel pengaturan).
// DIBACA oleh login (src/app/api/auth/login/route.ts) dan monitoring admin;
// DITULIS hanya oleh Panel Developer (/api/developer/yayasan/[id]/maintenance).
export const KUNCI_MAINTENANCE = [
  'maintenanceAktif',
  'maintenancePesan',
  'maintenanceMulai',
  'maintenanceSelesai',
] as const
