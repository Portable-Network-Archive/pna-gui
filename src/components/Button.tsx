import React, { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactElement;
};

const Button: React.FC<ButtonProps> = ({
  icon,
  className,
  children,
  ...buttonProps
}) => {
  return (
    <button className={`${styles.button} ${className}`} {...buttonProps}>
      {icon}
      {children}
    </button>
  );
};

export default Button;
