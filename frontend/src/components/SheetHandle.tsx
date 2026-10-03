import React from "react";

interface SheetHandleProps {
  onClose: () => void;
  label?: string;
}

/**
 * Reusable phone bottom-sheet drag handle.
 * Visible only on mobile (≤768px) and closes the sheet on tap,
 * mirroring the file/link picker sheet behavior.
 */
export const SheetHandle: React.FC<SheetHandleProps> = ({
  onClose,
  label = "Cerrar",
}) => (
  <button
    type="button"
    className="sheet-handle"
    onClick={onClose}
    aria-label={label}
    title={label}
  />
);
