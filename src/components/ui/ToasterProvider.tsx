"use client";

import { Toaster } from "sonner";

export function ToasterProvider() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "white",
          border: "1px solid #e7e5e4",
          borderRadius: "0",
          fontFamily: "var(--font-inter)",
          fontSize: "13px",
          color: "#44403c",
        },
      }}
    />
  );
}
