"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ManualAccountForm } from "./manual-account-form";

/** Header button that opens the "add manual account" modal. */
export function ManualAccountButton({ currency }: { currency: string }) {
  const t = useTranslations("bank");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Wallet className="h-3.5 w-3.5" />
        {t("manual.addManual")}
      </Button>
      {open ? <ManualAccountForm currency={currency} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
