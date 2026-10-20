import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }];
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === "512" ? 512 : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#7c2d12", color: "#fde68a", fontSize: size * 0.55, fontWeight: 700 }}>
        T
      </div>
    ),
    { width: size, height: size }
  );
}
