import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        style: {
          background: "#1a1d27",
          border: "1px solid #2a2d3a",
          color: "#e2e8f0",
        },
      }}
    />
  );
}
