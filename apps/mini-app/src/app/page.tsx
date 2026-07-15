'use client';
import { useEffect } from 'react';
import Link from 'next/link';

export default function HomePage() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('test');
    }
  }, []);
  return (
    <main><h1>Test</h1></main>
  );
}
