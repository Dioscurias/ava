import type {Metadata} from "next";
import {Agent} from "../../../../components/agent";

export const metadata: Metadata = {title: "Conversation"};

export default async function ConversationPage({searchParams}: {searchParams: Promise<{mode?: string}>}) {
  return <Agent demo={false} devnet={(await searchParams).mode === "devnet"}/>;
}
