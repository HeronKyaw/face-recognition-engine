"use client";

import { useState } from "react";
import VerifyModal from "@/components/VerifyModal";

export default function VerifyFAB() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-300/50 hover:bg-indigo-700 hover:scale-110 active:scale-95 transition-all duration-200 flex items-center justify-center text-2xl"
        title="Verify Face"
      >
        ◐
      </button>
      <VerifyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
