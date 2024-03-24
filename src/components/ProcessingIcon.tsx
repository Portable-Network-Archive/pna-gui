import React from "react";
import { SymbolIcon } from "@radix-ui/react-icons";
import { IconProps } from "@radix-ui/react-icons/dist/types";
import styles from "./ProcessingIcon.module.css";

const ProcessingIcon = React.forwardRef<SVGSVGElement, IconProps>(
  function ProcessingIcon({ className, ...props }, ref) {
    return (
      <SymbolIcon
        className={`${styles.RotatingElement} ${className}`}
        {...props}
        ref={ref}
      />
    );
  },
);

export default ProcessingIcon;
