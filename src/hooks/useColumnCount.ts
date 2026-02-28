"use client";

import { useState, useEffect } from "react";

/** Responsive column count matching Tailwind breakpoints */
export function useColumnCount() {
  const [count, setCount] = useState(4);
  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      if (w >= 1280) setCount(7);
      else if (w >= 1024) setCount(6);
      else if (w >= 768) setCount(5);
      else if (w >= 640) setCount(4);
      else setCount(3);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return count;
}
