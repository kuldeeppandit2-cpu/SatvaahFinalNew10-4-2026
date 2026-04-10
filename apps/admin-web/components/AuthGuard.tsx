'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter, usePathname } from 'next/navigation';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | 'loading'>('loading');
  const router   = useRouter();
  const pathname = usePathname();

  const isLoginPage = pathname === '/login';

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u && !isLoginPage) router.push('/login');
      if (u  &&  isLoginPage) router.push('/');
    });
  }, [router, isLoginPage]);

  // Always render login page — it handles its own UI
  if (isLoginPage) return <>{children}</>;

  // Show spinner while checking auth on other pages
  if (user === 'loading') return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-verdigris border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return null;
  return <>{children}</>;
}
