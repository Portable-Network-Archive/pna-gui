import React, { LiHTMLAttributes } from "react";
import styles from "./FileList.module.css";

type FileListProps = LiHTMLAttributes<HTMLUListElement>;

const Root: React.FC<FileListProps> = ({ className, ...props }) => {
  return <ul className={`${styles.FileList} ${className}`} {...props} />;
};

type ListItemProps = LiHTMLAttributes<HTMLLIElement>;

const Item: React.FC<ListItemProps> = ({ className, ...props }) => {
  return <li className={`${styles.FileItem} ${className}`} {...props} />;
};

export { Root, Item };
