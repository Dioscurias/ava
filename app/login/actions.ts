"use server";

import {redirect} from "next/navigation";
import {googleAuthEnabled, signIn, signOut} from "../../auth";
import {redisEnabled} from "../../lib/stream-events.server";

export async function continueWithGoogle() {
  if (!googleAuthEnabled || !redisEnabled()) redirect("/login?error=Unavailable");
  await signIn("google", {redirectTo:"/agent"});
}

export async function signOutAccount() {
  await signOut({redirectTo:"/agent"});
}
