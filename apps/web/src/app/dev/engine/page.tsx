"use client";

import dynamic from "next/dynamic";

// three.js needs the browser, so the viewer never renders on the server.
const EngineViewer = dynamic(() => import("./viewer"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">엔진 불러오는 중…</p>,
});

export default function EngineDevPage() {
  return <EngineViewer />;
}
