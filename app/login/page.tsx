import Link from "next/link";
import {Brand} from "../../components/brand";
import {googleAuthEnabled} from "../../auth";
import {accountStorageEnabled} from "../../lib/account-workspace.server";
import {continueWithGoogle} from "./actions";

export default async function LoginPage({searchParams}: {searchParams: Promise<{error?:string}>}) {
  const {error} = await searchParams;
  const enabled = googleAuthEnabled && accountStorageEnabled();
  return <main className="app-main detail-page login-page">
    <Brand/>
    <h1>Sign in to Ava</h1>
    <p>Save your demo escrows, limits, and settings across devices.</p>
    <form action={continueWithGoogle}>
      <button className="button primary" disabled={!enabled}>Continue with Google</button>
    </form>
    {!enabled ? <p role="status">Google sign-in is unavailable. You can still try the demo.</p>
      : error && <p role="alert">Google sign-in didn’t finish. Try again or continue as a guest.</p>}
    <Link className="text-link" href="/agent">Try the demo without signing in</Link>
  </main>;
}
