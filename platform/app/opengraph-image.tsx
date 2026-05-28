import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          color: "#0f172a",
          background:
            "linear-gradient(135deg, #f8fbff 0%, #e0f7ff 42%, #eef2ff 100%)",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.08) 1px, transparent 1px)",
            backgroundSize: "54px 54px",
            opacity: 0.34,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 180,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(14,165,233,0.14) 48%, rgba(15,23,42,0.08) 100%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 14,
              background: "#0f172a",
              color: "#67e8f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            P
          </div>
          <div style={{ fontSize: 34, fontWeight: 750 }}>Puddle</div>
        </div>

        <div style={{ position: "relative", maxWidth: 900, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              border: "1px solid rgba(14,165,233,0.26)",
              borderRadius: 999,
              padding: "9px 16px",
              background: "rgba(255,255,255,0.72)",
              color: "#0369a1",
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 28,
            }}
          >
            AI voice interview platform
          </div>
          <div style={{ fontSize: 78, lineHeight: 1.02, fontWeight: 800, letterSpacing: 0 }}>
            Live interviews. Structured evidence.
          </div>
          <div style={{ marginTop: 26, fontSize: 30, lineHeight: 1.42, color: "#475569" }}>
            Candidate rooms, controlled voice prompts, transcripts, and review-ready assessments in one platform.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
