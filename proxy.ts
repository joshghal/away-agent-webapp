import { NextResponse, type NextRequest } from "next/server";

// Content Security Policy, the second line of defense behind renderMarkdown's
// sanitizing. With a fresh nonce per request, only Next's own scripts run: injected
// inline script and `on…=` handlers are refused. The page may only talk to Supabase,
// so even a slip couldn't send your session anywhere else.
const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
const SUPABASE_HTTPS = supabase.origin;
const SUPABASE_WSS = `wss://${supabase.host}`;

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React and next/image set style attributes; styles can't run code, and CSS
    // that loads URLs is still bound by img-src/font-src below.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${SUPABASE_HTTPS}`,
    "font-src 'self' data:",
    `connect-src 'self' ${SUPABASE_HTTPS} ${SUPABASE_WSS}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.png$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
