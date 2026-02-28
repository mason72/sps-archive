"use client";

import { useAuth } from "./AuthProvider";

export function SignOutButton() {
  const { signOut } = useAuth();

  return (
    <button
      onClick={signOut}
      className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
    >
      Sign out
    </button>
  );
}
