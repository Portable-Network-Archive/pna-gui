import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import styles from "./Dialog.module.css";

export const Root: React.FC<Dialog.DialogProps> = ({ ...props }) => (
  <Dialog.Root {...props} />
);

export const Trigger: React.FC<
  Dialog.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>
> = ({ ...props }) => <Dialog.Trigger {...props} />;

export const Portal: React.FC<Dialog.PortalProps> = ({ ...props }) => (
  <Dialog.Portal {...props} />
);

export const Overlay: React.FC<
  Dialog.DialogOverlayProps & React.RefAttributes<HTMLDivElement>
> = ({ className, ...props }) => (
  <Dialog.Overlay
    className={`${styles.DialogOverlay} ${className}`}
    {...props}
  />
);

export const Content: React.FC<
  Dialog.DialogContentProps & React.RefAttributes<HTMLDivElement>
> = ({ className, ...props }) => (
  <Dialog.Content
    className={`${styles.DialogContent} ${className}`}
    {...props}
  />
);

export const Title: React.FC<
  Dialog.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>
> = ({ className, ...props }) => (
  <Dialog.Title className={`${styles.DialogTitle} ${className}`} {...props} />
);

export const Description: React.FC<
  Dialog.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>
> = ({ className, ...props }) => (
  <Dialog.Description
    className={`${styles.DialogDescription} ${className}`}
    {...props}
  />
);

export const Close: React.FC<
  Dialog.DialogCloseProps & React.RefAttributes<HTMLButtonElement>
> = ({ ...props }) => <Dialog.Close {...props} />;
