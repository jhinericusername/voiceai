import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { workosRedirectUri } from "@/lib/site-url";

export default authkitProxy({
  redirectUri: workosRedirectUri(),
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|humans.txt|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
