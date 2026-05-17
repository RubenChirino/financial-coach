import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const contentType = "image/png";
export const alt = "Financial Coach — local-first personal AI financial coach";
export const size = { width: 1200, height: 630 };

export default async function OpengraphImage() {
  const iconBuffer = await readFile(path.join(process.cwd(), "public/icons/icon-512.png"));
  const iconSrc = `data:image/png;base64,${iconBuffer.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "linear-gradient(135deg, #4f7cff 0%, #6f8dff 45%, #a0b4ff 100%)",
        color: "#ffffff",
      }}
    >
      <img
        src={iconSrc}
        width={168}
        height={168}
        alt=""
        style={{ borderRadius: 36, marginBottom: 48 }}
      />
      <div
        style={{
          fontSize: 104,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        Financial Coach
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 400,
          marginTop: 28,
          opacity: 0.92,
          letterSpacing: "-0.01em",
        }}
      >
        Local-first personal AI financial coach
      </div>
      <div
        style={{
          marginTop: "auto",
          fontSize: 28,
          opacity: 0.8,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span>Private by default · Open source · PSD2 Open Banking</span>
      </div>
    </div>,
    { ...size },
  );
}
