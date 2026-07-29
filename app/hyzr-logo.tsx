export function HyzrMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`hyzr-mark ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.54)) }}
      aria-hidden="true"
    >
      H
    </span>
  );
}

export function HyzrChatLogo({ compact = false, size = 28 }: { compact?: boolean; size?: number }) {
  return (
    <span className="hyzr-chat-logo" aria-label="Hyzr Chat">
      <HyzrMark size={size} />
      {!compact && <span className="hyzr-chat-wordmark"><b>Hyzr</b><em>Chat</em></span>}
    </span>
  );
}
