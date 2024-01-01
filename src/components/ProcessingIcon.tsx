import React from "react";
import { SymbolIcon } from "@radix-ui/react-icons";
import { IconProps } from "@radix-ui/react-icons/dist/types";
import styles from "./ProcessingIcon.module.css";

type ProcessingIconProps = IconProps & React.RefAttributes<SVGSVGElement>;

const ProcessingIcon: React.FC<ProcessingIconProps> = ({
  className,
  ...props
}) => {
  return (
    <SymbolIcon
      className={`${styles.RotatingElement} ${className}`}
      {...props}
    />
  );
};

export default ProcessingIcon;
