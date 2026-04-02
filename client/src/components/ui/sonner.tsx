import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      style={{
        top: "env(safe-area-inset-top, 0px)",
      }}
      toastOptions={{
        style: {
          background: "rgb(var(--color-bg-surface))",
          border: "1px solid rgb(var(--color-border))",
          color: "rgb(var(--color-text))",
        },
      }}
    />
  );
}
