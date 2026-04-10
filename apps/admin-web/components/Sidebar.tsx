'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const nav = [
  { href: '/',              label: '📊 Dashboard' },
  { href: '/config',        label: '⚙️ System Config' },
  { href: '/trust-config',  label: '🛡 Trust Config' },
  { href: '/disputes',      label: '🚩 Disputes' },
  { href: '/credentials',   label: '📋 Credentials' },
  { href: '/providers',     label: '👤 Providers' },
  { href: '/cities',        label: '🏙 Cities' },
  { href: '/scraping',      label: '🕷 Scraping' },
  { href: '/tsaas',         label: '🔑 TSaaS Keys' },
  { href: '/notifications', label: '🔔 Notifications' },
];

export function Sidebar() {
  const path   = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    sessionStorage.removeItem('admin_token');
    await signOut(auth);
    router.push('/login');
  }

  return (
    <aside className="w-56 min-h-screen bg-deep-ink flex flex-col py-6">
      <div className="px-5 mb-8">
        <div className="text-saffron font-bold text-lg">SatvAAh</div>
        <div className="text-gray-400 text-xs mt-0.5">Admin Portal</div>
      </div>
      <nav className="flex-1 flex flex-col gap-0.5 px-3">
        {nav.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${path === href ? 'bg-verdigris text-white font-medium' : 'text-gray-300 hover:bg-white/10'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-4 mt-4">
        <button
          onClick={handleSignOut}
          className="w-full text-left text-gray-400 text-xs hover:text-white px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
