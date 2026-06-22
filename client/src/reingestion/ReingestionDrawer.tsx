import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReingestionWizard from "./ReingestionWizard";

interface ReingestionDrawerProps {
  documentId: string;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

export default function ReingestionDrawer({
  documentId,
  open,
  onClose,
  onCompleted,
}: ReingestionDrawerProps) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!open) {
      setLocked(false);
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !locked) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, locked, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="mission-drawer-root">
      <button
        type="button"
        className="mission-drawer-backdrop"
        aria-label="Close re-ingestion wizard"
        disabled={locked}
        onClick={() => {
          if (!locked) {
            onClose();
          }
        }}
      />
      <dialog
        open
        className="mission-drawer"
        aria-labelledby="reingestion-wizard-heading"
      >
        <ReingestionWizard
          documentId={documentId}
          onClose={onClose}
          onCompleted={onCompleted}
          onLockChange={setLocked}
        />
      </dialog>
    </div>,
    document.body,
  );
}
