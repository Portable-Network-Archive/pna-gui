"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Dialog } from "@radix-ui/themes";
import { useI18n } from "../features/i18n";
import styles from "./ResponsiveInspector.module.css";

export default function ResponsiveInspector({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);
  const inlineRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setNarrow(media.matches);
      if (!media.matches) setOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <Dialog.Root open={narrow && open} onOpenChange={setOpen}>
      {narrow ? (
        <Dialog.Trigger>
          <button type="button" className={styles.trigger}>
            {t("showDetails")}
          </button>
        </Dialog.Trigger>
      ) : (
        <aside
          ref={inlineRef}
          className={className}
          aria-label={label}
          tabIndex={-1}
        >
          {children}
        </aside>
      )}
      <Dialog.Content
        maxWidth="520px"
        className={styles.panelContent}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!narrow) {
            event.preventDefault();
            inlineRef.current?.focus();
          }
        }}
      >
        <div className={styles.heading}>
          <Dialog.Title>{label}</Dialog.Title>
          <Dialog.Close>
            <button
              type="button"
              className={styles.close}
              aria-label={t("closeDetails")}
            >
              <Cross2Icon aria-hidden="true" />
            </button>
          </Dialog.Close>
        </div>
        <div className={`${className} ${styles.panelBody}`}>{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
