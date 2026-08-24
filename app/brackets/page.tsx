import type { Metadata } from "next";
import { PublicBrackets } from "@/components/public-brackets";

export const metadata: Metadata = {
  title: "สายการแข่งขัน | depa TABLE TENNIS 2026",
  description: "ติดตามสาย วันแข่งขัน และผลการแข่งขัน depa Table Tennis 2026",
};

export default function BracketsPage() {
  return <PublicBrackets />;
}
