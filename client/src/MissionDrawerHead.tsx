interface MissionDrawerHeadProps {
  folio: string;
  title: string;
  titleId?: string;
  lede?: string;
  onClose: () => void;
  closeDisabled?: boolean;
}

export default function MissionDrawerHead({
  folio,
  title,
  titleId,
  lede,
  onClose,
  closeDisabled = false,
}: MissionDrawerHeadProps) {
  return (
    <header className="mission-drawer-head">
      <div className="mission-drawer-head-copy">
        <span className="folio">{folio}</span>
        <h2 id={titleId} className="mission-drawer-title">
          {title}
        </h2>
        {lede ? <p className="mission-drawer-lede">{lede}</p> : null}
      </div>
      <button
        type="button"
        className="mission-drawer-close"
        onClick={onClose}
        disabled={closeDisabled}
      >
        Close
      </button>
    </header>
  );
}
