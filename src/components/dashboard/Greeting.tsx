"use client";

import { useEffect, useState } from "react";

export function Greeting({ name }: { name?: string | null }) {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(
      hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
    );
  }, []);

  return (
    <>
      {greeting}
      {name && (
        <>
          ,{" "}
          <span className="italic text-stone-500 font-serif font-normal">
            {name}
          </span>
        </>
      )}
    </>
  );
}
