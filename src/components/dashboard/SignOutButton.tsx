"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ dark = false, full = false }: { dark?: boolean; full?: boolean }) {
  const router = useRouter();
  const supabase = createClient();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      onClick={signOut}
      className={
        dark
          ? "rounded-lg p-2 text-gray-400 hover:bg-ink-800 hover:text-white"
          : full
          ? "flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
          : "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-ink-950"
      }
      title="Sign out"
    >
      <LogOut className="h-4 w-4" />
      {!dark && <span className={full ? "" : "hidden sm:inline"}>Sign out</span>}
    </button>
  );
}
