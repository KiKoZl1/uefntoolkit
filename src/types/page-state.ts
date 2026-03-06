import { ReactNode } from "react";

export type PageStateVariant = "full-page" | "section" | "compact";
export type PageStateTone = "default" | "error" | "success";

export interface PageStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface PageStateProps {
  variant?: PageStateVariant;
  tone?: PageStateTone;
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: PageStateAction;
  secondaryAction?: PageStateAction;
}
