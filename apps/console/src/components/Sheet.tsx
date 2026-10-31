"use client";

import type { ReactNode } from "react";
import { Modal } from "./ui/modal";

/** Kept for the staff screens: a responsive Modal (drawer on phones, dialog on larger screens). */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} footer={footer}>
      {children}
    </Modal>
  );
}
