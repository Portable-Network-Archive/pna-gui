import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import styles from "./Dialog.module.css";

export const Root: React.FC<Dialog.DialogProps> = ({ ...props }) => (
  <Dialog.Root {...props} />
);

export const Trigger = React.forwardRef<
  HTMLButtonElement,
  Dialog.DialogTriggerProps
>(({ className, ...props }, ref) => (
  <Dialog.Trigger
    className={`${styles.DialogTrigger} ${className}`}
    {...props}
    ref={ref}
  />
));

export const Portal: React.FC<Dialog.PortalProps> = ({ ...props }) => (
  <Dialog.Portal {...props} />
);

export const Overlay = React.forwardRef<
  HTMLDivElement,
  Dialog.DialogOverlayProps
>(({ className, ...props }, ref) => (
  <Dialog.Overlay
    className={`${styles.DialogOverlay} ${className}`}
    {...props}
    ref={ref}
  />
));

export const Content = React.forwardRef<
  HTMLDivElement,
  Dialog.DialogContentProps
>(({ className, ...props }, ref) => (
  <Dialog.Content
    className={`${styles.DialogContent} ${className}`}
    {...props}
    ref={ref}
  />
));

export const Title = React.forwardRef<
  HTMLHeadingElement,
  Dialog.DialogTitleProps
>(({ className, ...props }, ref) => (
  <Dialog.Title
    className={`${styles.DialogTitle} ${className}`}
    {...props}
    ref={ref}
  />
));

export const Description = React.forwardRef<
  HTMLParagraphElement,
  Dialog.DialogDescriptionProps
>(({ className, ...props }, ref) => (
  <Dialog.Description
    className={`${styles.DialogDescription} ${className}`}
    {...props}
    ref={ref}
  />
));

export const Close = React.forwardRef<
  HTMLButtonElement,
  Dialog.DialogCloseProps
>(({ ...props }, ref) => <Dialog.Close {...props} ref={ref} />);
