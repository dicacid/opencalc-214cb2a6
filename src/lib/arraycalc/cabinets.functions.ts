import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { UserCabinet } from "@/lib/acoustics/customCabinets";
import type { ExtractInput } from "./cabinetSpec.server";

export const listUserCabinets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_cabinets")
      .select("cab_key, name, manufacturer, spec")
      .order("cab_key");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      key: r.cab_key,
      name: r.name,
      manufacturer: r.manufacturer ?? "",
      spec: r.spec,
    })) as unknown as UserCabinet[];
  });

export const saveUserCabinet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UserCabinet) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("user_cabinets").upsert(
      {
        user_id: context.userId,
        cab_key: data.key,
        name: data.name,
        manufacturer: data.manufacturer ?? null,
        spec: data.spec as never,
      },
      { onConflict: "user_id,cab_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUserCabinet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { key: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_cabinets")
      .delete()
      .eq("cab_key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const extractCabinetSpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ExtractInput) => data)
  .handler(async ({ data }) => {
    const { extractSpecFields } = await import("./cabinetSpec.server");
    return JSON.stringify(await extractSpecFields(data));
  });
