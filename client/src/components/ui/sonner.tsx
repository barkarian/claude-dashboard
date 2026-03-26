import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
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
