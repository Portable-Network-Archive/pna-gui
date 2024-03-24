import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import styles from "./Dialog.module.css";

export const Root: React.FC<Dialog.DialogProps> = ({ ...props }) => (
  <Dialog.Root {...props} />
);

export const Trigger = React.forwardRef<
  HTMLButtonElement,
  Dialog.DialogTriggerProps
>(function Trigger({ className, ...props }, ref) {
  return (
    <Dialog.Trigger
      className={`${styles.DialogTrigger} ${className}`}
      {...props}
      ref={ref}
    />
  );
});

export const Portal: React.FC<Dialog.PortalProps> = ({ ...props }) => (
  <Dialog.Portal {...props} />
);

export const Overlay = React.forwardRef<
  HTMLDivElement,
  Dialog.DialogOverlayProps
>(function Overlay({ className, ...props }, ref) {
  return (
    <Dialog.Overlay
      className={`${styles.DialogOverlay} ${className}`}
      {...props}
      ref={ref}
    />
  );
});

export const Content = React.forwardRef<
  HTMLDivElement,
  Dialog.DialogContentProps
>(function Content({ className, ...props }, ref) {
  return (
    <Dialog.Content
      className={`${styles.DialogContent} ${className}`}
      {...props}
      ref={ref}
    />
  );
});

export const Title = React.forwardRef<
  HTMLHeadingElement,
  Dialog.DialogTitleProps
>(function Title({ className, ...props }, ref) {
  return (
    <Dialog.Title
      className={`${styles.DialogTitle} ${className}`}
      {...props}
      ref={ref}
    />
  );
});

export const Description = React.forwardRef<
  HTMLParagraphElement,
  Dialog.DialogDescriptionProps
>(function Description({ className, ...props }, ref) {
  return (
    <Dialog.Description
      className={`${styles.DialogDescription} ${className}`}
      {...props}
      ref={ref}
    />
  );
});

export const Close = React.forwardRef<
  HTMLButtonElement,
  Dialog.DialogCloseProps
>(function Close({ ...props }, ref) {
  return <Dialog.Close {...props} ref={ref} />;
});
