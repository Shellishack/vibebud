'use client';

import dynamic from 'next/dynamic';

const Buddy = dynamic(() => import('../components/dashboard/buddy-dashboard'), { ssr: false });

export default function BuddyOnly() {
  return (
    <>
      <style>{`html, body { background: transparent !important; }`}</style>
      <Buddy />
    </>
  );
}
