import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "rounded-lg border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        default: "bg-bg-surface border-border text-text-muted",
        success: "bg-success/10 border-success/30 text-success",
        danger: "bg-danger/10 border-danger/30 text-danger",
        warning: "bg-warning/10 border-warning/30 text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
);
Alert.displayName = "Alert";

export { Alert, alertVariants };
