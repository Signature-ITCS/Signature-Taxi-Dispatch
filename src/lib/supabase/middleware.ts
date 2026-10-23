import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/admin", "/dispatch", "/account", "/master"];
// The driver app has its own sign-in page, inside its own area.
const DRIVER_AREA = "/driver";
const DRIVER_LOGIN = "/driver/login";

/** Refreshes the auth session cookie and guards staff-only areas. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

  const inDriverApp = (path === DRIVER_AREA || path.startsWith(DRIVER_AREA + "/")) && path !== DRIVER_LOGIN;
  if (inDriverApp && !user) {
    const url = request.nextUrl.clone();
    url.pathname = DRIVER_LOGIN;
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}
