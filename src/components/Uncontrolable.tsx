import React from "react";
import styles from "./Uncontrolable.module.css";

const Uncontrolable = React.forwardRef<
  HTMLDivElement,
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div className={`${styles.FullScrean} ${className}`} {...props} ref={ref} />
));

export default Uncontrolable;
