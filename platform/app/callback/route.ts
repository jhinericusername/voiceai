import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { publicBaseUrl } from "@/lib/site-url";

export const GET = handleAuth({
  baseURL: publicBaseUrl(),
  returnPathname: "/dashboard",
  onError: ({ request }) => NextResponse.redirect(new URL("/login", request.url)),
});
