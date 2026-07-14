import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import styles from "./ArchiveTreeRow.module.css";

export interface ArchiveTreeRowProps {
  active: boolean;
  expanded: boolean;
  name: string;
  collapseLabel: string;
  expandLabel: string;
  onNavigate: () => void;
  onToggle: () => void;
}

export function ArchiveTreeRow({
  active,
  expanded,
  name,
  collapseLabel,
  expandLabel,
  onNavigate,
  onToggle,
}: ArchiveTreeRowProps) {
  return (
    <div className={`${styles.row} ${active ? styles.active : ""}`}>
      <button
        className={styles.toggle}
        aria-label={`${name}: ${expanded ? collapseLabel : expandLabel}`}
        onClick={onToggle}
      >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </button>
      <button className={styles.name} onClick={onNavigate}>
        <FolderGlyph />
        <span className={styles.label}>{name}</span>
      </button>
    </div>
  );
}

export function FolderGlyph() {
  return (
    <svg
      aria-hidden="true"
      className={styles.folder}
      width="16"
      height="16"
      viewBox="0 0 15 15"
      fill="none"
    >
      <path
        d="M1.5 3.25h4l1.1 1.25h6.9v7.25H1.5v-8.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
