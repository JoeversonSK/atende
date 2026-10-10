import { UsersRound } from "lucide-react";
import { isGroupChat, type Chat } from "../../conversation-model";

const initials = (value: string) => value.split(" ").filter(Boolean).slice(0, 2)
  .map(word => word[0]).join("").toUpperCase() || "WA";

export function ContactAvatar({ chat, className = "wa-avatar wa-contact" }: {
  chat: Pick<Chat, "id" | "name" | "avatar" | "isGroup">;
  className?: string;
}) {
  return <span className={className}>
    {chat.avatar ? <img src={chat.avatar} alt="" referrerPolicy="no-referrer" />
      : isGroupChat(chat) ? <UsersRound size={19} aria-hidden="true" /> : initials(chat.name)}
  </span>;
}
