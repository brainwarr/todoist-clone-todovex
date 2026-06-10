"use server";

import { signIn, signOut } from "@/auth";

export async function signInAction(formData: FormData) {
  await signIn("credentials", {
    username: formData.get("username"),
    password: formData.get("password"),
    redirectTo: "/loggedin",
  });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
