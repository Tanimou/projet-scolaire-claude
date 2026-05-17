'use client';

import type { ReactNode } from 'react';

import { Drawer, type DrawerSize } from './Drawer';

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Optional bottom action area (e.g. "Modifier" / "Archiver" buttons) */
  footerActions?: ReactNode;
  size?: DrawerSize;
  children: ReactNode;
}

/**
 * DetailDrawer — right-side slide-in panel hosting a read-only detail view.
 * Wraps `Drawer` with a slightly different footer convention (actions, not Save/Cancel).
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  description,
  footerActions,
  size = 'lg',
  children,
}: DetailDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={footerActions ?? undefined}
    >
      {children}
    </Drawer>
  );
}
