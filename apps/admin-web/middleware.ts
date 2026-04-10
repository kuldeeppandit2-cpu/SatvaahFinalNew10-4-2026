import { NextRequest, NextResponse } from 'next/server';

// VPN IP allowlist — edit via ADMIN_ALLOWED_IPS env var (comma-separated CIDRs/IPs)
// In production this is enforced at the network layer too (AWS security group)
// Here it's a belt-and-suspenders application-level check

const ALLOWED_IPS = (process.env.ADMIN_ALLOWED_IPS ?? '127.0.0.1,::1').split(',').map(s => s.trim());

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'
  );
}

function isAllowed(ip: string): boolean {
  // Always allow loopback in development
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (process.env.NODE_ENV === 'development') return true;
  return ALLOWED_IPS.some(allowed => ip.startsWith(allowed) || ip === allowed);
}

export function middleware(req: NextRequest): NextResponse {
  const ip = getClientIP(req);

  // Allow Next.js internals and public assets
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  // Allow login page (needed to auth before IP check can be bypassed)
  if (pathname === '/login') return NextResponse.next();

  if (!isAllowed(ip)) {
    return new NextResponse(
      JSON.stringify({ error: 'Access denied — not on VPN' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
