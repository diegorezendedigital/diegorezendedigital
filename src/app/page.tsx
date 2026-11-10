"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/dashboard/produtos" : "/login");
    });
  }, [router]);

  return <p className="p-8 text-sm text-slate-500">Carregando…</p>;
}
