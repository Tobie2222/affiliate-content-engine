import { useState } from 'react';

/** Nút hai bước cho thao tác khó hoàn tác: bấm lần một để hỏi lại, lần hai mới thực hiện. */
export function ConfirmButton({
  label,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm(): void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-small" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="row">
      <button
        type="button"
        className="btn btn-small btn-danger"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-small" onClick={() => setAsking(false)}>Không</button>
    </span>
  );
}
