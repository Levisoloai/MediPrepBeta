export const formatMsAsMMSS = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

