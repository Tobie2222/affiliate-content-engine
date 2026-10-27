import { THREADS_MAX_CHARS, lengthState } from './content';

const NOTE = { ok: '', near: ' Gần chạm giới hạn.', over: ' Vượt giới hạn, cần rút gọn.' } as const;

export function LengthMeter({ chars }: { chars: number }) {
  const state = lengthState(chars);
  return (
    <p className="meter" data-state={state} role="status">
      {chars}/{THREADS_MAX_CHARS} ký tự (gồm dòng công khai và link).{NOTE[state]}
    </p>
  );
}
