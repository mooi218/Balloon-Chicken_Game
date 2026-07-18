import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "何回でもシコシコしてよくてでも最低一回はシコってしなきゃいけなくて限界に達した人が負けっていうゲーム";
const description = "空気入れで風船を膨らませる、オンライン対応チキンレース。爆発させた人が負け。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", locale: "ja_JP", images: [{ url: image, width: 1733, height: 907 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
