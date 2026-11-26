'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy Classic Simulator route — retired into the unified Workbench UI (/flowsheet-simulator).
 * Full historical Classic Simulator source remains preserved in Git history (up to commit ecc47a3).
 */
export default function ClassicSimulatorRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/flowsheet-simulator');
  }, [router]);

  return (
    <div
      style={{
        height: 'calc(100vh - 54px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        color: '#64748B',
      }}
    >
      통합 시뮬레이터 워크벤치로 이동 중...
    </div>
  );
}
