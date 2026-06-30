"use client";

import { LifeBuoy, User } from "lucide-react";
import { useState } from "react";

/**
 * Account chip avatar. OAuth provider avatar URLs (Google / GitHub) can fail to
 * load — expired signed URLs, hotlink protection, or the user removing their
 * picture — which would otherwise leave a broken-image icon in the sidebar.
 * On load error (or when there's no image) we fall back to the gradient circle.
 */
export function AccountAvatar({ src, isGuest }: { src: string | null; isGuest: boolean }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
      style={{
        background: "linear-gradient(135deg, #FFD1DC, #FFBDCD)",
        color: "#8B2D43",
      }}
    >
      {isGuest ? <User className="h-4 w-4" /> : <LifeBuoy className="h-4 w-4" />}
    </div>
  );
}
