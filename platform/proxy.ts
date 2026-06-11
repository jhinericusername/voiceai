import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { workosRedirectUri } from "@/lib/site-url";

export default authkitProxy({
  redirectUri: workosRedirectUri(),
});

export const config = {
  matcher: [
    "/((?!api/livekit/webhook|api/ashby/webhook|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|humans.txt|manifest.json|manifest.webmanifest|opengraph-image|twitter-image|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
