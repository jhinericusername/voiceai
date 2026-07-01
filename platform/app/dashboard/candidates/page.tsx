import { redirect } from "next/navigation";

export default async function CandidatesPage() {
  redirect("/dashboard/roles");
}
