'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PengawasLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    // Role PENGAWAS sudah tidak ada — redirect ke login
    router.replace('/login')
  }, [router])
  return null
}
