import * as React from "react";

import { cn } from "@/ui/lib/utils";

/** Native checkbox exposed as a switch (`role="switch"`): no extra dependency, form semantics kept. */
function Switch({ className, ...props }: Omit<React.ComponentProps<"input">, "type" | "role">) {
  return (
    <input
      type="checkbox"
      role="switch"
      data-slot="switch"
      className={cn(
        "relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-input bg-muted transition-colors outline-none before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-foreground before:transition-transform checked:border-primary checked:bg-primary checked:before:translate-x-5 checked:before:bg-primary-foreground focus:ring-3 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Switch };
