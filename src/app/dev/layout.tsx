import { assertInternalPage } from "@/lib/auth/internal-page";

/** Every /dev page: open in development, admins only in production. */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  await assertInternalPage();
  return children;
}
