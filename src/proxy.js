import { NextResponse } from "next/server";

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("session")?.value;

  // Let auth page and all auth/chat API routes through
  if (pathname.startsWith("/auth") || pathname.startsWith("/api/auth") || pathname.startsWith("/api/chat")) {
    // Already signed in? Bounce them back to the app
    if (pathname.startsWith("/auth") && session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // No session cookie → send to /auth
  if (!session) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
