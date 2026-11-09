import { StudioShell } from "@/components/shell/studio-shell";

/**
 * The 3D view, the chat and the panels live here, above the product pages, so switching
 * products never unmounts them.
 */
export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return (
    <>
      <StudioShell />
      {children}
    </>
  );
}
