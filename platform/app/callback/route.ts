import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

export const GET = handleAuth({
  returnPathname: "/dashboard",
  onError: ({ request }) => NextResponse.redirect(new URL("/login", request.url)),
});
