"use server";

import {redirect} from "next/navigation";
import {googleAuthEnabled, signIn, signOut} from "../../auth";
import {accountStorageEnabled} from "../../lib/account-workspace.server";

export async function continueWithGoogle() {
  if (!googleAuthEnabled || !accountStorageEnabled()) redirect("/login?error=Unavailable");
  await signIn("google", {redirectTo:"/agent"});
}

export async function signOutAccount() {
  await signOut({redirectTo:"/agent"});
}
