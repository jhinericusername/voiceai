import { signOut } from "@workos-inc/authkit-nextjs";
import { publicBaseUrl } from "@/lib/site-url";

export async function GET() {
  await signOut({ returnTo: publicBaseUrl() });
}
