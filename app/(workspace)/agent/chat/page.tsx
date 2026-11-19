import type {Metadata} from "next";
import {Agent} from "../../../../components/agent";

export const metadata: Metadata = {title: "Conversation"};

export default function ConversationPage() {
  return <Agent demo={false} elevenLabs={Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID)}/>;
}
