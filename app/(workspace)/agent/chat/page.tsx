import type {Metadata} from "next";
import {Agent} from "../../../../components/agent";

export const metadata: Metadata = {title: "Conversation"};

export default function ConversationPage() {
  return <Agent demo={false}/>;
}
