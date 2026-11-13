import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/context";

export default async function HomePage() {
  redirect((await getCurrentUser()) ? "/organizations" : "/login");
}
