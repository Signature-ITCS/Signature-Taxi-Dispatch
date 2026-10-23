import { createAdminClient } from "@/lib/supabase/admin";

/** Paid help the platform offers companies (priced in the master dashboard). */
export interface SetupPackage {
  code: string;
  name: string;
  price: number;
  description: string;
}

export interface Services {
  setup_packages: SetupPackage[];
  restore_price: number;
}

export async function getServices(): Promise<Services> {
  const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "services").maybeSingle();
  const v = (data?.value ?? {}) as Partial<Services>;
  return {
    setup_packages: Array.isArray(v.setup_packages) ? v.setup_packages : [],
    restore_price: Number(v.restore_price) || 0,
  };
}

export async function getSupportEmail(): Promise<string> {
  const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "platform").maybeSingle();
  return ((data?.value as { support_email?: string } | null)?.support_email ?? "").trim();
}
